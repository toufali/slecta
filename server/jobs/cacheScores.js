// Refreshes the IMDb dataset, warms score caches across both full catalogues, then verifies.

import tmdb from '../services/tmdbService.js'
import scoreService, { aggregate, scoreKey } from '../services/scoreService.js'
import imdb from '../services/imdbService.js'
import redis, { WRITTEN } from '../services/redisService.js'
import { indexKey, byRank, INDEX_TTL } from '../services/indexService.js'
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

  // One window for the whole walk: a page fetched either side of midnight would be bounded by a
  // different day, shifting titles across page boundaries
  const window = tmdb.dateWindow()

  // An empty batch reports as "nothing processed", which the coverage check already fails
  const [movieList, showList] = await Promise.allSettled([
    listAll(page => tmdb.getMovies({ page }, window), SEGMENT.movie),
    listAll(page => tmdb.getTvShows({ page }, window), SEGMENT.tv)
  ])
  const noTitles = { titles: [], complete: false }

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

// Walk every page TMDB reports; page 1 alone is a fraction of the catalogue.
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

  return { titles: unique, complete }
}

async function publishIndex(mediaType, rows, titles, complete, confirmed) {
  const key = indexKey(SEGMENT[mediaType])
  const walked = new Set(titles.map(title => title.id))

  // Keep a previous row for a title this run could not confirm, whether the walk missed it or its
  // record would not read. Only a complete walk may drop the rest: they left the window.
  const carry = id => !confirmed.has(id) && (!complete || walked.has(id))
  const previous = complete && confirmed.size === walked.size ? [] : await redis.getCache(key)

  // undefined is Redis unreadable, null is no prior index — only the second is safe to publish over
  if (previous === undefined) return log.error('Score index left in place, the previous one could not be read', { mediaType })

  const carried = await carryRows(mediaType, previous ?? [], carry)
  const all = [...rows, ...carried]

  // Leave yesterday's ranking rather than replace it with nothing
  if (!all.length) return log.error('Score index left in place, nothing to publish', { mediaType })

  // TMDB cannot sort on a score it does not hold, and sorting one fetched page would rank a page
  // rather than the catalogue. Stored ranked so a request only filters and slices.
  all.sort(byRank)

  if (await redis.setCache(key, all, INDEX_TTL) === WRITTEN) return true

  log.error('Score index write failed', { mediaType, rows: all.length })
}

// Re-read rather than copied: the record can have expired, and carrying the row renews it
async function carryRows(mediaType, previous, carry) {
  const rows = await Promise.all(previous.filter(row => carry(row.id)).map(async row => {
    const stored = await scoreService.getScoreFromCache(scoreKey(SEGMENT[mediaType], row.id))

    // Unreadable is not gone: keep the row rather than drop a title over a failed read
    if (stored === undefined) return row

    const score = aggregate(stored)

    return score === undefined ? null : { ...row, score }
  }))

  return rows.filter(Boolean)
}

async function cacheScoresFor(mediaType, { titles, complete }) {
  const stats = { mediaType, total: titles.length, processed: 0, failed: 0, notCached: 0, unscored: 0, outcomes: {} }
  const rows = []
  // Ids whose stored record was read, whatever it held. Anything else is a title we cannot speak for
  const confirmed = new Set()

  // Contain the title, not the run: an unhandled throw would reject the pool and skip both checks
  await pool(titles, TITLES_IN_FLIGHT, async title => {
    try {
      const entry = await scoreTitle(mediaType, title, stats, confirmed)

      if (entry) rows.push(entry)
    } catch (e) {
      stats.failed++
      log.warn('Title threw while scoring', { mediaType, id: title.id, error: e })
    }
  })

  stats.indexFailed = !await publishIndex(mediaType, rows, titles, complete, confirmed)

  return stats
}

async function scoreTitle(mediaType, title, stats, confirmed) {
  const key = scoreKey(SEGMENT[mediaType], title.id)

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

  const { imdbId, wikiId, title: name, releaseDate, seasons, cast } = detail
  const score = await scoreService.getScore(key, { imdbId, wikiId, title: name, releaseDate, mediaType, seasons, cast }, false)

  if (!score) {
    stats.failed++
  } else {
    // Tonight's attempt, not what is stored: these rates are the live outage detector
    const sources = Object.keys(score.scores)

    if (!score.cached) stats.notCached++

    if (!sources.length) stats.unscored++

    // Why each source produced what it did, which is what all three coverage rates divide by
    for (const [source, outcome] of Object.entries(score.outcomes ?? {})) {
      const tally = stats.outcomes[source] ??= {}

      tally[outcome] = (tally[outcome] ?? 0) + 1
    }

    stats.processed++
  }

  // The row is whatever storage holds, so it cannot disagree with the detail page
  const row = await scoreService.getScoreFromCache(key)

  // undefined is Redis unreadable, null is no record. Only the second says anything about the title
  if (row === undefined) return

  confirmed.add(title.id)

  const avgScore = aggregate(row)

  // Unscorable titles would sort as NaN
  if (avgScore === undefined) return

  // `score` ranks and the rest filter; the badge is read from the record, never from the row. Ids
  // over names and paths over URLs, since imgConfig and the genre map rebuild those.
  return {
    id: title.id,
    title: title.title,
    posterPath: title.posterPath,
    releaseDate: title.releaseDate,
    genreIds: title.genreIds,
    votes: title.tmdbScoreCount,
    certification: detail.rating,
    providers: detail.providers?.map(provider => provider.provider_id) ?? [],
    originalLanguage: title.originalLanguage,
    score: avgScore
  }
}

// Workers sharing one iterator. Nothing here holds per-title memory, so concurrency costs nothing.
async function pool(items, limit, worker) {
  const queue = items[Symbol.iterator]()

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (const item of queue) await worker(item)
  }))
}
