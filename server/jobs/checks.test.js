import { test } from 'node:test'
import assert from 'node:assert/strict'

// checks.js reaches env.js through tmdbService. Nothing here touches the network or Redis;
// the values only need to exist.
for (const key of ['TMDB_TOKEN', 'TMDB_API_URL', 'GCP_API_URL', 'GCP_API_KEY', 'GCP_SEARCH_ENGINE']) {
  process.env[key] ??= 'test'
}

// Imported after the env is set — static imports are hoisted and would run env.js first
const { checkRunCoverage, checkReferenceTitles } = await import('./checks.js')
const { default: tmdb } = await import('../services/tmdbService.js')

// A run where every source resolved for every title. `sources` is shorthand for the scored tally:
// titles a source did not score are read as ones it does not carry, which is a healthy run's shape.
// Pass `outcomes` instead to describe a source that failed rather than one that was never asked.
const healthy = ({ sources, ...over } = {}) => {
  const stats = { mediaType: 'movie', total: 20, processed: 20, failed: 0, notCached: 0, unscored: 0, ...over }
  const resolved = sources ?? { imdb: 20, metacritic: 20, rtCritic: 20, rtAudience: 20 }

  stats.outcomes ??= Object.fromEntries(Object.entries(resolved)
    .map(([source, scored]) => [source, { scored, absent: stats.processed - scored }]))

  return stats
}

const reasons = result => result.problems.map(p => p.reason ?? p.source)

test('a healthy run reports no problems', () => {
  assert.equal(checkRunCoverage([healthy()], true).ok, true)
})

test('partial critic coverage is tolerated, since new releases lack reviews', () => {
  const stats = healthy({ sources: { imdb: 20, metacritic: 10, rtCritic: 12, rtAudience: 16 } })
  assert.equal(checkRunCoverage([stats], true).ok, true)
})

test('a dead source trips its floor', () => {
  const stats = healthy({ sources: { imdb: 0, metacritic: 0, rtCritic: 0, rtAudience: 0 } })
  const result = checkRunCoverage([stats], true)

  assert.equal(result.ok, false)
  // Every floor, so one cannot drop out of the loop without a test noticing
  assert.deepEqual([...new Set(result.problems.map(p => p.source))], ['imdb', 'metacritic', 'rtCritic', 'rtAudience'])
})

// The detection the loosened floors gave up: a source blocked for part of the run trips its
// unreachable ceiling while every score it did return still clears the resolved floor
test('a source blocking for part of the run fails, where the resolved floor alone passes', () => {
  const stats = healthy({
    sources: { imdb: 20, metacritic: 20, rtCritic: 16, rtAudience: 16 },
    outcomes: {
      imdb: { scored: 20 },
      metacritic: { scored: 20 },
      rtCritic: { scored: 16, unreachable: 4 },
      rtAudience: { scored: 16, unreachable: 4 }
    }
  })
  const result = checkRunCoverage([stats], true)

  assert.equal(result.ok, false)
  assert.deepEqual(reasons(result), ['could not be read', 'could not be read'])
})

// The denominator change, stated as one comparison: the same resolved rate passes or fails on
// whether the titles that produced nothing are ones the source carries
test('titles a source does not carry are not counted against it', () => {
  const notCarried = { scored: 6, absent: 14 }
  const carried = { scored: 6, unscored: 14 }
  const stats = over => healthy({ sources: { imdb: 20, metacritic: 6, rtCritic: 20, rtAudience: 20 }, outcomes: { imdb: { scored: 20 }, metacritic: over, rtCritic: { scored: 20 }, rtAudience: { scored: 20 } } })

  assert.equal(checkRunCoverage([stats(notCarried)], true).ok, true)
  assert.deepEqual(reasons(checkRunCoverage([stats(carried)], true)), ['no score on the pages that carry it'])
})

// `NaN < min` is false, so dividing by a denominator of zero would make a total outage pass
test('a source no title carries fails rather than dividing by zero', () => {
  const stats = healthy({
    sources: { imdb: 20, metacritic: 20, rtCritic: 20, rtAudience: 0 },
    outcomes: { imdb: { scored: 20 }, metacritic: { scored: 20 }, rtCritic: { scored: 20 }, rtAudience: { absent: 20 } }
  })

  assert.ok(reasons(checkRunCoverage([stats], true)).includes('no score on the pages that carry it'))
})

// Every source failing for one title shows as no aggregate at all, which no rate catches: the
// title still counts as processed and contributes nothing to any source tally.
test('titles no source could score trip their own floor', () => {
  assert.equal(checkRunCoverage([healthy({ unscored: 1 })], true).ok, true)
  assert.ok(reasons(checkRunCoverage([healthy({ unscored: 3 })], true)).includes('titles no source could score'))
})

test('a batch where almost every title failed does not pass as full coverage', () => {
  // Rates divide by `processed`, so one fully-resolved title out of twenty used to report
  // 100% for every source
  const stats = healthy({ processed: 1, failed: 19, sources: { imdb: 1, metacritic: 1, rtCritic: 1, rtAudience: 1 } })
  const result = checkRunCoverage([stats], true)

  assert.equal(result.ok, false)
  assert.ok(reasons(result).includes('titles failed to score'))
})

test('scores that resolved but never persisted are caught', () => {
  assert.ok(reasons(checkRunCoverage([healthy({ notCached: 20 })], true)).includes('scores not persisted'))
})

