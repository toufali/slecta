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
const { default: log } = await import('../utils/logger.js')

// The alert policy matches severity>=ERROR, so which level a tier logs at *is* the silence
function captureLevels() {
  const seen = []
  const real = { error: log.error, warn: log.warn, info: log.info }

  for (const level of ['error', 'warn', 'info']) log[level] = message => seen.push(`${level}: ${message}`)

  return { seen, restore: () => Object.assign(log, real) }
}

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
const tiers = result => [...new Set(result.problems.map(p => p.tier))].sort()

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
// unreachable ceiling while every score it did return still clears the resolved floor. A fifth
// unreachable is a bad night rather than a block, so it warns without waking anyone.
test('a source blocking for part of the run warns, where the resolved floor alone says nothing', () => {
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

  assert.equal(result.ok, true, 'a warn leaves the run green')
  assert.deepEqual(tiers(result), ['warn'])
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

// Half the measured rate is the drop worth seeing: a source degrading rather than disappearing, so
// it is logged and not alerted
test('a source at half its measured rate warns', () => {
  const stats = healthy({ sources: { imdb: 20, metacritic: 3, rtCritic: 5, rtAudience: 5 } })
  const result = checkRunCoverage([stats], true)

  assert.equal(result.ok, true)
  assert.deepEqual(tiers(result), ['warn'])
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
test('the checks fail whenever a ranked list cannot be served', async () => {
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

    // Elsewhere an outage must not read as absent data; here both mean the list will not serve, and
    // passing would let a flaky read hide a generation nobody published
    redis.getCache = async () => undefined

    const outage = await checkRankedIndex()

    assert.equal(outage.ok, false)
    assert.deepEqual(outage.unreadable, ['movies', 'shows'])
    assert.deepEqual(outage.missing, [], 'reported apart: one says run the job, the other fix Redis')
  } finally {
    redis.getCache = real
  }
})

// The alert that started this: 9 unreachable Metacritic reads of 362 TV titles, against a 2% floor
// on a catalogue half the size of film's. Nothing was wrong and the affected titles kept their
// scores, so at 2.5% it now clears the floor outright rather than being logged as a shortfall.
test('the night that alerted now passes without comment', () => {
  const tv = healthy({
    mediaType: 'tv', total: 362, processed: 362, unscored: 12,
    outcomes: {
      imdb: { scored: 358, absent: 4 },
      metacritic: { scored: 96, unscored: 60, absent: 197, unreachable: 9 },
      rtCritic: { scored: 168, unscored: 40, absent: 154 },
      rtAudience: { scored: 190, unscored: 18, absent: 154 }
    }
  })
  const result = checkRunCoverage([tv], true)

  assert.equal(result.ok, true, 'a slow night is not a failed run')
  assert.deepEqual(result.problems, [], '2.5% unreachable is normal variance, not a shortfall')
})

// Between the tiers: loud in the logs, silent to whoever is asleep
test('a source well over its ceiling warns without alerting', () => {
  const tv = healthy({
    mediaType: 'tv', total: 362, processed: 362,
    outcomes: {
      imdb: { scored: 358, absent: 4 },
      metacritic: { scored: 96, unscored: 60, absent: 176, unreachable: 30 },
      rtCritic: { scored: 168, unscored: 40, absent: 154 },
      rtAudience: { scored: 190, unscored: 18, absent: 154 }
    }
  })
  const result = checkRunCoverage([tv], true)

  assert.equal(result.ok, true)
  assert.deepEqual(tiers(result), ['warn'])
  assert.deepEqual(reasons(result), ['could not be read'])
})

// A real block is near-total, and it still has to page on the first night rather than warn twice
test('a source failing on every title alerts immediately', () => {
  const stats = healthy({
    outcomes: {
      imdb: { scored: 20 },
      metacritic: { unreachable: 20 },
      rtCritic: { scored: 20 },
      rtAudience: { scored: 20 }
    }
  })
  const result = checkRunCoverage([stats], true)

  assert.equal(result.ok, false)
  assert.ok(tiers(result).includes('alert'))
  assert.deepEqual(result.problems.filter(p => p.tier === 'alert').map(p => p.source), ['metacritic', 'metacritic', 'metacritic'])
})

// A structural failure is not a rate: there is no marginal version of publishing no ranked list
test('a structural failure alerts whatever the rates say', () => {
  for (const over of [{ indexFailed: true }, { processed: 0 }]) {
    const result = checkRunCoverage([healthy(over)], true)

    assert.equal(result.ok, false, JSON.stringify(over))
    assert.deepEqual(tiers(result), ['alert'])
  }

  assert.equal(checkRunCoverage([healthy()], false).ok, false, 'a failed IMDb refresh hides every rate')
})

// A warn logged at ERROR would fire the alert and defeat the whole tiering, silently
test('only an alert reaches ERROR', () => {
  const warnOnly = healthy({ outcomes: { imdb: { scored: 20 }, metacritic: { scored: 20 }, rtCritic: { scored: 16, unreachable: 4 }, rtAudience: { scored: 20 } } })
  const alerting = healthy({ outcomes: { imdb: { scored: 20 }, metacritic: { unreachable: 20 }, rtCritic: { scored: 20 }, rtAudience: { scored: 20 } } })

  for (const [stats, expected] of [[healthy(), ['info: Run coverage passed']], [warnOnly, ['warn: Run coverage short of its limits']], [alerting, ['error: Run coverage FAILED']]]) {
    const { seen, restore } = captureLevels()

    try {
      checkRunCoverage([stats], true)
    } finally {
      restore()
    }

    assert.deepEqual(seen, expected)
  }
})

// The run-level limits got the same two tiers, and leaving any of them on one threshold is how the
// next false alarm arrives
test('every run-level limit warns before it alerts', () => {
  const cases = [
    ['titles failed to score', { failed: 3 }, { failed: 12 }],
    ['titles no source could score', { unscored: 3 }, { unscored: 12 }],
    ['scores not persisted', { notCached: 3 }, { notCached: 12 }]
  ]

  for (const [reason, marginal, catastrophic] of cases) {
    const warned = checkRunCoverage([healthy(marginal)], true)

    assert.equal(warned.ok, true, reason)
    assert.deepEqual(warned.problems.map(p => [p.tier, p.reason]), [['warn', reason]])

    const alerted = checkRunCoverage([healthy(catastrophic)], true)

    assert.equal(alerted.ok, false, reason)
    assert.deepEqual(alerted.problems.map(p => [p.tier, p.reason]), [['alert', reason]])
  }
})
