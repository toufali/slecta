import { average, toScore } from '../utils/math.js'
import { slugify } from '../utils/slug.js'
import { space } from '../utils/throttle.js'
import redis from './redisService.js'
import imdb from './imdbService.js'
import log from '../utils/logger.js'

const SCORE_TTL = 60 * 60 * 48 // 48 hours
const SCORE_RETRY_TTL = 60 * 60 // 1 hour; rate limits clear in minutes, but a bot block can last a day
const SLUG_TTL = 60 * 60 * 24 * 30 // 30 days

// Bump when the slug record shape changes. Slug source cannot be backfilled: a cached
// record skips the Wikidata call and every run refreshes its TTL, so an unknown source would stay
// "guessed" forever.
const SLUG_CACHE_VERSION = 1
const SLUG_MISS_TTL = 60 * 60 * 24 // 1 day
const FETCH_TIMEOUT = 8000
const RETRY_AFTER_MAX = 5 // seconds; a host may ask for minutes, and the run has a task timeout to finish inside
const RETRY_DELAY = 500 // ms, before a single retry of a transient failure
const PAGE_NOT_FOUND = new Set([404, 410]) // the source answering about the title; any other failure is ours

// One outlet per fetch: RT's two keys come from one page, so counting them apart double-counts it
const OUTLET = { imdb: 'imdb', metacritic: 'metacritic', rtCritic: 'rt', rtAudience: 'rt', tmdb: 'tmdb' }
const outlets = scores => new Set(Object.keys(scores ?? {}).map(source => OUTLET[source])).size

// Undici holds the connection until a body is read or cancelled, and every path here
// throws bodies away: probes read only the status, and both readers bail on !ok. A
// sustained outage would otherwise starve the pool. Cleanup must never mask a real error.
const discard = res => res?.body?.cancel().catch(() => {})

const parseJson = value => { try { return JSON.parse(value) } catch { return null } }

// Metacritic scores TV per season too; only whole-title types, so a season page can never pass as the series score.
const MC_TYPES = ['Movie', 'TVSeries']

const LD_JSON = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g

// Both hosts carry the release year in schema.org JSON-LD, which is what tells a guessed slug from
// a different film of the same name. Not in RT's scorecard blob — that holds only the score fields.
// Off the string, not through Date: `new Date('2026-01-01').getFullYear()` is 2025 under a negative
// offset, which would reject a correct slug anywhere TZ is set
const yearOf = date => Number(String(date).slice(0, 4)) || undefined

function pageYear(html) {
  for (const [, block] of html.matchAll(LD_JSON)) {
    const item = parseJson(block)

    if (MC_TYPES.includes(item?.['@type'])) return yearOf(item.dateCreated)
  }
}

// Wikidata rate-limits generic clients; its policy requires a descriptive User-Agent.
const USER_AGENT = 'Slecta/2.0 (https://slecta.com)'
const HEADERS = { 'user-agent': USER_AGENT }

const RT_BASE_URL = 'https://www.rottentomatoes.com/'
const MC_BASE_URL = 'https://www.metacritic.com/'
const WIKI_BASE_URL = 'https://www.wikidata.org/w/rest.php/wikibase/v1/entities/items/'
const WIKI_RT_PROP = 'P1258'
const WIKI_MC_PROP = 'P1712'

// RT and Metacritic use different path prefixes and different slug separators per media type
const PATHS = {
  movie: { rt: 'm/', mc: 'movie/' },
  tv: { rt: 'tv/', mc: 'tv/' }
}

class ScoreService {
  // ms between requests to one host, set by the nightly job. A visitor's single title has nothing
  // to be spaced against.
  throttleMs = 0

  async getScoreFromCache(key) {
    return await redis.getCache(key)
  }

