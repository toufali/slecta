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
const { default: redis } = await import('../services/redisService.js')

// Every seam the job leans on, so a test says which one it is exercising and the rest stay quiet.
function stub({ movies = [], shows = [], totalPages = 1, totalResults }) {
  const scored = []
  const originals = [[imdb, 'refresh'], [tmdb, 'getMovies'], [tmdb, 'getTvShows'], [tmdb, 'getMovieDetail'],
    [tmdb, 'getTvShowDetail'], [scoreService, 'getScore']]
    .map(([target, name]) => [target, name, target[name]])

  imdb.refresh = async () => {}
  tmdb.getMovies = async ({ page }) => ({ movies: movies.filter(movie => movie.page === page), totalPages, totalResults: totalResults ?? movies.length })
  tmdb.getTvShows = async ({ page }) => ({ shows: shows.filter(show => show.page === page), totalPages, totalResults: totalResults ?? shows.length })
  tmdb.getMovieDetail = async id => ({ tmdbId: id, title: `movie ${id}`, tmdbScore: 70, rating: 'PG-13', providers: [{ provider_id: 8 }] })
  tmdb.getTvShowDetail = async id => ({ tmdbId: id, title: `show ${id}`, tmdbScore: 70, rating: 'TV-14', providers: [{ provider_id: 8 }] })
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

// Scoring a fraction of the catalogue leaves every coverage rate looking healthy, so it has to be
// loud. Judged on distinct titles, since a duplicate row is not a scored title.
test('a catalogue that comes back short is reported at ERROR', async () => {
  const movies = [{ page: 1, id: 31, releaseDate: '2026-01-01' }]
  const { restore } = stub({ movies, totalPages: 3, totalResults: 60 })
  const errors = []
  const realError = log.error

  log.error = (message, fields) => errors.push({ message, fields })

  try {
    await cacheScores()

    const short = errors.find(e => e.message === 'TMDB list came back short')

    assert.ok(short, `expected a short-catalogue error, got ${JSON.stringify(errors.map(e => e.message))}`)
    assert.deepEqual(short.fields, { resultsKey: 'movies', got: 1, totalPages: 3, totalResults: 60 })
  } finally {
    log.error = realError
    restore()
  }
})

// totalPages is clamped to pageMax and totalResults is not, so a window wider than 500 pages would
// report short every run once `vote_count.gte` drops
test('a window wider than the page cap does not report short', async () => {
  // A full page each, since the clamp is expressed in TMDB's page size
  const movies = [1, 2].flatMap(page => Array.from({ length: 20 }, (_, i) => ({ page, id: page * 100 + i, releaseDate: '2026-01-01' })))
  const { restore } = stub({ movies, totalPages: 2, totalResults: 100000 })
  const errors = []
  const realError = log.error

  log.error = (message, fields) => errors.push({ message, fields })

  try {
    await cacheScores()

    const short = errors.filter(e => e.message === 'TMDB list came back short' && e.fields.resultsKey === 'movies')

    assert.deepEqual(short, [], 'the reachable page count, not the raw total, is what the walk can deliver')
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

// One unexpected throw used to reject the pool, which lost the run and both checks with it
test('a title that throws is counted, and the run still finishes', async () => {
  const movies = [1, 2, 3].map(id => ({ page: 1, id, releaseDate: '2026-01-01' }))
  const { restore } = stub({ movies })
  const realGetScore = scoreService.getScore

  scoreService.getScore = async key => {
    if (key === 'movies/2/score') throw new TypeError('unexpected')
    return Object.defineProperty({ avgScore: 70, scores: { tmdb: 70 } }, 'cached', { value: true })
  }

  try {
    const { stats: [stats], coverage, reference } = await cacheScores()

    assert.equal(stats.processed, 2)
    assert.equal(stats.failed, 1, 'the throwing title should count as one failure')
    assert.ok(coverage, 'the coverage check should still have run')
    assert.ok(reference, 'the reference check should still have run')
  } finally {
    scoreService.getScore = realGetScore
    restore()
  }
})

// The nastier half: with a page count coerced to 1, `expected` collapsed to one page's worth and
// twenty titles read as the whole window
test('a page count absent while the result count is present still reports short', async () => {
  const movies = Array.from({ length: 20 }, (_, i) => ({ page: 1, id: 500 + i, releaseDate: '2026-01-01' }))
  const { restore } = stub({ movies })
  const errors = []
  const realError = log.error

  tmdb.getMovies = async () => ({ movies, totalResults: 538 }) // no totalPages
  log.error = (message, fields) => errors.push({ message, fields })

  try {
    await cacheScores()

    assert.ok(errors.some(e => e.message === 'TMDB list came back short' && e.fields.resultsKey === 'movies'),
      `expected a short-catalogue error, got ${JSON.stringify(errors.map(e => e.message))}`)
  } finally {
    log.error = realError
    restore()
  }
})

// Redis stores NaN as null, so a cached malformed response used to multiply out to an expectation
// of zero and accept page one as the whole window
test('cached metadata that came back as null is not treated as verifiable', async () => {
  const movies = Array.from({ length: 20 }, (_, i) => ({ page: 1, id: 700 + i, releaseDate: '2026-01-01' }))
  const { restore } = stub({ movies })
  const errors = []
  const realError = log.error

  tmdb.getMovies = async () => ({ movies, totalPages: null, totalResults: 538 })
  log.error = (message, fields) => errors.push({ message, fields })

  try {
    await cacheScores()

    assert.ok(errors.some(e => e.message === 'TMDB list came back short' && e.fields.resultsKey === 'movies'),
      `expected a short-catalogue error, got ${JSON.stringify(errors.map(e => e.message))}`)
  } finally {
    log.error = realError
    restore()
  }
})

// Heavy duplication is how a truncated walk hides: the row count matches while distinct titles
// fall far short, so counting rows would have passed this
test('pages that repeat their titles report short despite a full row count', async () => {
  const movies = [1, 2, 3].flatMap(page => Array.from({ length: 20 }, (_, i) => ({ page, id: 800 + (i % 10), releaseDate: '2026-01-01' })))
  const { restore } = stub({ movies, totalPages: 3, totalResults: 60 })
  const errors = []
  const realError = log.error

  log.error = (message, fields) => errors.push({ message, fields })

  try {
    await cacheScores()

    const short = errors.find(e => e.message === 'TMDB list came back short' && e.fields.resultsKey === 'movies')

    assert.ok(short, '60 rows collapsing to 10 distinct titles is a truncated catalogue')
    assert.equal(short.fields.got, 10)
  } finally {
    log.error = realError
    restore()
  }
})

// The sort reads this one key, so the entry has to carry everything a card renders and everything
// the existing filters match on — otherwise a score-sorted page needs a TMDB call per title
test('the run publishes a score index a card could be rendered from', async () => {
  const movies = [{ page: 1, id: 61, title: 'Dune', posterPath: '/p.jpg', releaseDate: '2026-01-01', genreIds: [878], tmdbScoreCount: 900 }]
  const { restore } = stub({ movies })
  const written = new Map()
  const realSetCache = redis.setCache

  redis.setCache = async (key, value) => Boolean(written.set(key, value))

  try {
    await cacheScores()

    assert.deepEqual(written.get('index/movies/v1'), [{
      id: 61,
      title: 'Dune',
      posterPath: '/p.jpg',
      releaseDate: '2026-01-01',
      genreIds: [878],
      votes: 900,
      certification: 'PG-13',
      providers: [8],
      score: 70,
      sources: ['tmdb', 'imdb']
    }])
  } finally {
    redis.setCache = realSetCache
    restore()
  }
})

// Ranked at write time, so a request filters and slices rather than sorting, and the order cannot
// shift with the pool's finish order
test('the index is stored already ranked, ties broken by votes', async () => {
  const movies = [
    { page: 1, id: 1, tmdbScoreCount: 100 },
    { page: 1, id: 2, tmdbScoreCount: 900 },
    { page: 1, id: 3, tmdbScoreCount: 500 }
  ]
  const { restore } = stub({ movies })
  const written = new Map()
  const realSetCache = redis.setCache
  const scores = { 'movies/1/score': 80, 'movies/2/score': 90, 'movies/3/score': 90 }

  redis.setCache = async (key, value) => Boolean(written.set(key, value))
  scoreService.getScore = async key =>
    Object.defineProperty({ avgScore: scores[key], scores: { tmdb: 1 } }, 'cached', { value: true })

  try {
    await cacheScores()

    assert.deepEqual(written.get('index/movies/v1').map(entry => [entry.score, entry.votes]),
      [[90, 900], [90, 500], [80, 100]])
  } finally {
    redis.setCache = realSetCache
    restore()
  }
})

// Publishing the 20 rows a broken run produced would serve a near-empty list for a day, which is
// worse than yesterday's ranking
test('an incomplete run leaves the previous index alone', async () => {
  const { restore } = stub({ movies: [], shows: [] })
  const written = new Map()
  const realSetCache = redis.setCache

  redis.setCache = async (key, value) => Boolean(written.set(key, value))

  try {
    await cacheScores()

    assert.equal(written.has('index/movies/v1'), false, 'no index should have been published')
    assert.equal(written.has('index/shows/v1'), false)
  } finally {
    redis.setCache = realSetCache
    restore()
  }
})

// NaN comparisons are all false, so a negated gate published precisely the run it meant to refuse
test('a run whose catalogue size could not be verified leaves the index alone', async () => {
  const movies = Array.from({ length: 20 }, (_, i) => ({ page: 1, id: 900 + i, releaseDate: '2026-01-01' }))
  const { restore } = stub({ movies })
  const written = new Map()
  const realSetCache = redis.setCache

  tmdb.getMovies = async () => ({ movies }) // no totalPages, no totalResults
  redis.setCache = async (key, value) => Boolean(written.set(key, value))

  try {
    await cacheScores()

    assert.equal(written.has('index/movies/v1'), false, '20 unverifiable rows must not replace a complete index')
  } finally {
    redis.setCache = realSetCache
    restore()
  }
})

// Caching every score but publishing nothing sortable used to exit 0 on the strength of the scores
test('a failed index write fails the run', async () => {
  const movies = [{ page: 1, id: 71, releaseDate: '2026-01-01' }]
  const { restore } = stub({ movies })
  const realSetCache = redis.setCache

  redis.setCache = async key => !key.startsWith('index/')

  try {
    const { stats: [stats], coverage } = await cacheScores()

    assert.equal(stats.indexFailed, true)
    assert.ok(coverage.problems.some(p => p.reason === 'score index not published'),
      `expected coverage to fail, got ${JSON.stringify(coverage.problems.map(p => p.reason ?? p.source))}`)
  } finally {
    redis.setCache = realSetCache
    restore()
  }
})
