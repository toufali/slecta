import { test } from 'node:test'
import assert from 'node:assert/strict'

// env.js validates at import time and this module's import chain reaches it. Nothing here
// touches the network or Redis; the values only need to exist.
for (const key of ['TMDB_TOKEN', 'TMDB_API_URL', 'GCP_API_URL', 'GCP_API_KEY', 'GCP_SEARCH_ENGINE']) {
  process.env[key] ??= 'test'
}

// Imported after the env is set — static imports are hoisted and would run env.js first
const { checkCoverage } = await import('./cacheScores.js')

// A run where every source resolved for every title
const healthy = (over = {}) => ({
  mediaType: 'movie', total: 20, processed: 20, failed: 0, notCached: 0, tmdbOnly: 0,
  sources: { imdb: 20, metacritic: 20, rtCritic: 20, rtAudience: 20, tmdb: 20 }, ...over
})

const reasons = result => result.problems.map(p => p.reason ?? p.source)

test('a healthy run reports no problems', () => {
  assert.equal(checkCoverage([healthy()], true).ok, true)
})

test('partial critic coverage is tolerated, since new releases lack reviews', () => {
  const stats = healthy({ sources: { imdb: 20, metacritic: 10, rtCritic: 12, rtAudience: 16, tmdb: 20 } })
  assert.equal(checkCoverage([stats], true).ok, true)
})

test('a dead source trips its floor', () => {
  const stats = healthy({ sources: { imdb: 20, metacritic: 0, rtCritic: 0, rtAudience: 0, tmdb: 20 } })
  const result = checkCoverage([stats], true)

  assert.equal(result.ok, false)
  assert.deepEqual(reasons(result), ['metacritic', 'rtCritic', 'rtAudience'])
})

test('scores built from TMDB alone trip, even at a low rate', () => {
  assert.ok(reasons(checkCoverage([healthy({ tmdbOnly: 3 })], true)).includes('aggregates built from TMDB alone'))
})

test('a batch where almost every title failed does not pass as full coverage', () => {
  // Rates divide by `processed`, so one fully-resolved title out of twenty used to report
  // 100% for every source
  const stats = healthy({ processed: 1, failed: 19, sources: { imdb: 1, metacritic: 1, rtCritic: 1, rtAudience: 1, tmdb: 1 } })
  const result = checkCoverage([stats], true)

  assert.equal(result.ok, false)
  assert.ok(reasons(result).includes('titles failed to score'))
})

test('scores that resolved but never persisted are caught', () => {
  assert.ok(reasons(checkCoverage([healthy({ notCached: 20 })], true)).includes('scores not persisted'))
})

test('a failed IMDb refresh is a problem even when every rate looks green', () => {
  const result = checkCoverage([healthy()], false)

  assert.equal(result.ok, false)
  assert.deepEqual(reasons(result), ['IMDb dataset refresh failed'])
})

test('an empty run is a problem, not a vacuous pass', () => {
  const stats = healthy({ total: 20, processed: 0, failed: 20, sources: {} })
  assert.ok(reasons(checkCoverage([stats], true)).includes('nothing processed'))
})