  async getScore(key, data, tryCache = true) {
    // One read serves both the cache hit and the never-degrade comparison below
    const stored = await this.getScoreFromCache(key)

    if (tryCache && stored) return stored

    if (!data) return log.warn('Score lookup data undefined', { key })

    const { tmdbScore, imdbId, wikiId, title, releaseDate, mediaType = 'movie' } = data

    try {
      const [imdbScore, resolved] = await Promise.all([
        this.getIMDBScore(imdbId),
        this.#resolveSources({ wikiId, title, releaseDate, mediaType })
      ])

      // Omitted rather than nulled, so key count is source count
      const scores = {
        imdb: imdbScore,
        metacritic: resolved.mc?.page?.value,
        rtCritic: resolved.rt?.page?.critic,
        rtAudience: resolved.rt?.page?.audience,
        // TMDB reports 0 when a title has no votes — absence, not a score
        tmdb: tmdbScore ? toScore(tmdbScore) : undefined
      }

      for (const [name, value] of Object.entries(scores)) {
        if (value === undefined) delete scores[name]
      }

      const sources = Object.keys(scores)
      const mean = average(Object.values(scores))
      // Round, so the number shown and the number sorted on agree
      // Omit rather than store NaN, which caches as a null that both sorts and renders wrong
      const score = { avgScore: Number.isFinite(mean) ? Math.round(mean) : undefined, scores }

      if (sources.length === 1 && sources[0] === 'tmdb') {
        log.warn('Score resolved from TMDB alone', { key, title, rt: resolved.rt?.slug, mc: resolved.mc?.slug, imdbId })
      }

      // Expire it soon: a blocked or timed-out source may hold a score we simply could not read
      // Cache it anyway, or every visitor re-runs the chain against a host that is already blocking
      if (!resolved.answered) log.warn('Score is missing a source it could not read', { key, title })

      // Refuse a thinner result, and refuse conditionally rather than by skipping the write: the
      // record read above can expire mid-run, and NX rebuilds a vanished one while declining a live
      // one, whose TTL keeps running so a wrong score still dies at expiry
      const thinner = Boolean(stored && outlets(stored.scores) > outlets(scores))
      const candidate = { ...score, fetchedAt: Date.now() }

      // Awaited so a failed write is visible: setCache hides Redis errors, and the job must not report a cache it never wrote.
      const written = await redis.setCache(key, candidate, resolved.answered ? SCORE_TTL : SCORE_RETRY_TTL, thinner)
      const kept = thinner && !written ? stored : undefined
      const result = kept ? score : candidate

      if (kept) {
        log.warn('Score not stored, thinner than the record', { key, title, outlets: outlets(scores), stored: outlets(kept.scores) })
      }

      // True whenever Redis holds a record, written now or kept: a refusal is not a failed write
      Object.defineProperty(result, 'cached', { value: Boolean(written || kept) })
      // What Redis holds, for a caller that must not publish tonight's thinner numbers
      Object.defineProperty(result, 'kept', { value: kept })

      // Return tonight's result, never the stored one, or the nightly check passes while a source is down
      return result
    } catch (e) {
      log.error('Error getting average score', { key, title, error: e })
    }
  }

  // No `answered` flag: a missing dataset reads the same however soon we ask again, and only the
  // nightly refresh can fix it — which alerts on its own
  async getIMDBScore(imdbId) {
    const rating = await imdb.getRating(imdbId)
    return rating && Math.round(rating.rating * 10) // adjusted to 100 scale
  }

