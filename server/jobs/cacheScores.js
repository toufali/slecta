// Refreshes the IMDb dataset, warms score caches for both default lists, then verifies.

import tmdb from '../services/tmdbService.js'
import scoreService from '../services/scoreService.js'
import imdb from '../services/imdbService.js'
import log from '../utils/logger.js'
import { checkReferenceTitles, checkRunCoverage } from './verify.js'

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

  // Let either list fail without abandoning the run
  // An empty batch reports as "nothing processed", which the coverage check already fails
  const [movieList, showList] = await Promise.allSettled([tmdb.getMovies(), tmdb.getTvShows()])

  if (movieList.reason) log.error('TMDB movie list lookup failed', { error: movieList.reason })
  if (showList.reason) log.error('TMDB show list lookup failed', { error: showList.reason })

  const stats = [
    await cacheScoresFor('movie', 'movies', movieList.value?.movies ?? []),
    await cacheScoresFor('tv', 'shows', showList.value?.shows ?? [])
  ]

  const coverage = checkRunCoverage(stats, imdbRefreshed)
  const reference = await checkReferenceTitles()

  log.info('cacheScores job complete', { stats, coverageOk: coverage.ok, referenceOk: reference.ok })

  return { stats, coverage, reference }
}

async function cacheScoresFor(mediaType, pathSegment, titles) {
  const stats = { mediaType, total: titles.length, processed: 0, failed: 0, notCached: 0, tmdbOnly: 0, sources: {} }

  for (const title of titles) {
    // one at a time, to avoid running out of memory

    // Null means TMDB genuinely has no such title; a throw means the lookup itself failed.
    // Both count as one failed title — neither should abandon the rest of the run.
    let detail
    try {
      detail = mediaType === 'movie'
        ? await tmdb.getMovieDetail(title.id)
        : await tmdb.getTvShowDetail(title.id)
    } catch (e) {
      log.warn('TMDB detail lookup failed', { mediaType, id: title.id, error: e })
    }

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
