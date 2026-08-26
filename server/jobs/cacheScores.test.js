import { test } from 'node:test'
import assert from 'node:assert/strict'

for (const key of ['TMDB_TOKEN', 'TMDB_API_URL', 'GCP_API_URL', 'GCP_API_KEY', 'GCP_SEARCH_ENGINE']) {
  process.env[key] ??= 'test'
}
process.env.REDIS_URL = ''

const { cacheScores } = await import('./cacheScores.js')
const { default: tmdb } = await import('../services/tmdbService.js')
const { default: scoreService } = await import('../services/scoreService.js')
const { default: imdb } = await import('../services/imdbService.js')
const { default: log } = await import('../utils/logger.js')

// Every seam the job leans on, so a test says which one it is exercising and the rest stay quiet.
function stub({ movies = [], shows = [], totalPages = 1, totalResults }) {
  const scored = []
  const originals = [[imdb, 'refresh'], [tmdb, 'getMovies'], [tmdb, 'getTvShows'], [tmdb, 'getMovieDetail'],
    [tmdb, 'getTvShowDetail'], [scoreService, 'getScore']]
    .map(([target, name]) => [target, name, target[name]])

  imdb.refresh = async () => {}
  tmdb.getMovies = async ({ page }) => ({ movies: movies.filter(movie => movie.page === page), totalPages, totalResults: totalResults ?? movies.length })
  tmdb.getTvShows = async ({ page }) => ({ shows: shows.filter(show => show.page === page), totalPages, totalResults: totalResults ?? shows.length })
  tmdb.getMovieDetail = async id => ({ tmdbId: id, title: `movie ${id}`, tmdbScore: 70 })
  tmdb.getTvShowDetail = async id => ({ tmdbId: id, title: `show ${id}`, tmdbScore: 70 })
  scoreService.getScore = async key => {
    scored.push(key)
    // `cached` is non-enumerable on the real record, and its absence counts as a failed write
    return Object.defineProperty({ avgScore: 70, scores: { tmdb: 70, imdb: 80 } }, 'cached', { value: true })
  }

  return { scored, restore: () => originals.forEach(([target, name, value]) => { target[name] = value }) }
}

const movieKeys = scored => scored.filter(key => key.startsWith('movies/')).sort()

// The run has to survive a thrown lookup and report it, not abort before the coverage check
test('a failed list lookup is reported, not fatal', async () => {
  globalThis.fetch = async () => new Response('', { status: 503 })

  const result = await cacheScores()

  assert.deepEqual(result.stats.map(s => s.total), [0, 0])
  assert.equal(result.coverage.ok, false)
  assert.ok(result.coverage.problems.some(p => p.reason === 'nothing processed'))
})

// Scoring page 1 only ranked whatever happened to be newest, which is the bug this fixes
test('every page of the window is scored, not just the first', async () => {
  const movies = [1, 2, 3].flatMap(page => [{ page, id: page * 10, releaseDate: '2026-01-01' }, { page, id: page * 10 + 1, releaseDate: '2026-01-01' }])
  const { scored, restore } = stub({ movies, totalPages: 3 })

  try {
    const { stats: [stats] } = await cacheScores()

    assert.equal(stats.total, 6)
    assert.equal(stats.processed, 6)
    assert.deepEqual(movieKeys(scored), movies.map(movie => `movies/${movie.id}/score`).sort())
  } finally {
    restore()
  }
})

// A title repeated across pages is a real TMDB behaviour: the window is sorted by release date,
// so anything added mid-run shifts the page boundaries
test('a title appearing on two pages is scored once', async () => {
  const movies = [{ page: 1, id: 55, releaseDate: '2026-01-01' }, { page: 2, id: 55, releaseDate: '2026-01-01' }]
  const { scored, restore } = stub({ movies, totalPages: 2 })

  try {
    const { stats: [stats] } = await cacheScores()

    assert.equal(stats.total, 1)
    assert.deepEqual(movieKeys(scored), ['movies/55/score'])
  } finally {
    restore()
  }
})

// One bad page used to abandon every page after it
test('a page that fails does not cost the pages after it', async () => {
  const movies = [{ page: 1, id: 21, releaseDate: '2026-01-01' }, { page: 3, id: 23, releaseDate: '2026-01-01' }]
  const { scored, restore } = stub({ movies, totalPages: 3 })
  const paged = tmdb.getMovies

  tmdb.getMovies = async query => {
    if (query.page === 2) throw new Error('TMDB 503 Service Unavailable')
    return paged(query)
  }

  try {
    const { stats: [stats] } = await cacheScores()

    assert.equal(stats.total, 2, 'page 3 should still have been fetched')
    assert.deepEqual(movieKeys(scored), ['movies/21/score', 'movies/23/score'])
  } finally {
    restore()
  }
})

// Scoring a fraction of the catalogue leaves every coverage rate looking healthy, so it has to
// be loud. The reachable cause is a list object cached before `totalPages` was returned.
test('a catalogue that comes back short is reported at ERROR', async () => {
  const movies = [{ page: 1, id: 31, releaseDate: '2026-01-01' }]
  const { restore } = stub({ movies, totalPages: 1, totalResults: 538 })
  const errors = []
  const realError = log.error

  log.error = (message, fields) => errors.push({ message, fields })

  try {
    await cacheScores()

    const short = errors.find(e => e.message === 'TMDB list came back short')

    assert.ok(short, `expected a short-catalogue error, got ${JSON.stringify(errors.map(e => e.message))}`)
    assert.deepEqual(short.fields, { key: 'movies', got: 1, expected: 538 })
  } finally {
    log.error = realError
    restore()
  }
})

// The reachable cause is a list object cached before the pagination fields existed, which would
// defeat both the page walk and the check above it. The versioned list cache key is the fix; this
// covers the fallback, because being unable to verify completeness must not read as complete.
test('a list with no pagination metadata is reported, not treated as complete', async () => {
  const movies = [{ page: 1, id: 41, releaseDate: '2026-01-01' }]
  const { restore } = stub({ movies })
  const errors = []
  const realError = log.error

  tmdb.getMovies = async () => ({ movies }) // no totalPages, no totalResults
  log.error = (message, fields) => errors.push({ message, fields })

  try {
    await cacheScores()

    assert.ok(errors.some(e => e.message === 'TMDB list came back short'),
      `expected a short-catalogue error, got ${JSON.stringify(errors.map(e => e.message))}`)
  } finally {
    log.error = realError
    restore()
  }
})
