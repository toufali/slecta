// Reference titles catch a source returning wrong numbers.
// Coverage rates catch a source failing broadly while those few titles happen to still pass.
// Either failing logs at ERROR, which is what the Cloud Monitoring alert matches.

import tmdb from '../services/tmdbService.js'
import scoreService, { scoreKey } from '../services/scoreService.js'
import redis from '../services/redisService.js'
import { indexKey, INDEX_VERSION } from '../services/indexService.js'
import log from '../utils/logger.js'

// Points of drift allowed. A dead source returns nothing at all, not a near-miss.
const TOLERANCE = 3

// Settled titles covering movies and TV, so both path prefixes get exercised. Verified 2026-08-19.
const REFERENCE_TITLES = [
  { mediaType: 'movie', tmdbId: 693134, name: 'Dune: Part Two', expected: { imdb: 84, metacritic: 79, rtCritic: 92, rtAudience: 95 } },
  { mediaType: 'movie', tmdbId: 27205, name: 'Inception', expected: { imdb: 88, metacritic: 74, rtCritic: 86, rtAudience: 91 } },
  { mediaType: 'tv', tmdbId: 1396, name: 'Breaking Bad', expected: { imdb: 95, metacritic: 87, rtCritic: 96, rtAudience: 97 } }
]

// Detail fields the page renders; a settled title missing one means TMDB moved a field. Exported so
// a test can hold it against the real record: renamed in one place only, this agrees with itself.
export const REQUIRED_DETAIL = {
  movie: ['title', 'overview', 'cast', 'director', 'runtime', 'rating', 'language', 'genres'],
  tv: ['title', 'overview', 'cast', 'creator', 'seasons', 'rating', 'language', 'genres']
}

// `minResolved` and `maxUnreachable` divide by every title tried; `minScored` divides by the titles
// the source carries, which the vote floor moves far less.
const SOURCE_LIMITS = {
  // IMDb is a local dataset: nothing to reach and no page to be absent from, so only `minResolved` binds
  imdb: { minResolved: 0.9, maxUnreachable: 0.02, minScored: 0.9 },
  metacritic: { minResolved: 0.25, maxUnreachable: 0.02, minScored: 0.55 },
  rtCritic: { minResolved: 0.45, maxUnreachable: 0.02, minScored: 0.55 },
  rtAudience: { minResolved: 0.4, maxUnreachable: 0.02, minScored: 0.55 }
}

// Source rates divide by titles scored, which hides a batch where almost everything failed
const MAX_FAILED_RATE = 0.1

// A title no source could score at all, which is every source failing for it at once
const MAX_UNSCORED_RATE = 0.1

/**
 * Whether a ranked list can be served. Run at deploy, so a row-shape bump fails the build rather than
 * leaving Top Rated to 503 until someone notices — the deploy does not rewrite the rows.
 *
 * Fails closed on an unreadable Redis as well as an absent key. The two are distinguished elsewhere
 * so a blip cannot discard data, but here they are the same answer: the list will not serve. Passing
 * on an outage would also let a flaky read hide a generation nobody published.
 * @return {{ok: boolean, missing: string[], unreadable: string[]}}
 */
export async function checkRankedIndex() {
  const missing = []
  const unreadable = []

  for (const segment of ['movies', 'shows']) {
    const rows = await redis.getCache(indexKey(segment))

    if (rows === undefined) unreadable.push(segment)
    else if (!rows) missing.push(segment)
  }

  // Logged apart, since one says run the job and the other says fix Redis
  if (missing.length) log.error('Ranked list missing, run the scoring job', { missing, version: INDEX_VERSION })
  if (unreadable.length) log.error('Ranked list could not be read', { unreadable, version: INDEX_VERSION })
  if (!missing.length && !unreadable.length) log.info('Ranked list present', { version: INDEX_VERSION })

  return { ok: !missing.length && !unreadable.length, missing, unreadable }
}

/** Score known titles and compare every source against its expected value. */
export async function checkReferenceTitles() {
  const failures = []

  for (const title of REFERENCE_TITLES) {
    // Retried once: a single flaky response from one source should not page anyone
    const attempt = await scoreReferenceTitle(title)

    failures.push(...(attempt.length ? await scoreReferenceTitle(title) : attempt))
  }

  const ok = failures.length === 0
  const summary = failures.map(f => `${f.source} ${f.reason} for ${f.title}`).join('; ')

  if (ok) log.info('Reference titles passed', { titles: REFERENCE_TITLES.length, tolerance: TOLERANCE })
  else log.error('Reference titles FAILED', { summary, titles: REFERENCE_TITLES.length, tolerance: TOLERANCE, failures })

  return { ok, failures }
}

