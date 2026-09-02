import { average, toCount, toScore } from '../utils/math.js'
import { slugify } from '../utils/slug.js'
import { space } from '../utils/throttle.js'
import redis, { WRITTEN, DECLINED, FAILED } from './redisService.js'
import imdb from './imdbService.js'
import log from '../utils/logger.js'

// Long enough that a title's next scheduled refresh lands inside it: a record expiring before it is
// due to be rewritten leaves the title with no score at all.
export const SCORE_TTL = 60 * 60 * 24 * 10 // 10 days
export const SCORE_RETRY_TTL = 60 * 60 // 1 hour; rate limits clear in minutes, but a bot block can last a day
const SLUG_TTL = 60 * 60 * 24 * 30 // 30 days

// Bump when the record's shape changes. A source leaving the set does not need one: nothing
// tonight can reach it, so nothing holds it against the write that drops it.
const SCORE_CACHE_VERSION = 1

/** `prefix` is the media segment, or a caller's own namespace. */
export const scoreKey = (prefix, id) => `${prefix}/${id}/score/v${SCORE_CACHE_VERSION}`

// Bump when the slug record shape changes. Slug source cannot be backfilled: a cached
// record skips the Wikidata call and every run refreshes its TTL, so an unknown source would stay
// "guessed" forever.
const SLUG_CACHE_VERSION = 1
const SLUG_MISS_TTL = 60 * 60 * 24 // 1 day
const FETCH_TIMEOUT = 8000
const RETRY_AFTER_MAX = 5 // seconds; a host may ask for minutes, and the run has a task timeout to finish inside
const RETRY_DELAY = 500 // ms, before a single retry of a transient failure
const PAGE_NOT_FOUND = new Set([404, 410]) // the source answering about the title; any other failure is ours

// Undici holds the connection until a body is read or cancelled, and every path here
// throws bodies away: probes read only the status, and both readers bail on !ok. A
// sustained outage would otherwise starve the pool. Cleanup must never mask a real error.
const discard = res => res?.body?.cancel().catch(() => {})

const parseJson = value => { try { return JSON.parse(value) } catch { return null } }

// Drop absent keys rather than nulling them: a null source would still read as a source
const defined = obj => Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined))

// Why a source produced no score. Named rather than literal, so a mistyped comparison is a link
// error and not a silent false.
export const UNREACHABLE = 'unreachable' // we could not read the source
export const ABSENT = 'absent' // the source answered and has no page for this title
export const UNSCORED = 'unscored' // the page is there and carries no score of this kind
export const SCORED = 'scored'

