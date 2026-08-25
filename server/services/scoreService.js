import { average, toScore } from '../utils/math.js'
import { slugify } from '../utils/slug.js'
import redis from './redisService.js'
import imdb from './imdbService.js'
import log from '../utils/logger.js'

const SCORE_TTL = 60 * 60 * 48 // 48 hours
const SCORE_RETRY_TTL = 60 * 60 // 1 hour; rate limits clear in minutes, but a bot block can last a day
const SLUG_TTL = 60 * 60 * 24 * 30 // 30 days
const SLUG_MISS_TTL = 60 * 60 * 24 // 1 day
const FETCH_TIMEOUT = 8000
const RETRY_AFTER_MAX = 5 // seconds; the nightly job has a 180s deadline to respect
const RETRY_DELAY = 500 // ms, before a single retry of a transient failure
const PAGE_NOT_FOUND = new Set([404, 410]) // the source answering about the title; any other failure is ours

// Undici holds the connection until a body is read or cancelled, and every path here
// throws bodies away: probes read only the status, and both readers bail on !ok. A
// sustained outage would otherwise starve the pool. Cleanup must never mask a real error.
const discard = res => res?.body?.cancel().catch(() => {})

// Metacritic scores TV per season too; only whole-title types, so a season page can never pass as the series score.
const MC_TYPES = ['Movie', 'TVSeries']

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
  async getScoreFromCache(key) {
    return await redis.getCache(key)
  }

  async getScore(key, data, tryCache = true) {
    // TODO: a more sophisticated caching strategy
    if (tryCache) {
      const score = await this.getScoreFromCache(key)
      if (score) return score
    }

    if (!data) return log.warn('Score lookup data undefined', { key })

    const { tmdbScore, imdbId, wikiId, title, releaseDate, mediaType = 'movie' } = data

    // Carried down so the write can tell "the title has no RT page" from "RT would not answer"
    const attempt = { incomplete: false }

    try {
      const slugs = await this.#getSlugs(wikiId, title, releaseDate, mediaType, attempt)
      const [imdbScore, rtScores, mcScore] = await Promise.all([
        this.getIMDBScore(imdbId),
        this.getRTScores(slugs?.rt, attempt),
        this.getMetacriticScore(slugs?.mc, attempt)
      ])

      // Omitted rather than nulled, so key count is source count
      const scores = {
        imdb: imdbScore,
        metacritic: mcScore,
        rtCritic: rtScores?.critic,
        rtAudience: rtScores?.audience,
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

  async getIMDBScore(imdbId) {
    const rating = await imdb.getRating(imdbId)
    return rating && Math.round(rating.rating * 10) // adjusted to 100 scale
  }

  // Embedded JSON the page needs to render, so steadier than the markup the old scraper read.
  // A `tv/<slug>` path with no season suffix returns RT's cross-season average, not one season's.
  async getRTScores(path, attempt = {}) {
    if (!path) return

    try {
      const html = await this.#fetchText(RT_BASE_URL + path, attempt)
      if (!html) return

      const json = html.match(/<script[^>]+id="media-scorecard-json"[^>]*>([\s\S]*?)<\/script>/)
      if (!json) throw new Error('media-scorecard-json not found')

      const { criticsScore, audienceScore } = JSON.parse(json[1])

      return { critic: toScore(criticsScore?.score), audience: toScore(audienceScore?.score) }
    } catch (e) {
      attempt.incomplete = true
      log.warn('Error getting RT scores', { path, error: e })
    }
  }

  // Metascore ships as standard schema.org JSON-LD
  async getMetacriticScore(path, attempt = {}) {
    if (!path) return

    try {
      const html = await this.#fetchText(`${MC_BASE_URL}${path}/`, attempt)
      if (!html) return

      const blocks = [...html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
      const titles = blocks.map(([, block]) => JSON.parse(block)).filter(item => MC_TYPES.includes(item['@type']))

      // No whole-title block means this is not the page we think it is, however it answered.
      // A block with no rating is the title's own answer: Metacritic has no Metascore yet.
      if (!titles.length) attempt.incomplete = true

      const rated = titles.find(item => item.aggregateRating?.ratingValue != null)

      return toScore(rated?.aggregateRating.ratingValue)
    } catch (e) {
      attempt.incomplete = true
      log.warn('Error getting Metacritic score', { path, error: e })
    }
  }

  // One Wikidata call yields both slugs; guessing is only a fallback for items it lacks.
  async #getSlugs(wikiId, title, releaseDate, mediaType, attempt) {
    const key = `slugs/${mediaType}/${wikiId}/${title}/${releaseDate}`
    const cached = await redis.getCache(key)

    if (cached) return cached

    const prefixes = PATHS[mediaType] ?? PATHS.movie
    const slugs = {}

    try {
      if (wikiId) {
        const res = await this.#fetchJson(`${WIKI_BASE_URL}${wikiId}/statements`, attempt)
        slugs.rt = res?.[WIKI_RT_PROP]?.[0]?.value?.content
        slugs.mc = res?.[WIKI_MC_PROP]?.[0]?.value?.content
      }

      if (!slugs.rt) slugs.rt = await this.#probe(RT_BASE_URL, this.#rtCandidates(prefixes.rt, title, releaseDate), attempt)
      if (!slugs.mc) slugs.mc = await this.#probe(MC_BASE_URL, [`${prefixes.mc}${slugify(title, '-')}`], attempt, '/')

      // Only cache what a source answered. Storing an unanswered guess would outlive the score's
      // retry window and hand the same thin score a full life on the next rebuild.
      if (!attempt.incomplete) redis.setCache(key, slugs, slugs.rt || slugs.mc ? SLUG_TTL : SLUG_MISS_TTL)
    } catch (e) {
      attempt.incomplete = true
      log.warn('Error resolving slugs', { title, mediaType, error: e })
    }

    return slugs
  }

  #rtCandidates(prefix, title, releaseDate) {
    const slug = prefix + slugify(title, '_')
    const year = new Date(releaseDate).getFullYear()

    return Number.isFinite(year) ? [slug, `${slug}_${year}`] : [slug]
  }

  async #probe(baseUrl, candidates, attempt, suffix = '') {
    const settled = await Promise.allSettled(candidates.map(path =>
      this.#fetch(`${baseUrl}${path}${suffix}`, { method: 'HEAD' })
    ))

    const match = candidates.find((path, i) => settled[i].value?.ok)

    // Only a not-found answer tells us a guessed slug is wrong; anything else went unanswered
    if (!match && settled.some(result => !PAGE_NOT_FOUND.has(result.value?.status))) {
      this.#unreadable(attempt, baseUrl, { reason: 'probe went unanswered' })
    }

    await Promise.all(settled.map(result => discard(result.value)))

    return match
  }

  // Sources blip. A single timeout used to drop that source's score for the title and
  // trip the nightly smoke test, so one retry before giving up. Only transient failures
  // qualify: a 4xx is a real answer, and the slug probes 404 by design.
  async #fetch(url, options) {
    const send = () => fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(FETCH_TIMEOUT), ...options })

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

    return await parse(res)
  }
}

export default new ScoreService()
