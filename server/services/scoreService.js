import { average, toScore } from '../utils/math.js'
import { slugify } from '../utils/slug.js'
import { space } from '../utils/throttle.js'
import redis from './redisService.js'
import imdb from './imdbService.js'
import log from '../utils/logger.js'

const SCORE_TTL = 60 * 60 * 48 // 48 hours
const SCORE_RETRY_TTL = 60 * 60 // 1 hour; rate limits clear in minutes, but a bot block can last a day
const SLUG_TTL = 60 * 60 * 24 * 30 // 30 days

// Bump when the slug record shape changes. Provenance cannot be backfilled: a cached record skips
// the Wikidata call, so an unknown source would stay "probed" for as long as the record is rewritten.
const SLUG_CACHE_VERSION = 1
const SLUG_MISS_TTL = 60 * 60 * 24 // 1 day
const FETCH_TIMEOUT = 8000
const RETRY_AFTER_MAX = 5 // seconds; the nightly job has a 180s deadline to respect
const RETRY_DELAY = 500 // ms, before a single retry of a transient failure
const PAGE_NOT_FOUND = new Set([404, 410]) // the source answering about the title; any other failure is ours

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
function pageYear(html) {
  for (const [, block] of html.matchAll(LD_JSON)) {
    const item = parseJson(block)

    if (MC_TYPES.includes(item?.['@type'])) return new Date(item.dateCreated).getFullYear()
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

  async getScore(key, data, tryCache = true, slugs = { probed: 0, rejected: 0 }) {
    // TODO: a more sophisticated caching strategy
    if (tryCache) {
      const score = await this.getScoreFromCache(key)
      if (score) return score
    }

    if (!data) return log.warn('Score lookup data undefined', { key })

    const { tmdbScore, imdbId, wikiId, title, releaseDate, mediaType = 'movie' } = data

    // Carried down so the write can tell "the title has no RT page" from "RT would not answer".
    // Anything that drops a source for our reasons sets it, and both cache writes below read it.
    const attempt = { incomplete: false }

    try {
      const [imdbScore, resolved] = await Promise.all([
        this.getIMDBScore(imdbId),
        this.#resolveSources({ wikiId, title, releaseDate, mediaType }, attempt, slugs)
      ])

      // Omitted rather than nulled, so key count is source count
      const scores = {
        imdb: imdbScore,
        metacritic: resolved.mc?.page.value,
        rtCritic: resolved.rt?.page.critic,
        rtAudience: resolved.rt?.page.audience,
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
        log.warn('Score resolved from TMDB alone', { key, title, slugs, imdbId })
      }

      // Expire it soon: a blocked or timed-out source may hold a score we simply could not read
      // Cache it anyway, or every visitor re-runs the chain against a host that is already blocking
      if (attempt.incomplete) log.warn('Score is missing a source it could not read', { key, title })

      // Awaited so a failed write is visible: setCache hides Redis errors, and the job must not report a cache it never wrote.
      // `cached` mirrors getCache's `cacheHit` flag.
      const cached = await redis.setCache(key, score, attempt.incomplete ? SCORE_RETRY_TTL : SCORE_TTL)

      Object.defineProperty(score, 'cached', { value: Boolean(cached) })

      return score
    } catch (e) {
      log.error('Error getting average score', { key, title, error: e })
    }
  }

  // No `attempt` here: a missing dataset reads the same however soon we ask again, and only the
  // nightly refresh can fix it — which alerts on its own
  async getIMDBScore(imdbId) {
    const rating = await imdb.getRating(imdbId)
    return rating && Math.round(rating.rating * 10) // adjusted to 100 scale
  }

  // Embedded JSON the page needs to render, so steadier than the markup the old scraper read.
  // A `tv/<slug>` path with no season suffix returns RT's cross-season average, not one season's.
  async getRTScores(path, attempt = {}) {
    const page = await this.#readRT(path, attempt)

    return page && { critic: page.critic, audience: page.audience }
  }

  // Return the year alongside the scores, so one GET both verifies a guess and reads it
  async #readRT(path, attempt) {
    if (!path) return

    try {
      const html = await this.#fetchText(RT_BASE_URL + path, attempt)
      if (!html) return

      const json = html.match(/<script[^>]+id="media-scorecard-json"[^>]*>([\s\S]*?)<\/script>/)
      if (!json) throw new Error('media-scorecard-json not found')

      const { criticsScore, audienceScore } = JSON.parse(json[1])

      return { critic: toScore(criticsScore?.score), audience: toScore(audienceScore?.score), year: pageYear(html) }
    } catch (e) {
      attempt.incomplete = true
      log.warn('Error getting RT scores', { path, error: e })
    }
  }

  // Metascore ships as standard schema.org JSON-LD
  async getMetacriticScore(path, attempt = {}) {
    const page = await this.#readMC(path, attempt)

    return page?.value
  }

  // Undefined only when the page could not be read; a readable page with no Metascore still
  // returns its year, so a wrong-film guess is rejected whether or not it carries a rating
  async #readMC(path, attempt) {
    if (!path) return

    try {
      const html = await this.#fetchText(`${MC_BASE_URL}${path}/`, attempt)
      if (!html) return

      // Parsed leniently: an unrelated malformed block should not discard a rating we did find
      const titles = [...html.matchAll(LD_JSON)].map(([, block]) => parseJson(block))
        .filter(item => MC_TYPES.includes(item?.['@type']))

      // No whole-title block means this is not the page we think it is, however it answered.
      // A block with no rating is the title's own answer: Metacritic has no Metascore yet.
      if (!titles.length) attempt.incomplete = true

      const rated = titles.find(item => item.aggregateRating?.ratingValue != null)

      return { value: toScore(rated?.aggregateRating.ratingValue), year: pageYear(html) }
    } catch (e) {
      attempt.incomplete = true
      log.warn('Error getting Metacritic score', { path, error: e })
    }
  }

  // Resolution and reading are one step: the page that proves a guess is the right film is the same
  // page that carries its scores. A cached slug is re-verified rather than trusted, which costs
  // nothing — the run fetches both pages for their scores anyway — and writing the record back on
  // every run keeps an in-use slug warm, so they stop expiring together.
  async #resolveSources({ wikiId, title, releaseDate, mediaType }, attempt, slugs) {
    const key = `slugs/v${SLUG_CACHE_VERSION}/${mediaType}/${wikiId}/${title}/${releaseDate}`
    const cached = await redis.getCache(key)
    const prefixes = PATHS[mediaType] ?? PATHS.movie
    const year = new Date(releaseDate).getFullYear()

    // Local, because Wikidata going quiet costs nothing if a guess resolves the slug anyway
    const lookup = { incomplete: false }
    const wiki = {}

    try {
      // Ask whenever a slug is missing, not only when the record is: a record holding one slug is
      // still truthy, so gating on that alone re-guessed the other one nightly and never recovered
      // the authoritative answer. A record with both slugs skips the call, which is most of them.
      if (wikiId && !(cached?.rt && cached?.mc)) {
        const res = await this.#fetchJson(`${WIKI_BASE_URL}${wikiId}/statements`, lookup)

        wiki.rt = res?.[WIKI_RT_PROP]?.[0]?.value?.content
        // Trim it: the reader appends its own, and `movie/inception//` 404s where `movie/inception/` is a hit
        wiki.mc = res?.[WIKI_MC_PROP]?.[0]?.value?.content?.replace(/\/$/, '')
      }

      const [rt, mc] = await Promise.all([
        this.#resolve(this.#candidates(cached?.rt, cached?.rtSource, wiki.rt, this.#rtGuesses(prefixes.rt, title, year)), year, slug => this.#readRT(slug, attempt), slugs),
        this.#resolve(this.#candidates(cached?.mc, cached?.mcSource, wiki.mc, [`${prefixes.mc}${slugify(title, '-')}`]), year, slug => this.#readMC(slug, attempt), slugs)
      ])
      const record = { rt: rt?.slug, mc: mc?.slug, rtSource: rt?.source, mcSource: mc?.source }

      // A slug still missing after something went unanswered is unknown, not absent, so the
      // score it feeds is short a source and neither result is worth storing
      if (lookup.incomplete && (!record.rt || !record.mc)) attempt.incomplete = true
      else redis.setCache(key, record, record.rt || record.mc ? SLUG_TTL : SLUG_MISS_TTL)

      return { rt, mc }
    } catch (e) {
      attempt.incomplete = true
      log.warn('Error resolving slugs', { title, mediaType, error: e })

      return {}
    }
  }

  // Try cached first, then Wikidata, then guesses. Count a cached slug of unknown provenance as
  // probed, so a record written before this check is verified rather than trusted.
  #candidates(cachedSlug, cachedSource, wikiSlug, guesses) {
    // Wikidata confirming a cached guess makes it authoritative; leaving it `probed` would keep it
    // paying a year check it should not, and a re-release date could then reject a correct slug
    const cached = cachedSlug === wikiSlug ? 'wikidata' : cachedSource ?? 'probed'
    const list = cachedSlug ? [{ slug: cachedSlug, source: cached }] : []

    if (wikiSlug && wikiSlug !== cachedSlug) list.push({ slug: wikiSlug, source: 'wikidata' })

    for (const slug of guesses) {
      if (!list.some(candidate => candidate.slug === slug)) list.push({ slug, source: 'probed' })
    }

    return list
  }

  // The first candidate whose page verifies wins. Any 200 used to be accepted, and `m/breach`
  // answers 200 with a confident 2007 film for a 2026 title.
  async #resolve(candidates, year, read, slugs) {
    let rejected = false

    for (const { slug, source } of candidates) {
      const page = await read(slug)

      if (!page) continue

      // Only Wikidata bypasses the check. A year we cannot read must not pass as a year that
      // matched: if a host drops the field, rejecting shows up as a rate collapse and a spike in
      // `rejected`, where trusting would quietly go back to scoring the wrong films.
      if (source === 'wikidata' || (Number.isFinite(year) && page.year === year)) {
        if (source === 'probed') slugs.probed++

        return { slug, source, page, rejected }
      }

      rejected = true
      slugs.rejected++
    }
  }

  #rtGuesses(prefix, title, year) {
    const slug = prefix + slugify(title, '_')

    return Number.isFinite(year) ? [slug, `${slug}_${year}`] : [slug]
  }

  // Sources blip. A single timeout used to drop that source's score for the title and
  // trip the nightly smoke test, so one retry before giving up. Only transient failures
  // qualify: a 4xx is a real answer, and the slug probes 404 by design.
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

  // Returns undefined like any other miss; the flag is what shortens the record's life
  #unreadable(attempt, url, fields) {
    attempt.incomplete = true
    log.warn('Source could not be read', { host: new URL(url).host, ...fields })
  }

  #fetchText(url, attempt) {
    return this.#read(url, attempt, res => res.text())
  }

  #fetchJson(url, attempt) {
    return this.#read(url, attempt, res => res.json())
  }

  // An unreadable source reads as a miss to the caller, but is flagged so the record expires sooner
  async #read(url, attempt, parse) {
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
      if (PAGE_NOT_FOUND.has(res.status)) return log.warn('Source has no page for this title', { url, status: res.status })

      return this.#unreadable(attempt, url, { status: res.status, statusText: res.statusText })
    }

    const body = await parse(res)

    // An empty body is not a page we can read, whatever the status claimed
    if (!body) return this.#unreadable(attempt, url, { status: res.status, reason: 'empty response' })

    return body
  }
}

export default new ScoreService()