  // Embedded JSON the page needs to render, so steadier than the markup the old scraper read.
  // A `tv/<slug>` path with no season suffix returns RT's cross-season average, not one season's.
  // The year comes back alongside the scores, so one GET both verifies a guess and reads it.
  async #readRT(path) {
    try {
      const { answered, body } = await this.#fetchText(RT_BASE_URL + path)

      // No body either way; `answered` is what says whether that was the title's answer or ours
      if (!body) return { answered, page: null }

      const json = body.match(/<script[^>]+id="media-scorecard-json"[^>]*>([\s\S]*?)<\/script>/)
      if (!json) throw new Error('media-scorecard-json not found')

      const { criticsScore, audienceScore } = JSON.parse(json[1])
      const page = { critic: toScore(criticsScore?.score), audience: toScore(audienceScore?.score), year: pageYear(body) }

      return { answered: true, page }
    } catch (e) {
      log.warn('Error getting RT scores', { path, error: e })

      return { answered: false }
    }
  }

  // Metascore ships as standard schema.org JSON-LD. A readable page with no Metascore still
  // returns its year, so a wrong-film guess is rejected whether or not it carries a rating.
  async #readMC(path) {
    try {
      const { answered, body } = await this.#fetchText(`${MC_BASE_URL}${path}/`)

      if (!body) return { answered, page: null }

      // Parsed leniently: an unrelated malformed block should not discard a rating we did find
      const titles = [...body.matchAll(LD_JSON)].map(([, block]) => parseJson(block))
        .filter(item => MC_TYPES.includes(item?.['@type']))

      // No whole-title block means this is not the page we think it is, however it answered — a
      // challenge or an interstitial, which is our problem rather than the title's. A block with no
      // rating is different: that is Metacritic saying it has no Metascore yet, which is an answer.
      if (!titles.length) return unanswered(`${MC_BASE_URL}${path}/`, { reason: 'no whole-title block' })

      const rated = titles.find(item => item.aggregateRating?.ratingValue != null)

      return { answered: true, page: { value: toScore(rated?.aggregateRating.ratingValue), year: pageYear(body) } }
    } catch (e) {
      log.warn('Error getting Metacritic score', { path, error: e })

      return { answered: false }
    }
  }

  // Resolution and reading are one step: the page that proves a guess is the right film is the same
  // page that carries its scores. A cached slug is re-verified rather than trusted, which costs
  // nothing — the run fetches both pages for their scores anyway — and writing the record back on
  // every run keeps an in-use slug warm, so they stop expiring together.
  async #resolveSources({ wikiId, title, releaseDate, mediaType }) {
    const key = `slugs/v${SLUG_CACHE_VERSION}/${mediaType}/${wikiId}/${title}/${releaseDate}`
    const cached = await redis.getCache(key)
    const prefixes = PATHS[mediaType] ?? PATHS.movie
    const year = yearOf(releaseDate)
    const wiki = {}
    // True when no lookup was needed: a call never made cannot have gone unanswered
    let wikiAnswered = true

    try {
      // Ask whenever a slug is missing, not only when the record is: a record holding one slug is
      // still truthy, so gating on that alone re-guessed the other one nightly and never recovered
      // the authoritative answer. A record with both slugs skips the call, which is most of them.
      if (wikiId && !(cached?.rt && cached?.mc)) {
        // Its own catch, like the two score readers have. The outer one sits outside the Promise.all
        // below, so a throw here — a second timeout, or a 200 whose body is not JSON — would cost RT
        // and Metacritic as well as the lookup, leaving the title on IMDb and TMDB alone.
        try {
          const { answered, body } = await this.#fetchJson(`${WIKI_BASE_URL}${wikiId}/statements`)

          wikiAnswered = answered
          wiki.rt = body?.[WIKI_RT_PROP]?.[0]?.value?.content
          // Trim it: the reader appends its own, and `movie/inception//` 404s where `movie/inception/` is a hit
          wiki.mc = body?.[WIKI_MC_PROP]?.[0]?.value?.content?.replace(/\/$/, '')
        } catch (e) {
          wikiAnswered = false
          log.warn('Error resolving slugs from Wikidata', { wikiId, error: e })
        }
      }

      const [rt, mc] = await Promise.all([
        this.#resolve(orderCandidates(cached?.rt, cached?.rtSource, wiki.rt, rtGuesses(prefixes.rt, title, year)), year, slug => this.#readRT(slug)),
        this.#resolve(orderCandidates(cached?.mc, cached?.mcSource, wiki.mc, [`${prefixes.mc}${slugify(title, '-')}`]), year, slug => this.#readMC(slug))
      ])

      const record = { rt: rt.slug, mc: mc.slug, rtSource: rt.source, mcSource: mc.source }
      const hostsAnswered = rt.answered && mc.answered
      const haveBothSlugs = Boolean(record.rt && record.mc)

      // Replace the record only once everything that could change it answered. Merging a partial
      // answer into it costs an authoritative slug for good — which is what every attempt to be
      // cleverer here did. A blocked run instead costs one re-resolution.
      //
      // Stricter than the score's own test on purpose, which tolerates `haveBothSlugs`: these slugs
      // are what this run resolved, so storing a guess among them makes both read as present, and
      // the lookup that could still supply the authoritative one is never asked again.
      if (hostsAnswered && wikiAnswered) redis.setCache(key, record, record.rt || record.mc ? SLUG_TTL : SLUG_MISS_TTL)

      // Only RT and Metacritic carry scores, so they alone settle the score. A quiet lookup counts
      // against it only while a slug is still missing, since the one thing it could have supplied
      // is a slug we now already have.
      return { rt, mc, answered: hostsAnswered && (wikiAnswered || haveBothSlugs) }
    } catch (e) {
      log.warn('Error resolving slugs', { title, mediaType, error: e })

      return { answered: false }
    }
  }

  // The first candidate whose page verifies wins. Any 200 used to be accepted, and `m/breach`
  // answers 200 with a confident 2007 film for a 2026 title.
  async #resolve(candidates, year, read) {
    for (const { slug, source } of candidates) {
      const { answered, page } = await read(slug)

      // Ends this host's list: a run that could not read one URL will not read the next either, and
      // N candidates against a rate-limited host cost N waits rather than one. It also protects a
      // stored authoritative slug, which abandoning for a guess on no evidence makes permanent.
      if (!answered) return { answered: false }

      // A 404 is this slug's own verdict, so the next candidate is worth trying
      if (!page) continue

      // Only Wikidata bypasses the check. A year we cannot read must not pass as a year that
      // matched: if a host drops the field, rejecting shows up as a coverage collapse, where
      // trusting would quietly go back to scoring the wrong films.
      if (source === 'wikidata' || (Number.isFinite(year) && page.year === year)) {
        return { answered: true, slug, source, page }
      }

      // An anomaly, not a per-title fact, so log it rather than counting it: the rate is a log query
      log.warn('Slug rejected as a different title', { slug, pageYear: page.year, wantYear: year })
    }

    // Every candidate answered and none was this title: the host has no page for it
    return { answered: true }
  }

  // Sources blip. A single timeout used to drop that source's score for the title and
  // trip the nightly smoke test, so one retry before giving up. Only transient failures
  // qualify: a 4xx is a real answer, and a wrong guess 404s by design.
  async #fetch(url, options) {
    const host = new URL(url).host
    // Spaced per attempt, so a retry queues like any other request
    const send = async () => {
      await space(host, this.throttleMs)
      return fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(FETCH_TIMEOUT), ...options })
    }

    try {
      const res = await send()
      if (res.status < 500) return res

      await discard(res)
    } catch {
      // fall through; if it is not transient the retry throws too and the caller logs it
    }

    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY))
    return await send()
  }

  #fetchText(url) {
    return this.#read(url, res => res.text())
  }

  #fetchJson(url) {
    return this.#read(url, res => res.json())
  }

  // The one distinction every caller needs: did the source answer about this title, or did we fail
  // to ask. A 404 is an answer — there is no such page. Everything else that goes wrong is ours.
  async #read(url, parse) {
    let res = await this.#fetch(url)

    // Only a rate limit is worth waiting out; a 403 says the same thing however long we wait
    if (res.status === 429) {
      const retryAfter = Math.min(parseInt(res.headers.get('retry-after')) || 2, RETRY_AFTER_MAX)

      await discard(res)
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000))
      res = await this.#fetch(url)
    }

    if (!res.ok) {
      await discard(res)

      // Blocks arrive as whatever status a CDN picked — 403, 429, a challenge, even a 2xx — so
      // trust only the two that say the page is gone, and read anything else as prevented
      if (PAGE_NOT_FOUND.has(res.status)) {
        log.warn('Source has no page for this title', { url, status: res.status })

        return { answered: true, body: null }
      }

      return unanswered(url, { status: res.status, statusText: res.statusText })
    }

    const body = await parse(res)

    // An empty body is not a page we can read, whatever the status claimed
    if (!body) return unanswered(url, { status: res.status, reason: 'empty response' })

    return { answered: true, body }
  }
}

