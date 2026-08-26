// Refreshes the IMDb dataset, warms score caches across both full catalogues, then verifies.

import tmdb from '../services/tmdbService.js'
import scoreService from '../services/scoreService.js'
import imdb from '../services/imdbService.js'
import log from '../utils/logger.js'
import { checkReferenceTitles, checkRunCoverage } from './checks.js'

// Titles in flight per media type. The per-host spacing decides the request rate, so this only
// has to be high enough to keep each host's queue fed.
const CONCURRENCY = 4

// The cache-key and list-response word for each media type
const SEGMENT = { movie: 'movies', tv: 'shows' }

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

  // Run both at once: they share the same per-host queues either way, so interleaving them costs
  // nothing and the rate is unchanged
  const stats = await Promise.all([
    cacheScoresFor('movie', movieList.value ?? []),
    cacheScoresFor('tv', showList.value ?? [])
  ])

  const coverage = checkRunCoverage(stats, imdbRefreshed)
  const reference = await checkReferenceTitles()

  log.info('cacheScores job complete', { stats, coverageOk: coverage.ok, referenceOk: reference.ok })

  return { stats, coverage, reference }
}

// Page 1 is 20 titles of the 538 movies or 195 shows in the window (measured 2026-08-25), so ask
// TMDB for the rest of its reported pages.
async function listAll(fetchPage, key) {
  const first = await fetchPage(1)
  const titles = [...first[key]]

  for (let page = 2; page <= first.totalPages; page++) {
    try {
      titles.push(...(await fetchPage(page))[key])
    } catch (e) {
      // Skip the page rather than the rest of them, and stay at WARNING: one page is 20 titles of
      // 538, the next run refetches it, and the short-catalogue check below is what needs saying
      log.warn('TMDB list page failed', { key, page, totalPages: first.totalPages, error: e })
    }
  }

  // The window is sorted by release date, so a title added mid-run can land on two pages
  const unique = [...new Map(titles.map(title => [title.id, title])).values()]

  // Scoring a fraction of the catalogue leaves every coverage rate looking healthy, so say it
  // loudly. Counted in titles, not pages, because the last page is a partial one. Negated rather
  // than `<`, so a missing total_results fails too — being unable to verify is not a pass.
  if (!(unique.length >= first.totalResults * 0.9)) {
    log.error('TMDB list came back short', { key, got: unique.length, expected: first.totalResults })
  }

  return unique
}

async function cacheScoresFor(mediaType, titles) {
  const stats = { mediaType, total: titles.length, processed: 0, failed: 0, notCached: 0, tmdbOnly: 0, sources: {} }

  await pool(titles, CONCURRENCY, async title => {
    const key = `${SEGMENT[mediaType]}/${title.id}/score`

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
      return
    }

    const { tmdbScore, imdbId, wikiId, title: name, releaseDate } = detail
    const score = await scoreService.getScore(key, {
      tmdbScore,
      imdbId,
      wikiId,
      title: name,
      releaseDate,
      mediaType
    }, false)

    if (!score) {
      stats.failed++
      return
    }

    const sources = Object.keys(score.scores)

    if (!score.cached) stats.notCached++

    for (const source of sources) stats.sources[source] = (stats.sources[source] ?? 0) + 1
    if (sources.length === 1 && sources[0] === 'tmdb') stats.tmdbOnly++
    stats.processed++
  })

  return stats
}

// Workers pulling from one shared iterator. The old one-at-a-time loop was a Playwright memory
// constraint; plain `fetch` has none, and the host spacing caps the rate whatever this is set to.
async function pool(items, limit, worker) {
  const queue = items[Symbol.iterator]()

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (const item of queue) await worker(item)
  }))
}
