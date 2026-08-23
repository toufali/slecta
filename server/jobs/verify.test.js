import { test } from 'node:test'
import assert from 'node:assert/strict'

// verify.js reaches env.js through tmdbService. Nothing here touches the network or Redis;
// the values only need to exist.
for (const key of ['TMDB_TOKEN', 'TMDB_API_URL', 'GCP_API_URL', 'GCP_API_KEY', 'GCP_SEARCH_ENGINE']) {
  process.env[key] ??= 'test'
}

// Imported after the env is set — static imports are hoisted and would run env.js first
const { checkRunCoverage, checkReferenceTitles } = await import('./verify.js')
const { default: tmdb } = await import('../services/tmdbService.js')

// A run where every source resolved for every title
const healthy = (over = {}) => ({
  mediaType: 'movie', total: 20, processed: 20, failed: 0, notCached: 0, tmdbOnly: 0,
  sources: { imdb: 20, metacritic: 20, rtCritic: 20, rtAudience: 20, tmdb: 20 }, ...over
})

const reasons = result => result.problems.map(p => p.reason ?? p.source)

test('a healthy run reports no problems', () => {
  assert.equal(checkRunCoverage([healthy()], true).ok, true)
})

test('partial critic coverage is tolerated, since new releases lack reviews', () => {
  const stats = healthy({ sources: { imdb: 20, metacritic: 10, rtCritic: 12, rtAudience: 16, tmdb: 20 } })
  assert.equal(checkRunCoverage([stats], true).ok, true)
})

test('a dead source trips its floor', () => {
  const stats = healthy({ sources: { imdb: 20, metacritic: 0, rtCritic: 0, rtAudience: 0, tmdb: 20 } })
  const result = checkRunCoverage([stats], true)

  assert.equal(result.ok, false)
  assert.deepEqual(reasons(result), ['metacritic', 'rtCritic', 'rtAudience'])
})

test('scores built from TMDB alone trip, even at a low rate', () => {
  assert.ok(reasons(checkRunCoverage([healthy({ tmdbOnly: 3 })], true)).includes('aggregates built from TMDB alone'))
})

test('a batch where almost every title failed does not pass as full coverage', () => {
  // Rates divide by `processed`, so one fully-resolved title out of twenty used to report
  // 100% for every source
  const stats = healthy({ processed: 1, failed: 19, sources: { imdb: 1, metacritic: 1, rtCritic: 1, rtAudience: 1, tmdb: 1 } })
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
    title: 't', overview: 'o', cast: 'c', rating: 'R', languages: 'l', genres: 'g', ...extra
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
