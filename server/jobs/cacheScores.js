// Nightly job: refresh the IMDb dataset, warm score caches for the default movie and TV
// lists, then check the results. Triggered by Cloud Scheduler at midnight.

import tmdb from '../services/tmdbService.js'
import scoreService from '../services/scoreService.js'
import imdb from '../services/imdbService.js'
import log from '../utils/logger.js'
import { runSmokeTest } from './smokeTest.js'

const SOURCES = ['imdb', 'metacritic', 'rtCritic', 'rtAudience', 'tmdb']

// How often each source must resolve across the whole run; the smoke test's few titles can
// pass while the rest fail. Set below observed rates — new releases genuinely lack reviews.
const MIN_SOURCE_RATE = { imdb: 0.9, metacritic: 0.25, rtCritic: 0.25, rtAudience: 0.45, tmdb: 0.95 }

// A score from TMDB alone is the signature of every other source failing
const MAX_TMDB_ONLY_RATE = 0.1

// Source rates divide by titles actually scored, so they stay meaningful when a few titles
// drop out — but that hides a batch where almost everything failed. Checked separately.
const MAX_FAILED_RATE = 0.1

export async function cacheScores() {
  log.info('cacheScores job started')

  // Must run before scoring — every title's IMDb score is read from it
  let imdbRefreshed = true

  try {
    await imdb.refresh()
  } catch (e) {
    imdbRefreshed = false
    log.error('IMDb ratings refresh failed, continuing with the previous dataset', { error: e })
  }

  const [movies, shows] = await Promise.all([
    tmdb.getMovies().then(data => data?.movies ?? []),
    tmdb.getTvShows().then(data => data?.shows ?? [])
  ])

  const stats = [
    await cacheScoresFor('movie', 'movies', movies),
    await cacheScoresFor('tv', 'shows', shows)
  ]

  const coverage = checkCoverage(stats, imdbRefreshed)
  const smoke = await runSmokeTest()

  log.info('cacheScores job complete', { stats, coverageOk: coverage.ok, smokeTestPassed: smoke.passed })

  return { stats, coverage, smoke }
}

async function cacheScoresFor(mediaType, pathSegment, titles) {
  const stats = { mediaType, total: titles.length, processed: 0, failed: 0, notCached: 0, tmdbOnly: 0, sources: {} }

  for (const title of titles) {
    // one at a time, to avoid running out of memory
    const detail = mediaType === 'movie'
      ? await tmdb.getMovieDetail(title.id)
      : await tmdb.getTvShowDetail(title.id)

    if (!detail) {
      stats.failed++
      continue
    }

    const { tmdbScore, imdbId, wikiId, title: name, releaseDate } = detail
    const score = await scoreService.getScore(`${pathSegment}/${title.id}/score`, {
      tmdbScore,
      imdbId,
      wikiId,
      title: name,
      releaseDate,
      mediaType
    }, false)

    if (!score) {
      stats.failed++
      continue
    }

    const sources = Object.keys(score.scores)

    if (!score.cached) stats.notCached++

    for (const source of sources) stats.sources[source] = (stats.sources[source] ?? 0) + 1
    if (sources.length === 1 && sources[0] === 'tmdb') stats.tmdbOnly++
    stats.processed++
  }

  return stats
}

export function checkCoverage(allStats, imdbRefreshed) {
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

  if (problems.length) log.error('Score coverage check FAILED', { problems })
  else log.info('Score coverage check passed')

  return { ok: problems.length === 0, problems }
}

function round(value) {
  return Math.round(value * 100) / 100
}
