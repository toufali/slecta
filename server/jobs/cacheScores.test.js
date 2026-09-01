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
const { default: redis, WRITTEN, FAILED } = await import('../services/redisService.js')
const { scoreKey } = await import('../services/scoreService.js')

// Every seam the job leans on, so a test says which one it is exercising and the rest stay quiet.
function stub({ movies = [], shows = [], totalPages = 1, totalResults }) {
  const scored = []
  const originals = [[imdb, 'refresh'], [tmdb, 'getMovies'], [tmdb, 'getTvShows'], [tmdb, 'getMovieDetail'],
    [tmdb, 'getTvShowDetail'], [scoreService, 'getScore']]
    .map(([target, name]) => [target, name, target[name]])

  imdb.refresh = async () => {}
  tmdb.getMovies = async ({ page }) => ({ movies: movies.filter(movie => movie.page === page), totalPages, totalResults: totalResults ?? movies.length })
  tmdb.getTvShows = async ({ page }) => ({ shows: shows.filter(show => show.page === page), totalPages, totalResults: totalResults ?? shows.length })
  tmdb.getMovieDetail = async id => ({ tmdbId: id, title: `movie ${id}`, rating: 'PG-13', providers: [{ provider_id: 8 }] })
  tmdb.getTvShowDetail = async id => ({ tmdbId: id, title: `show ${id}`, rating: 'TV-14', providers: [{ provider_id: 8 }] })
  scoreService.getScore = async key => {
    scored.push(key)
    // `cached` is non-enumerable on the real record, and its absence counts as a failed write
    return Object.defineProperty({ avgScore: 70, scores: { imdb: 80, rtCritic: 70 } }, 'cached', { value: true })
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
    assert.deepEqual(movieKeys(scored), movies.map(movie => scoreKey('movies', movie.id)).sort())
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
    assert.deepEqual(movieKeys(scored), [scoreKey('movies', 55)])
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
    assert.deepEqual(movieKeys(scored), [scoreKey('movies', 21), scoreKey('movies', 23)])
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
    if (key === scoreKey('movies', 2)) throw new TypeError('unexpected')
    return Object.defineProperty({ avgScore: 70, scores: { imdb: 70 } }, 'cached', { value: true })
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

  redis.setCache = async (key, value) => { written.set(key, value); return WRITTEN }

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
      sources: ['imdb', 'rtCritic']
    }])
  } finally {
    redis.setCache = realSetCache
    restore()
  }
})