async function scoreReferenceTitle({ mediaType, tmdbId, name, expected }) {
  const failures = []

  // Returned as a failure rather than rethrown, so the caller's retry still applies and a
  // title that stays broken is reported instead of aborting the run.
  let detail
  try {
    detail = mediaType === 'movie'
      ? await tmdb.getMovieDetail(tmdbId)
      : await tmdb.getTvShowDetail(tmdbId)
  } catch (e) {
    return [{ title: name, source: 'tmdb', reason: 'lookup failed', error: e.message }]
  }

  if (!detail) return [{ title: name, source: 'tmdb', reason: 'no detail returned' }]

  for (const field of REQUIRED_DETAIL[mediaType]) {
    if (!detail[field]) failures.push({ title: name, source: field, reason: 'detail field empty' })
  }

  const result = await scoreService.getScore(scoreKey(`checks/${mediaType}`, tmdbId), { ...detail, mediaType }, false)

  for (const [source, want] of Object.entries(expected)) {
    const got = result?.scores?.[source]

    if (got === undefined) failures.push({ title: name, source, want, reason: 'absent' })
    else if (Math.abs(got - want) > TOLERANCE) failures.push({ title: name, source, want, got, reason: 'out of tolerance' })
  }

  return failures
}

/** Judge the run as a whole from the tallies the scoring loop produced. */
export function checkRunCoverage(allStats, imdbRefreshed) {
  const problems = []

  // A failed refresh leaves yesterday's data in place, so every source rate still looks fine
  if (!imdbRefreshed) problems.push({ reason: 'IMDb dataset refresh failed' })

  for (const stats of allStats) {
    if (!stats.processed) {
      problems.push({ mediaType: stats.mediaType, reason: 'nothing processed' })
      continue
    }

    // Scores cached but nothing sortable published is a failed run, not a healthy one
    if (stats.indexFailed) problems.push({ mediaType: stats.mediaType, reason: 'score index not published' })

    // Driven by the limits themselves, so a source cannot be listed for checking without one and
    // then skipped silently, which `rate < undefined` would do
    for (const [source, limits] of Object.entries(SOURCE_LIMITS)) {
      const { unreachable = 0, unscored = 0, scored = 0 } = stats.outcomes?.[source] ?? {}
      const resolvedRate = scored / stats.processed

      if (resolvedRate < limits.minResolved) {
        problems.push({ mediaType: stats.mediaType, source, rate: round(resolvedRate), min: limits.minResolved })
      }

      const unreachableRate = unreachable / stats.processed

      if (unreachableRate > limits.maxUnreachable) {
        problems.push({ mediaType: stats.mediaType, source, reason: 'could not be read', rate: round(unreachableRate), max: limits.maxUnreachable })
      }

      // A denominator of zero fails rather than dividing to NaN, which `< min` would read as a pass
      const carried = scored + unscored
      const scoredRate = carried ? scored / carried : 0

      if (scoredRate < limits.minScored) {
        problems.push({ mediaType: stats.mediaType, source, reason: 'no score on the pages that carry it', rate: round(scoredRate), min: limits.minScored })
      }
    }

    const failedRate = stats.failed / stats.total

    if (failedRate > MAX_FAILED_RATE) {
      problems.push({ mediaType: stats.mediaType, reason: 'titles failed to score', rate: round(failedRate), max: MAX_FAILED_RATE })
    }

    const unscoredRate = stats.unscored / stats.processed

    if (unscoredRate > MAX_UNSCORED_RATE) {
      problems.push({ mediaType: stats.mediaType, reason: 'titles no source could score', rate: round(unscoredRate), max: MAX_UNSCORED_RATE })
    }

    // Scoring can succeed while the Redis write fails, leaving the cache cold but every rate green
    const notCachedRate = stats.notCached / stats.processed

    if (notCachedRate > MAX_FAILED_RATE) {
      problems.push({ mediaType: stats.mediaType, reason: 'scores not persisted', rate: round(notCachedRate), max: MAX_FAILED_RATE })
    }
  }

  const summary = problems.map(p => [p.mediaType, p.source, p.reason ?? `resolved for only ${Math.round(p.rate * 100)}%`].filter(Boolean).join(': ')).join('; ')

  if (problems.length) log.error('Run coverage FAILED', { summary, problems })
  else log.info('Run coverage passed')

  return { ok: problems.length === 0, problems }
}

function round(value) {
  return Math.round(value * 100) / 100
}
