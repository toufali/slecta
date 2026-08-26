// Refreshes the IMDb dataset, warms score caches across both full catalogues, then verifies.

import tmdb from '../services/tmdbService.js'
import scoreService from '../services/scoreService.js'
import imdb from '../services/imdbService.js'
import log from '../utils/logger.js'
import { checkReferenceTitles, checkRunCoverage } from './checks.js'

// Only has to keep each host's queue fed, since spacing sets the rate: an 8s stall opens ~16 slots
const CONCURRENCY = 8

const SEGMENT = { movie: 'movies', tv: 'shows' }

const TMDB_PAGE_SIZE = 20

// Distinct titles a mid-walk insertion can duplicate away, shifting one row onto the next page
const INSERTION_SLACK = 5

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

  // An empty batch reports as "nothing processed", which the coverage check already fails
  const [movieList, showList] = await Promise.allSettled([
    listAll(page => tmdb.getMovies({ page }), SEGMENT.movie),
    listAll(page => tmdb.getTvShows({ page }), SEGMENT.tv)
  ])

  if (movieList.reason) log.error('TMDB movie list lookup failed', { error: movieList.reason })
  if (showList.reason) log.error('TMDB show list lookup failed', { error: showList.reason })

  // Interleaved because they share the per-host queues anyway; settled so one cannot discard the other
  const scored = await Promise.allSettled([
    cacheScoresFor('movie', movieList.value ?? []),
    cacheScoresFor('tv', showList.value ?? [])
  ])

  for (const result of scored) {
    if (result.reason) log.error('Scoring a catalogue threw', { error: result.reason })
  }

  const stats = scored.map(result => result.value).filter(Boolean)

  const coverage = checkRunCoverage(stats, imdbRefreshed)
  const reference = await checkReferenceTitles()

  log.info('cacheScores job complete', { stats, coverageOk: coverage.ok, referenceOk: reference.ok })

  return { stats, coverage, reference }
}

// Walk every page TMDB reports; page 1 alone is 20 titles of 538 movies or 195 shows.
async function listAll(fetchPage, key) {
  const first = await fetchPage(1)
  const titles = [...first[key]]

  for (let page = 2; page <= first.totalPages; page++) {
    try {
      titles.push(...(await fetchPage(page))[key])
    } catch (e) {
      log.warn('TMDB list page failed', { key, page, totalPages: first.totalPages, error: e })
    }
  }

  // The window is sorted by release date, so a title added mid-run can land on two pages
  const unique = [...new Map(titles.map(title => [title.id, title])).values()]
  const { totalPages, totalResults } = first

  // A fraction of the catalogue leaves every coverage rate looking healthy. Judged on distinct
  // titles, since a duplicate row is not a scored title, and on the reach of the walk, since
  // totalPages stops at pageMax while totalResults does not. Metadata that is not a number fails
  // too: absent caches as null, and multiplying that out would produce an expectation of zero.
  const verifiable = Number.isFinite(totalPages) && Number.isFinite(totalResults)

  if (!verifiable || unique.length < Math.min(totalResults, totalPages * TMDB_PAGE_SIZE) - INSERTION_SLACK) {
    log.error('TMDB list came back short', { key, got: unique.length, totalPages, totalResults })
  }

  return unique
}

async function cacheScoresFor(mediaType, titles) {
  const stats = { mediaType, total: titles.length, processed: 0, failed: 0, notCached: 0, tmdbOnly: 0, sources: {} }

  // Contain the title, not the run: an unhandled throw would reject the pool and skip both checks
  await pool(titles, CONCURRENCY, async title => {
    try {
      await scoreTitle(mediaType, title, stats)
    } catch (e) {
      stats.failed++
      log.warn('Title threw while scoring', { mediaType, id: title.id, error: e })
    }
  })

  return stats
}

async function scoreTitle(mediaType, title, stats) {
  const key = `${SEGMENT[mediaType]}/${title.id}/score`

  // Null means TMDB has no such title; a throw means the lookup failed. Both count as one failure.
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
    return
  }

  const { tmdbScore, imdbId, wikiId, title: name, releaseDate } = detail
  const score = await scoreService.getScore(key, { tmdbScore, imdbId, wikiId, title: name, releaseDate, mediaType }, false)

  if (!score) {
    stats.failed++
    return
  }

  const sources = Object.keys(score.scores)

  if (!score.cached) stats.notCached++

  for (const source of sources) stats.sources[source] = (stats.sources[source] ?? 0) + 1
  if (sources.length === 1 && sources[0] === 'tmdb') stats.tmdbOnly++
  stats.processed++
}

// Workers sharing one iterator. The old serial loop was a Playwright memory constraint; fetch has none.
async function pool(items, limit, worker) {
  const queue = items[Symbol.iterator]()

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (const item of queue) await worker(item)
  }))
}
