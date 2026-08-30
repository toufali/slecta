// Refreshes the IMDb dataset, warms score caches across both full catalogues, then verifies.

import tmdb from '../services/tmdbService.js'
import scoreService from '../services/scoreService.js'
import imdb from '../services/imdbService.js'
import redis from '../services/redisService.js'
import log from '../utils/logger.js'
import { checkReferenceTitles, checkRunCoverage } from './checks.js'

// Spacing sets the request rate, so this only has to keep each host's queue fed through a stall
const TITLES_IN_FLIGHT = 8

// The plural each media type goes by, in cache keys and in TMDB's own list responses
const SEGMENT = { movie: 'movies', tv: 'shows' }

const TMDB_PAGE_SIZE = 20

// How far the distinct-title count may fall below what TMDB promised before the walk counts as
// incomplete. A title added while we page through shifts a row onto the next page, arriving twice.
const MAX_MISSING_TITLES = 5

// Outlasts a missed run plus the next run's own duration, so the sort is never left empty
const INDEX_TTL = 60 * 60 * 72 // 72 hours

// Share of the catalogue a ranking needs to be worth publishing. Proportional, not the absolute
// duplicate tolerance above: a ranking short six titles of 538 is still a ranking, and mirrors the
// coverage check's own 10% failure limit from the other side.
const MIN_INDEX_COVERAGE = 0.9

// The deploy runs the checks only, so a row-shape change is not rewritten until the nightly run.
// Without this, the first serving deploy after one reads the previous generation for a day.
const INDEX_VERSION = 1

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
  const noTitles = { titles: [], expected: NaN, complete: false }

  if (movieList.reason) log.error('TMDB movie list lookup failed', { error: movieList.reason })
  if (showList.reason) log.error('TMDB show list lookup failed', { error: showList.reason })

  // Interleaved because they share the per-host queues anyway; settled so one cannot discard the other
  const scored = await Promise.allSettled([
    cacheScoresFor('movie', movieList.value ?? noTitles),
    cacheScoresFor('tv', showList.value ?? noTitles)
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
async function listAll(fetchPage, resultsKey) {
  const first = await fetchPage(1)
  const titles = [...first[resultsKey]]

  for (let page = 2; page <= first.totalPages; page++) {
    try {
      titles.push(...(await fetchPage(page))[resultsKey])
    } catch (e) {
      log.warn('TMDB list page failed', { resultsKey, page, totalPages: first.totalPages, error: e })
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

  const expected = verifiable ? Math.min(totalResults, totalPages * TMDB_PAGE_SIZE) : NaN

  const complete = unique.length >= expected - MAX_MISSING_TITLES

  if (!complete) log.error('TMDB list came back short', { resultsKey, got: unique.length, totalPages, totalResults })

  return { titles: unique, expected, complete }
}

// Three unrelated ways a run fails to earn a ranking, each with its own tolerance and its own
// reason in the log. Named rather than inlined: this condition has been rewritten five times and
// twice lost a clause silently.
function unpublishable({ rows, expected, complete }) {
  if (!complete) return 'the catalogue walk was short'
  if (!rows) return 'nothing scored'
  if (!(rows >= expected * MIN_INDEX_COVERAGE)) return 'too few titles scored'
}

async function publishIndex(mediaType, rows) {
  // TMDB cannot sort on a score it does not hold, and sorting one fetched page would rank 20 of 733.
  // Stored ranked so a request only filters and slices. Votes break the ~7-way ties per point, then
  // id, so an order does not reshuffle nightly on the pool's finish order alone.
  rows.sort((a, b) => b.score - a.score || b.votes - a.votes || a.id - b.id)

  if (await redis.setCache(`index/${SEGMENT[mediaType]}/v${INDEX_VERSION}`, rows, INDEX_TTL)) return true

  log.error('Score index write failed', { mediaType, rows: rows.length })
}

async function cacheScoresFor(mediaType, { titles, expected, complete }) {
  // `probed` counts guesses accepted, at most one per host per title; `rejected` counts candidates
  // refused, which can be several for one title. So the ratio tracks refusals against acceptances,
  // not a per-title false-positive rate. A jump means a host changed its slug scheme or its markup.
  const stats = { mediaType, total: titles.length, processed: 0, failed: 0, notCached: 0, tmdbOnly: 0, sources: {}, slugs: { probed: 0, rejected: 0 } }
  const rows = []

  // Contain the title, not the run: an unhandled throw would reject the pool and skip both checks
  await pool(titles, TITLES_IN_FLIGHT, async title => {
    try {
      const entry = await scoreTitle(mediaType, title, stats)

      if (entry) rows.push(entry)
    } catch (e) {
      stats.failed++
      log.warn('Title threw while scoring', { mediaType, id: title.id, error: e })
    }
  })

  const blocked = unpublishable({ rows: rows.length, expected, complete })

  if (blocked) {
    stats.indexFailed = true
    log.warn('Score index left in place', { mediaType, blocked, rows: rows.length, expected })
  } else {
    stats.indexFailed = !await publishIndex(mediaType, rows)
  }

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
  const score = await scoreService.getScore(key, { tmdbScore, imdbId, wikiId, title: name, releaseDate, mediaType }, false, stats.slugs)

  if (!score) {
    stats.failed++
    return
  }

  const sources = Object.keys(score.scores)

  if (!score.cached) stats.notCached++

  for (const source of sources) stats.sources[source] = (stats.sources[source] ?? 0) + 1
  if (sources.length === 1 && sources[0] === 'tmdb') stats.tmdbOnly++
  stats.processed++

  // Unscorable titles would sort as NaN
  if (!Number.isFinite(score.avgScore)) return

  // Ids over names and paths over URLs, since imgConfig and the genre map rebuild those. Source
  // names, not a count: RT contributes two keys, so a count hides outlets and critic presence.
  return {
    id: title.id,
    title: title.title,
    posterPath: title.posterPath,
    releaseDate: title.releaseDate,
    genreIds: title.genreIds,
    votes: title.tmdbScoreCount,
    certification: detail.rating,
    providers: detail.providers?.map(provider => provider.provider_id) ?? [],
    score: score.avgScore,
    sources
  }
}

// Workers sharing one iterator. The old serial loop was a Playwright memory constraint; fetch has none.
async function pool(items, limit, worker) {
  const queue = items[Symbol.iterator]()

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (const item of queue) await worker(item)
  }))
}
