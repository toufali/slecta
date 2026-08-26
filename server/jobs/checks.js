// Reference titles catch a source returning wrong numbers.
// Coverage rates catch a source failing broadly while those few titles happen to still pass.
// Either failing logs at ERROR, which is what the Cloud Monitoring alert matches.

import tmdb from '../services/tmdbService.js'
import scoreService from '../services/scoreService.js'
import log from '../utils/logger.js'

// Points of drift allowed. A dead source returns nothing at all, not a near-miss.
const TOLERANCE = 3

// Settled titles covering movies and TV, so both path prefixes get exercised. Verified 2026-08-19.
const REFERENCE_TITLES = [
  { mediaType: 'movie', tmdbId: 693134, name: 'Dune: Part Two', expected: { imdb: 84, metacritic: 79, rtCritic: 92, rtAudience: 95 } },
  { mediaType: 'movie', tmdbId: 27205, name: 'Inception', expected: { imdb: 88, metacritic: 74, rtCritic: 86, rtAudience: 91 } },
  { mediaType: 'tv', tmdbId: 1396, name: 'Breaking Bad', expected: { imdb: 95, metacritic: 87, rtCritic: 96, rtAudience: 97 } }
]

// Detail fields the page renders. A settled title missing one means TMDB moved a field
const REQUIRED_DETAIL = {
  movie: ['title', 'overview', 'cast', 'director', 'runtime', 'rating', 'languages', 'genres'],
  tv: ['title', 'overview', 'cast', 'creator', 'seasons', 'rating', 'languages', 'genres']
}

const SOURCES = ['imdb', 'metacritic', 'rtCritic', 'rtAudience', 'tmdb']

// Set below observed rates: new releases genuinely lack critic reviews
const MIN_SOURCE_RATE = { imdb: 0.9, metacritic: 0.25, rtCritic: 0.25, rtAudience: 0.45, tmdb: 0.95 }

// A score from TMDB alone is the signature of every other source failing
const MAX_TMDB_ONLY_RATE = 0.1

// Source rates divide by titles scored, which hides a batch where almost everything failed
const MAX_FAILED_RATE = 0.1

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

  const result = await scoreService.getScore(`checks/${mediaType}/${tmdbId}`, { ...detail, mediaType }, false)

  for (const [source, want] of Object.entries(expected)) {
    const got = result?.scores?.[source]

    if (got === undefined) failures.push({ title: name, source, want, reason: 'absent' })
    else if (Math.abs(got - want) > TOLERANCE) failures.push({ title: name, source, want, got, reason: 'out of tolerance' })
  }

  // TMDB drifts too much to pin a value, but a dropped component should still fail
  if (result?.scores?.tmdb === undefined) failures.push({ title: name, source: 'tmdb', reason: 'absent' })

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

    for (const source of SOURCES) {
      const rate = (stats.sources[source] ?? 0) / stats.processed
      const min = MIN_SOURCE_RATE[source]

      if (rate < min) problems.push({ mediaType: stats.mediaType, source, rate: round(rate), min })
    }

    const tmdbOnlyRate = stats.tmdbOnly / stats.processed

    if (tmdbOnlyRate > MAX_TMDB_ONLY_RATE) {
      problems.push({ mediaType: stats.mediaType, reason: 'aggregates built from TMDB alone', rate: round(tmdbOnlyRate), max: MAX_TMDB_ONLY_RATE })
    }

    const failedRate = stats.failed / stats.total

    if (failedRate > MAX_FAILED_RATE) {
      problems.push({ mediaType: stats.mediaType, reason: 'titles failed to score', rate: round(failedRate), max: MAX_FAILED_RATE })
    }

    // Scoring can succeed while the Redis write fails, leaving the cache cold but every rate green
    const notCachedRate = stats.notCached / stats.processed

    if (notCachedRate > MAX_FAILED_RATE) {
      problems.push({ mediaType: stats.mediaType, reason: 'scores not persisted', rate: round(notCachedRate), max: MAX_FAILED_RATE })
    }
  }

  const summary = problems.map(p => [p.mediaType, p.reason ?? `${p.source} resolved for only ${Math.round(p.rate * 100)}%`].filter(Boolean).join(': ')).join('; ')

  if (problems.length) log.error('Run coverage FAILED', { summary, problems })
  else log.info('Run coverage passed')

  return { ok: problems.length === 0, problems }
}

function round(value) {
  return Math.round(value * 100) / 100
}