// Try cached first, then Wikidata, then guesses. Count a cached slug of unknown source as
// guessed, so a record written before this check is verified rather than trusted. Every entry
// carries a non-empty slug, so the readers do not re-check.
// Exported for its own tests: the ordering rules are the part worth checking without a network.
export function orderCandidates(cachedSlug, cachedSource, wikiSlug, guesses) {
  // Wikidata confirming a cached guess makes it authoritative; leaving it `guessed` would keep it
  // paying a year check it should not, and a re-release date could then reject a correct slug
  const source = cachedSlug === wikiSlug ? 'wikidata' : cachedSource ?? 'guessed'
  const authoritative = cachedSlug && source === 'wikidata' ? [{ slug: cachedSlug, source }] : []
  const list = [...authoritative]

  if (wikiSlug && wikiSlug !== cachedSlug) list.push({ slug: wikiSlug, source: 'wikidata' })

  // A cached guess ranks behind Wikidata: ahead of it, a guess that happens to verify would
  // discard the authoritative answer and then suppress the lookup that could restore it
  if (cachedSlug && !authoritative.length) list.push({ slug: cachedSlug, source })

  for (const slug of guesses) {
    if (!list.some(candidate => candidate.slug === slug)) list.push({ slug, source: 'guessed' })
  }

  return list
}

// A trailing `_<year>` is RT's own disambiguator for a title sharing a name with an older one
function rtGuesses(prefix, title, year) {
  const slug = prefix + slugify(title, '_')

  return Number.isFinite(year) ? [slug, `${slug}_${year}`] : [slug]
}

// Not an answer about the title: a block, a timeout, a proxy error, a challenge page
function unanswered(url, fields) {
  log.warn('Source could not be read', { host: new URL(url).host, ...fields })

  return { answered: false }
}

export default new ScoreService()