// Ranked at write time, so a request filters and slices rather than sorting, and the order cannot
// shift with the pool's finish order
test('the index is stored already ranked, ties broken by votes then id', async () => {
  const movies = [
    { page: 1, id: 1, tmdbScoreCount: 100 },
    { page: 1, id: 2, tmdbScoreCount: 900 },
    { page: 1, id: 3, tmdbScoreCount: 500 },
    // 5 and 4 tie on both score and votes, listed high id first so only the id term can order them
    { page: 1, id: 5, tmdbScoreCount: 500 },
    { page: 1, id: 4, tmdbScoreCount: 500 }
  ]
  const { restore } = stub({ movies })
  const written = new Map()
  const realSetCache = redis.setCache
  const scores = { [scoreKey('movies', 1)]: 80, [scoreKey('movies', 2)]: 90, [scoreKey('movies', 3)]: 90, [scoreKey('movies', 4)]: 90, [scoreKey('movies', 5)]: 90 }

  redis.setCache = async (key, value) => { written.set(key, value); return WRITTEN }
  scoreService.getScore = async key =>
    Object.defineProperty({ avgScore: scores[key], scores: { imdb: 1 } }, 'cached', { value: true })

  try {
    await cacheScores()

    assert.deepEqual(written.get('index/movies/v1').map(entry => [entry.score, entry.votes, entry.id]),
      [[90, 900, 2], [90, 500, 3], [90, 500, 4], [90, 500, 5], [80, 100, 1]])
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

  redis.setCache = async (key, value) => { written.set(key, value); return WRITTEN }

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
  redis.setCache = async (key, value) => { written.set(key, value); return WRITTEN }

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

  redis.setCache = async key => key.startsWith('index/') ? FAILED : WRITTEN

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

// A handful of scoring failures is still a good ranking; the gate is proportional so it publishes
test('a run short a few titles still publishes', async () => {
  const movies = Array.from({ length: 20 }, (_, i) => ({ page: 1, id: 1000 + i, releaseDate: '2026-01-01' }))
  const { restore } = stub({ movies })
  const written = new Map()
  const realSetCache = redis.setCache
  const realGetScore = scoreService.getScore

  redis.setCache = async (key, value) => { written.set(key, value); return WRITTEN }
  // one of twenty fails, which is inside the 10% the ranking tolerates
  scoreService.getScore = async key => key === scoreKey('movies', 1000) ? null
    : Object.defineProperty({ avgScore: 70, scores: { imdb: 1 } }, 'cached', { value: true })

  try {
    const { stats: [stats] } = await cacheScores()

    assert.equal(stats.failed, 1)
    assert.equal(stats.indexFailed, false)
    assert.equal(written.get('index/movies/v1').length, 19)
  } finally {
    scoreService.getScore = realGetScore
    redis.setCache = realSetCache
    restore()
  }
})

// Skipping publication leaves only an expiring index, so it cannot report success. The walk here is
// complete, so only the row-coverage condition can block it.
test('too many unscorable titles fails the run, not just a warning', async () => {
  const movies = Array.from({ length: 20 }, (_, i) => ({ page: 1, id: 1100 + i, releaseDate: '2026-01-01' }))
  const { restore } = stub({ movies })
  const written = new Map()
  const realSetCache = redis.setCache
  const realGetScore = scoreService.getScore

  redis.setCache = async (key, value) => { written.set(key, value); return WRITTEN }
  // 3 of 20 unscorable leaves 17 rows, under the 18 that 90% of the catalogue requires
  scoreService.getScore = async key => [1100, 1101, 1102].some(id => key === scoreKey('movies', id)) ? null
    : Object.defineProperty({ avgScore: 70, scores: { imdb: 1 } }, 'cached', { value: true })

  try {
    const { stats: [stats], coverage } = await cacheScores()

    assert.equal(stats.processed, 17)
    assert.equal(written.has('index/movies/v1'), false, '17 of 20 is under the 90% a ranking needs')
    assert.equal(stats.indexFailed, true)
    assert.ok(coverage.problems.some(p => p.reason === 'score index not published'))
  } finally {
    scoreService.getScore = realGetScore
    redis.setCache = realSetCache
    restore()
  }
})

// 54 of 60 is exactly the 90% rows need but one short of the walk's own tolerance, so this isolates
// the walk guard: a lost page hides titles yesterday's complete index still holds
test('a short catalogue walk withholds the index even at full row coverage', async () => {
  const movies = [1, 2, 3].flatMap(page => Array.from({ length: page === 3 ? 14 : 20 }, (_, i) => ({ page, id: page * 100 + i, releaseDate: '2026-01-01' })))
  const { restore } = stub({ movies, totalPages: 3, totalResults: 60 })
  const written = new Map()
  const realSetCache = redis.setCache

  redis.setCache = async (key, value) => { written.set(key, value); return WRITTEN }

  try {
    const { stats: [stats] } = await cacheScores()

    assert.equal(stats.processed, 54, 'exactly 90% of 60, so row coverage is satisfied')
    assert.equal(written.has('index/movies/v1'), false, 'the walk was short, so nothing publishes')
    assert.equal(stats.indexFailed, true)
  } finally {
    redis.setCache = realSetCache
    restore()
  }
})

// A refused write leaves the richer record in place, so the row has to carry that record's numbers
// or the ranked list contradicts the detail page reading the same key
test('a refused write publishes the stored score, not tonight thinner one', async () => {
  const movies = [{ page: 1, id: 7, title: 'kept', releaseDate: '2026-01-01' }]
  const { restore } = stub({ movies })
  const writes = new Map()
  const realSet = redis.setCache

  redis.setCache = async (key, value) => { writes.set(key, value); return WRITTEN }
  scoreService.getScore = async () => {
    const fresh = { avgScore: 40, scores: { imdb: 40 } }

    Object.defineProperty(fresh, 'cached', { value: true })
    Object.defineProperty(fresh, 'kept', { value: { avgScore: 82, scores: { imdb: 88, metacritic: 76, rtCritic: 80, rtAudience: 84 } } })
    return fresh
  }

  try {
    const { stats: [stats] } = await cacheScores()
    const [row] = writes.get('index/movies/v1')

    assert.equal(row.score, 82, 'the row carries the stored score')
    assert.deepEqual(row.sources, ['imdb', 'metacritic', 'rtCritic', 'rtAudience'])
    // Coverage still measures tonight's attempt, which is what detects a source going down
    assert.deepEqual(stats.sources, { imdb: 1 })
    assert.equal(stats.notCached, 0, 'a refusal is not a persistence failure')
  } finally {
    redis.setCache = realSet
    restore()
  }
})

// The state that TMDB used to mask: with no source resolving, the title still scores and still
// counts as processed, so only this tally reveals it
test('a title no source could score is counted, not treated as a failure', async () => {
  const movies = [{ page: 1, id: 9, title: 'nothing', releaseDate: '2026-01-01' }]
  const { restore } = stub({ movies })

  scoreService.getScore = async () => Object.defineProperty({ scores: {} }, 'cached', { value: true })

  try {
    const { stats: [stats] } = await cacheScores()

    assert.equal(stats.unscored, 1)
    assert.equal(stats.failed, 0)
    assert.equal(stats.processed, 1)
  } finally {
    restore()
  }
})
