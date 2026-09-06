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
const { scoreKey, SCORE_TTL } = await import('../services/scoreService.js')
// Derived, not spelled out: a version bump used to break a dozen of these
const { indexKey } = await import('../services/indexService.js')
const MOVIE_INDEX = indexKey('movies')

// Every seam the job leans on, so a test says which one it is exercising and the rest stay quiet.
function stub({ movies = [], shows = [], totalPages = 1, totalResults }) {
  const scored = []
  const passed = []
  const windows = []
  const originals = [[imdb, 'refresh'], [tmdb, 'getMovies'], [tmdb, 'getTvShows'], [tmdb, 'getMovieDetail'],
    [tmdb, 'getTvShowDetail'], [scoreService, 'getScore'], [scoreService, 'getScoreFromCache']]
    .map(([target, name]) => [target, name, target[name]])

  imdb.refresh = async () => {}
  // The window is recorded, since every page of one walk has to be bounded by the same day
  tmdb.getMovies = async ({ page }, window) => { windows.push(window); return { movies: movies.filter(movie => movie.page === page), totalPages, totalResults: totalResults ?? movies.length } }
  tmdb.getTvShows = async ({ page }) => ({ shows: shows.filter(show => show.page === page), totalPages, totalResults: totalResults ?? shows.length })
  tmdb.getMovieDetail = async id => ({ tmdbId: id, title: `movie ${id}`, rating: 'PG-13', providers: [{ provider_id: 8 }] })
  tmdb.getTvShowDetail = async id => ({ tmdbId: id, title: `show ${id}`, rating: 'TV-14', seasons: 1, providers: [{ provider_id: 8 }] })
  scoreService.getScore = async (key, data) => {
    scored.push(key)
    passed.push(data)
    // `cached` is non-enumerable on the real record, and its absence counts as a failed write
    return Object.defineProperty({ scores: { imdb: 70, rtCritic: 70 } }, 'cached', { value: true })
  }
  // The index reads storage, not tonight's attempt: a test wanting them to differ overrides this
  scoreService.getScoreFromCache = async () => ({ scores: { imdb: 70, rtCritic: 70 } })

  return { scored, passed, windows, restore: () => originals.forEach(([target, name, value]) => { target[name] = value }) }
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
    return Object.defineProperty({ scores: { imdb: 70 } }, 'cached', { value: true })
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
  const movies = [{ page: 1, id: 61, title: 'Dune', posterPath: '/p.jpg', releaseDate: '2026-01-01', genreIds: [878], tmdbScoreCount: 900, originalLanguage: 'en' }]
  const { restore } = stub({ movies })
  const written = new Map()
  const realSetCache = redis.setCache

  redis.setCache = async (key, value) => { written.set(key, value); return WRITTEN }

  try {
    await cacheScores()

    assert.deepEqual(written.get(MOVIE_INDEX), [{
      id: 61,
      title: 'Dune',
      posterPath: '/p.jpg',
      releaseDate: '2026-01-01',
      genreIds: [878],
      votes: 900,
      certification: 'PG-13',
      providers: [8],
      originalLanguage: 'en',
      score: 70
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
  scoreService.getScoreFromCache = async key => ({ scores: { imdb: scores[key] } })

  try {
    await cacheScores()

    assert.deepEqual(written.get(MOVIE_INDEX).map(entry => [entry.score, entry.votes, entry.id]),
      [[90, 900, 2], [90, 500, 3], [90, 500, 4], [90, 500, 5], [80, 100, 1]])
  } finally {
    redis.setCache = realSetCache
    restore()
  }
})

// Yesterday's ranking still has its own TTL to run, so publishing nothing beats publishing empty
test('a run with nothing to publish leaves the previous index alone', async () => {
  const { restore } = stub({ movies: [], shows: [] })
  const written = new Map()
  const realSetCache = redis.setCache

  redis.setCache = async (key, value) => { written.set(key, value); return WRITTEN }

  try {
    await cacheScores()

    assert.equal(written.has(MOVIE_INDEX), false, 'no index should have been published')
    assert.equal(written.has('index/shows/v1'), false)
  } finally {
    redis.setCache = realSetCache
    restore()
  }
})

// A walk that cannot be verified is treated as short, so its unconfirmed rows are kept rather than
// read as titles leaving the window
test('a walk that cannot be verified publishes, keeping the rows it could not confirm', async () => {
  const movies = Array.from({ length: 20 }, (_, i) => ({ page: 1, id: 900 + i, releaseDate: '2026-01-01' }))
  const { restore } = stub({ movies })
  const written = new Map()
  const [realSetCache, realGetCache] = [redis.setCache, redis.getCache]

  tmdb.getMovies = async () => ({ movies }) // no totalPages, no totalResults
  redis.setCache = async (key, value) => { written.set(key, value); return WRITTEN }
  redis.getCache = async key => key === MOVIE_INDEX ? [{ id: 99, score: 88, votes: 10 }] : realGetCache(key)

  try {
    const { stats: [stats] } = await cacheScores()

    assert.equal(stats.indexFailed, false)
    assert.equal(written.get(MOVIE_INDEX).length, 21, 'twenty walked plus the one it could not confirm')
  } finally {
    redis.getCache = realGetCache
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

// The reason the index reads storage: a bad night refreshes less rather than publishing less
test('a title that failed tonight keeps the row its stored score earned', async () => {
  const movies = Array.from({ length: 20 }, (_, i) => ({ page: 1, id: 1000 + i, releaseDate: '2026-01-01' }))
  const { restore } = stub({ movies })
  const written = new Map()
  const realSetCache = redis.setCache
  const realGetScore = scoreService.getScore

  redis.setCache = async (key, value) => { written.set(key, value); return WRITTEN }
  // one of twenty fails, which is inside the 10% the ranking tolerates
  scoreService.getScore = async key => key === scoreKey('movies', 1000) ? null
    : Object.defineProperty({ scores: { imdb: 70 } }, 'cached', { value: true })

  try {
    const { stats: [stats] } = await cacheScores()

    assert.equal(stats.failed, 1)
    assert.equal(stats.indexFailed, false)
    assert.equal(written.get(MOVIE_INDEX).length, 20, 'the failed title still has a stored score')
  } finally {
    scoreService.getScore = realGetScore
    redis.setCache = realSetCache
    restore()
  }
})

// A row can only claim a score the record still holds, or the ranking outlives the detail page
test('a title with no stored score contributes no row', async () => {
  const movies = Array.from({ length: 20 }, (_, i) => ({ page: 1, id: 1100 + i, releaseDate: '2026-01-01' }))
  const { restore } = stub({ movies })
  const written = new Map()
  const realSetCache = redis.setCache

  redis.setCache = async (key, value) => { written.set(key, value); return WRITTEN }
  scoreService.getScoreFromCache = async key => [1100, 1101, 1102].some(id => key === scoreKey('movies', id))
    ? null
    : { scores: { imdb: 70 } }

  try {
    const { stats: [stats] } = await cacheScores()

    assert.equal(stats.processed, 20)
    assert.equal(stats.failed, 0, 'a missing record is not a thrown one')
    assert.equal(stats.indexFailed, false)
    assert.equal(written.get(MOVIE_INDEX).length, 17)
  } finally {
    redis.setCache = realSetCache
    restore()
  }
})

// Both directions of the carry rule: a short walk keeps what it did not confirm, and a walked title
// is refreshed rather than carried a second time
test('a short catalogue walk keeps the rows it could not confirm, and duplicates none', async () => {
  const movies = [1, 2, 3].flatMap(page => Array.from({ length: page === 3 ? 14 : 20 }, (_, i) => ({ page, id: page * 100 + i, releaseDate: '2026-01-01' })))
  const { restore } = stub({ movies, totalPages: 3, totalResults: 60 })
  const written = new Map()
  const [realSetCache, realGetCache] = [redis.setCache, redis.getCache]
  const previous = [{ id: 100, score: 99, votes: 1 }, { id: 999, score: 88, votes: 1 }]

  redis.setCache = async (key, value) => { written.set(key, value); return WRITTEN }
  redis.getCache = async key => key === MOVIE_INDEX ? previous : realGetCache(key)

  try {
    const { stats: [stats] } = await cacheScores()
    const rows = written.get(MOVIE_INDEX)

    assert.equal(stats.processed, 54)
    assert.equal(stats.indexFailed, false)
    assert.equal(rows.length, 55, '54 walked plus the one title the short walk never reached')
    assert.equal(rows.filter(row => row.id === 100).length, 1, 'a walked title is refreshed, not carried too')
    assert.equal(rows.find(row => row.id === 100).score, 70, 'and refreshed from storage, not carried')
  } finally {
    redis.getCache = realGetCache
    redis.setCache = realSetCache
    restore()
  }
})

// A gap here is where a ranking keeps serving scores the detail page has already lost
test('the index is written with the score TTL, not a longer one', async () => {
  const movies = [{ page: 1, id: 1, releaseDate: '2026-01-01' }]
  const { restore } = stub({ movies })
  const ttls = new Map()
  const realSetCache = redis.setCache

  redis.setCache = async (key, value, ttl) => { ttls.set(key, ttl); return WRITTEN }

  try {
    await cacheScores()

    assert.equal(ttls.get(MOVIE_INDEX), SCORE_TTL)
  } finally {
    redis.setCache = realSetCache
    restore()
  }
})

// The record can have expired since the row was published, and carrying the row renews it
test('a carried row whose score record is gone is dropped', async () => {
  const movies = [{ page: 1, id: 1, releaseDate: '2026-01-01' }]
  const { restore } = stub({ movies, totalPages: 2, totalResults: 40 })
  const written = new Map()
  const [realSetCache, realGetCache] = [redis.setCache, redis.getCache]

  redis.setCache = async (key, value) => { written.set(key, value); return WRITTEN }
  redis.getCache = async key => key === MOVIE_INDEX ? [{ id: 99, score: 88, votes: 1 }] : realGetCache(key)
  scoreService.getScoreFromCache = async key => key === scoreKey('movies', 99) ? null : { scores: { imdb: 70 } }

  try {
    await cacheScores()

    assert.deepEqual(written.get(MOVIE_INDEX).map(row => row.id), [1])
  } finally {
    redis.getCache = realGetCache
    redis.setCache = realSetCache
    restore()
  }
})

// The row is a projection of the record, so carrying one must not preserve a number it has since lost
test('a carried row takes its score from the record, not from the previous index', async () => {
  const movies = [{ page: 1, id: 1, releaseDate: '2026-01-01' }]
  const { restore } = stub({ movies, totalPages: 2, totalResults: 40 })
  const written = new Map()
  const [realSetCache, realGetCache] = [redis.setCache, redis.getCache]

  redis.setCache = async (key, value) => { written.set(key, value); return WRITTEN }
  redis.getCache = async key => key === MOVIE_INDEX
    ? [{ id: 99, score: 88, votes: 1, originalLanguage: 'fr' }]
    : realGetCache(key)
  scoreService.getScoreFromCache = async key => key === scoreKey('movies', 99)
    ? { scores: { metacritic: 55 } }
    : { scores: { imdb: 70 } }

  try {
    await cacheScores()
    const carried = written.get(MOVIE_INDEX).find(row => row.id === 99)

    assert.equal(carried.score, 55)
    assert.equal(carried.originalLanguage, 'fr', 'a carried row keeps the fields the walk did not resupply')
  } finally {
    redis.getCache = realGetCache
    redis.setCache = realSetCache
    restore()
  }
})

// `getCache` answers undefined for an unreadable Redis and null for a miss; collapsing them drops a
// title over a failed read. Three places make the same mistake, so each gets its own test.
test('a title whose record could not be read keeps the row it had, even on a complete walk', async () => {
  const movies = [{ page: 1, id: 1, releaseDate: '2026-01-01' }, { page: 1, id: 2, releaseDate: '2026-01-01' }]
  const { restore } = stub({ movies })
  const written = new Map()
  const [realSetCache, realGetCache] = [redis.setCache, redis.getCache]

  redis.setCache = async (key, value) => { written.set(key, value); return WRITTEN }
  redis.getCache = async key => key === MOVIE_INDEX ? [{ id: 2, score: 88, votes: 1 }] : realGetCache(key)
  scoreService.getScoreFromCache = async key => key === scoreKey('movies', 2) ? undefined : { scores: { imdb: 70 } }

  try {
    const { stats: [stats] } = await cacheScores()
    const rows = written.get(MOVIE_INDEX)

    assert.equal(stats.failed, 0)
    assert.deepEqual(rows.map(row => row.id), [2, 1], 'the unreadable title keeps its place')
    assert.equal(rows.find(row => row.id === 2).score, 88)
  } finally {
    redis.getCache = realGetCache
    redis.setCache = realSetCache
    restore()
  }
})

test('an unreadable previous index withholds publication rather than replacing it', async () => {
  const movies = [{ page: 1, id: 1, releaseDate: '2026-01-01' }]
  const { restore } = stub({ movies, totalPages: 2, totalResults: 40 })
  const written = new Map()
  const [realSetCache, realGetCache] = [redis.setCache, redis.getCache]

  redis.setCache = async (key, value) => { written.set(key, value); return WRITTEN }
  redis.getCache = async key => key === MOVIE_INDEX ? undefined : realGetCache(key)

  try {
    const { stats: [stats] } = await cacheScores()

    assert.equal(written.has(MOVIE_INDEX), false)
    assert.equal(stats.indexFailed, true)
  } finally {
    redis.getCache = realGetCache
    redis.setCache = realSetCache
    restore()
  }
})

test('a carried row whose record could not be read is kept, not dropped', async () => {
  const movies = [{ page: 1, id: 1, releaseDate: '2026-01-01' }]
  const { restore } = stub({ movies, totalPages: 2, totalResults: 40 })
  const written = new Map()
  const [realSetCache, realGetCache] = [redis.setCache, redis.getCache]

  redis.setCache = async (key, value) => { written.set(key, value); return WRITTEN }
  redis.getCache = async key => key === MOVIE_INDEX ? [{ id: 99, score: 88, votes: 1 }] : realGetCache(key)
  scoreService.getScoreFromCache = async key => key === scoreKey('movies', 99) ? undefined : { scores: { imdb: 70 } }

  try {
    await cacheScores()
    const rows = written.get(MOVIE_INDEX)

    assert.deepEqual(rows.map(row => row.id), [99, 1])
    assert.equal(rows.find(row => row.id === 99).score, 88, 'kept as it was, since nothing said otherwise')
  } finally {
    redis.getCache = realGetCache
    redis.setCache = realSetCache
    restore()
  }
})

// The complete-walk half: a title the walk did not return has left the window, so its row goes
test('a complete walk drops a row for a title no longer in the window', async () => {
  const movies = [{ page: 1, id: 1, releaseDate: '2026-01-01' }]
  const { restore } = stub({ movies })
  const written = new Map()
  const [realSetCache, realGetCache] = [redis.setCache, redis.getCache]

  redis.setCache = async (key, value) => { written.set(key, value); return WRITTEN }
  redis.getCache = async key => key === MOVIE_INDEX ? [{ id: 99, score: 88, votes: 1 }] : realGetCache(key)

  try {
    await cacheScores()

    assert.deepEqual(written.get(MOVIE_INDEX).map(row => row.id), [1])
  } finally {
    redis.getCache = realGetCache
    redis.setCache = realSetCache
    restore()
  }
})

// A refused write leaves the richer record in place, so the row has to carry that record's numbers
// or the ranked list contradicts the detail page reading the same key
test('a refused write publishes the stored score, not tonight\u2019s thinner one', async () => {
  const movies = [{ page: 1, id: 7, title: 'kept', releaseDate: '2026-01-01' }]
  const { restore } = stub({ movies })
  const writes = new Map()
  const realSet = redis.setCache

  redis.setCache = async (key, value) => { writes.set(key, value); return WRITTEN }
  scoreService.getScore = async () => {
    const fresh = { scores: { imdb: 40 } }

    Object.defineProperty(fresh, 'cached', { value: true })
    Object.defineProperty(fresh, 'outcomes', { value: { imdb: 'scored', metacritic: 'unreachable', rtCritic: 'unreachable', rtAudience: 'unreachable' } })
    return fresh
  }
  // The write was refused, so the richer record is what the key still holds
  scoreService.getScoreFromCache = async () => ({ scores: { imdb: 88, metacritic: 76, rtCritic: 80, rtAudience: 84 } })

  try {
    const { stats: [stats] } = await cacheScores()
    const [row] = writes.get(MOVIE_INDEX)

    assert.equal(row.score, 82, 'the row carries the stored score')
    // Coverage still measures tonight's attempt, which is what detects a source going down
    assert.deepEqual(stats.outcomes, {
      imdb: { scored: 1 }, metacritic: { unreachable: 1 }, rtCritic: { unreachable: 1 }, rtAudience: { unreachable: 1 }
    })
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

// Pages fetched either side of midnight would be bounded by different days, shifting titles across
// page boundaries — so the walk derives its window once and every page carries it
test('every page of a walk is bounded by the same window', async () => {
  const movies = [1, 2, 3].flatMap(page => [{ page, id: page * 10, releaseDate: '2026-01-01' }])
  const { windows, restore } = stub({ movies, totalPages: 3 })

  try {
    await cacheScores()

    assert.equal(windows.length, 3, 'one call per page')
    assert.ok(windows[0], 'a window was supplied rather than left to the clock')
    assert.equal(new Set(windows.map(w => JSON.stringify(w))).size, 1)
  } finally {
    restore()
  }
})

// The season count decides which RT page a show is read from, so a detail field that stops at the
// job silently reverts every show to the banded series page
test('a show carries its season count to the score lookup', async () => {
  const shows = [{ page: 1, id: 9, releaseDate: '2026-01-01' }]
  const { passed, restore } = stub({ shows })

  try {
    await cacheScores()

    // By title, since the reference-title check scores a show of its own after the walk
    assert.deepEqual(passed.filter(data => data.title === 'show 9').map(data => data.seasons), [1])
  } finally {
    restore()
  }
})
