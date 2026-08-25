import { test } from 'node:test'
import assert from 'node:assert/strict'

for (const key of ['TMDB_TOKEN', 'TMDB_API_URL', 'GCP_API_URL', 'GCP_API_KEY', 'GCP_SEARCH_ENGINE']) {
  process.env[key] ??= 'test'
}
process.env.REDIS_URL = ''

const { cacheScores } = await import('./cacheScores.js')

// A list lookup that throws must not abandon the run: the empty batch reports as
// "nothing processed", which the coverage check already fails on.
test('a failed list lookup is reported, not fatal', async () => {
  globalThis.fetch = async () => new Response('', { status: 503 })

  const result = await cacheScores()

  assert.deepEqual(result.stats.map(s => s.total), [0, 0])
  assert.equal(result.coverage.ok, false)
  assert.ok(result.coverage.problems.some(p => p.reason === 'nothing processed'))
})