// A count of resolved scores cannot tell an outage from a title the source does not carry, and a
// coverage rate that conflates them moves with the catalogue instead of with source health
function sourceOutcome(host, value) {
  if (!host?.answered) return UNREACHABLE
  if (!host.page) return ABSENT

  return value === undefined ? UNSCORED : SCORED
}

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
    if (tryCache) {
      const hit = await this.getScoreFromCache(key)
      if (hit) return hit
    }

    if (!data) return log.warn('Score lookup data undefined', { key })

    const { imdbId, wikiId, title, releaseDate, mediaType = 'movie' } = data

    try {
      const [imdbRating, resolved] = await Promise.all([
        this.#readIMDB(imdbId),
        this.#resolveSources({ wikiId, title, releaseDate, mediaType })
      ])

      const scores = defined({
        imdb: imdbRating?.value,
        metacritic: resolved.mc?.page?.value,
        rtCritic: resolved.rt?.page?.critic,
        rtAudience: resolved.rt?.page?.audience
      })

      // Absent where a source publishes none — RT gives no number for a TV audience score
      const counts = defined({
        imdb: imdbRating?.count,
        metacritic: resolved.mc?.page?.count,
        rtCritic: resolved.rt?.page?.criticCount,
        rtAudience: resolved.rt?.page?.audienceCount
      })

      // The dataset is IMDb's page: unreadable is a failure to ask, a dataset without the title is
      // an answer. Same rule as the fetched sources, so a blip cannot discard a stored score.
      const outcomes = {
        imdb: sourceOutcome({ answered: imdbRating !== undefined, page: imdbRating ?? null }, scores.imdb),
        metacritic: sourceOutcome(resolved.mc, scores.metacritic),
        rtCritic: sourceOutcome(resolved.rt, scores.rtCritic),
        rtAudience: sourceOutcome(resolved.rt, scores.rtAudience)
      }

      const mean = average(Object.values(scores))
      // Round, so the number shown and the number sorted on agree
      // Omit rather than store NaN, which caches as a null that both sorts and renders wrong
      const score = { avgScore: Number.isFinite(mean) ? Math.round(mean) : undefined, scores, counts }

      if (!Number.isFinite(mean)) {
        log.warn('No source resolved a score', { key, title, rt: resolved.rt?.slug, mc: resolved.mc?.slug, imdbId })
      }

      // One question over every source, not just the fetched ones. `resolved.answered` covers what
      // `#resolveSources` reached; an unreadable IMDb dataset is as worth retrying soon as a blocked
      // host, now that the dataset says which of the two a missing rating was.
      const answered = resolved.answered && outcomes.imdb !== UNREACHABLE

      // Expire it soon: a source we could not read may hold a score that is simply unread
      // Cache it anyway, or every visitor re-runs the chain against a host that is already blocking
      if (!answered) log.warn('Score is missing a source it could not read', { key, title })

      // Read here, not before the fetches above: in that window the record can expire, or a request
      // can store a richer one that an unconditional write would then clobber
      const stored = await this.getScoreFromCache(key)
      const lost = Object.keys(stored?.scores ?? {}).filter(source => scores[source] === undefined)
      // A thinner result is a bad night only while a source we lost could not be read. Once one
      // answers, it is the world that changed and the record has to follow.
      const guarded = lost.some(source => outcomes[source] === UNREACHABLE)
      const candidate = { ...score, fetchedAt: Date.now() }

      // Conditional when guarded, so a live record keeps its own clock while a record that vanished
      // is rebuilt rather than left absent
      // Read and write are not atomic, so a writer landing between them can be overwritten. It needs
      // that writer to reach a source this run could not, at the same instant; the cost if it
      // happens is one title thinner until it rebuilds.
      const outcome = await redis.setCache(key, candidate, answered ? SCORE_TTL : SCORE_RETRY_TTL, guarded)
      // Re-read what declined this write, since `stored` predates it
      const kept = outcome === DECLINED ? await this.getScoreFromCache(key) ?? stored : undefined
      const result = outcome === WRITTEN ? candidate : score

      if (kept) {
        log.warn('Score not stored, it lost a source that could not be read', { key, title, lost })
      }

      // Redis holds a record when this write landed or when a live one declined it; a failure holds nothing
      Object.defineProperty(result, 'cached', { value: outcome !== FAILED })
      // What Redis holds, for a caller that must not publish tonight's thinner numbers
      Object.defineProperty(result, 'kept', { value: kept })
      // Tonight's attempt per source, for the coverage check. Not stored: it describes the run.
      Object.defineProperty(result, 'outcomes', { value: outcomes })

      // Return tonight's result, never the stored one, or the nightly check passes while a source is down
      return result
    } catch (e) {
      log.error('Error getting average score', { key, title, error: e })
    }
  }

  // Answered or not, like the fetched sources: the dataset distinguishes holding no rating for the
  // title from not being readable, and only the second is worth asking again soon
  async #readIMDB(imdbId) {
    const rating = await imdb.getRating(imdbId)

    // Passed through, since only the dataset knows which of the two a missing rating was
    if (!rating) return rating

    return { value: Math.round(rating.rating * 10), count: toCount(rating.votes) } // adjusted to 100 scale
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
      const page = {
        critic: toScore(criticsScore?.score),
        audience: toScore(audienceScore?.score),
        criticCount: toCount(criticsScore?.reviewCount),
        audienceCount: toCount(audienceScore?.reviewCount),
        year: pageYear(body)
      }

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

      const rating = titles.find(item => item.aggregateRating?.ratingValue != null)?.aggregateRating

      return { answered: true, page: { value: toScore(rating?.ratingValue), count: toCount(rating?.reviewCount), year: pageYear(body) } }
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