test('a failed IMDb refresh is a problem even when every rate looks green', () => {
  const result = checkRunCoverage([healthy()], false)

  assert.equal(result.ok, false)
  assert.deepEqual(reasons(result), ['IMDb dataset refresh failed'])
})

test('an empty run is a problem, not a vacuous pass', () => {
  const stats = healthy({ total: 20, processed: 0, failed: 20, sources: {} })
  assert.ok(reasons(checkRunCoverage([stats], true)).includes('nothing processed'))
})


// getMovieDetail/getTvShowDetail throw on an upstream failure. checkReferenceTitles only
// retries a returned failure array, so an escaped rejection would abort the whole job.
test('an upstream lookup failure fails the title, not the run', async () => {
  const boom = async () => { throw new Error('TMDB 503 Service Unavailable') }
  const [movie, tv] = [tmdb.getMovieDetail, tmdb.getTvShowDetail]
  tmdb.getMovieDetail = boom
  tmdb.getTvShowDetail = boom

  try {
    const { ok, failures } = await checkReferenceTitles()

    assert.equal(ok, false)
    assert.ok(failures.length > 0, 'the failure should be reported, not swallowed')
    assert.ok(failures.every(f => f.reason === 'lookup failed'), 'every title should report the lookup failure')
  } finally {
    tmdb.getMovieDetail = movie
    tmdb.getTvShowDetail = tv
  }
})

// A field TMDB stops populating is invisible otherwise — `director` was empty on every TV page
// for months. This is the path that catches it, so it needs its own cover.
test('a detail field TMDB stops populating fails the title', async () => {
  const [movie, tv] = [tmdb.getMovieDetail, tmdb.getTvShowDetail]
  const detail = extra => async () => ({
    title: 't', overview: 'o', cast: 'c', rating: 'R', language: 'l', genres: 'g', ...extra
  })
  tmdb.getMovieDetail = detail({ director: '', runtime: 120 })
  tmdb.getTvShowDetail = detail({ creator: '', seasons: 2 })

  try {
    const { ok, failures } = await checkReferenceTitles()
    const empty = failures.filter(f => f.reason === 'detail field empty').map(f => f.source)

    assert.equal(ok, false)
    assert.ok(empty.includes('director'), `expected an empty director, got ${JSON.stringify(empty)}`)
    assert.ok(empty.includes('creator'), `expected an empty creator, got ${JSON.stringify(empty)}`)
  } finally {
    tmdb.getMovieDetail = movie
    tmdb.getTvShowDetail = tv
  }
})

// Half the measured rate is the drop worth catching: a source degrading rather than disappearing
test('a source at half its measured rate trips', () => {
  const stats = healthy({ sources: { imdb: 20, metacritic: 3, rtCritic: 5, rtAudience: 5 } })
  const result = checkRunCoverage([stats], true)

  assert.equal(result.ok, false)
  assert.deepEqual(reasons(result), ['metacritic', 'rtCritic', 'rtAudience'])
})

// A full run's own tallies, so no floor can drift above what a healthy run produces
test('the outcomes a full run measures at the current vote floor are tolerated', () => {
  const movies = healthy({
    total: 812, processed: 812, unscored: 8,
    outcomes: {
      imdb: { scored: 804, absent: 8 },
      metacritic: { scored: 323, unscored: 167, absent: 320, unreachable: 2 },
      rtCritic: { scored: 439, unscored: 175, absent: 198 },
      rtAudience: { scored: 441, unscored: 173, absent: 198 }
    }
  })
  const shows = healthy({
    mediaType: 'tv', total: 365, processed: 365, unscored: 13,
    outcomes: {
      imdb: { scored: 351, absent: 14 },
      metacritic: { scored: 126, unscored: 25, absent: 213, unreachable: 1 },
      rtCritic: { scored: 193, unscored: 96, absent: 76 },
      rtAudience: { scored: 185, unscored: 104, absent: 76 }
    }
  })

  assert.equal(checkRunCoverage([movies, shows], true).ok, true)
})

// The rates before the floor dropped, kept so a regression toward them still passes
test('the richer rates of the smaller catalogue are tolerated too', () => {
  const movies = healthy({ total: 537, processed: 537, sources: { imdb: 536, metacritic: 294, rtCritic: 356, rtAudience: 375 } })
  const shows = healthy({ mediaType: 'tv', total: 194, processed: 194, sources: { imdb: 189, metacritic: 100, rtCritic: 135, rtAudience: 137 } })

  assert.equal(checkRunCoverage([movies, shows], true).ok, true)
})

// Turn a quiet 503 into a red build: only the checks run before traffic reaches a bumped deploy
test('a missing ranked list fails the checks, and an unreadable Redis does not', async () => {
  const { checkRankedIndex } = await import('./checks.js')
  const { default: redis } = await import('../services/redisService.js')
  const { indexKey } = await import('../services/indexService.js')
  const real = redis.getCache

  try {
    redis.getCache = async () => null
    assert.deepEqual((await checkRankedIndex()).missing, ['movies', 'shows'], 'nothing published')

    redis.getCache = async key => key === indexKey('movies') ? [{ id: 1 }] : null
    assert.deepEqual((await checkRankedIndex()).missing, ['shows'], 'one catalogue published')

    redis.getCache = async () => [{ id: 1 }]
    assert.equal((await checkRankedIndex()).ok, true)

    redis.getCache = async () => undefined
    assert.equal((await checkRankedIndex()).ok, true, 'an outage is not an unpublished list')
  } finally {
    redis.getCache = real
  }
})
