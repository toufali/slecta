import { test } from 'node:test'
import assert from 'node:assert/strict'

// Same shape as verify.test.js: env.js only needs the keys to exist.
for (const key of ['TMDB_TOKEN', 'TMDB_API_URL', 'GCP_API_URL', 'GCP_API_KEY', 'GCP_SEARCH_ENGINE']) {
  process.env[key] ??= 'test'
}

const { default: tmdb } = await import('./tmdbService.js')

const respond = (status, body = '') => { globalThis.fetch = async () => new Response(body, { status }) }

for (const [label, method] of [['getMovieDetail', 'getMovieDetail'], ['getTvShowDetail', 'getTvShowDetail']]) {
  test(`${label} returns null when TMDB has no such title`, async () => {
    respond(404)
    assert.equal(await tmdb[method](999999999), null)
  })

  // The distinction that matters: callers must be able to tell "no such title" from
  // "the lookup failed", so an outage is never reported as a missing title.
  test(`${label} throws on an upstream 5xx`, async () => {
    respond(503)
    await assert.rejects(() => tmdb[method](550), /TMDB 503/)
  })

  test(`${label} throws on a rate limit rather than reporting a miss`, async () => {
    respond(429)
    await assert.rejects(() => tmdb[method](550), /TMDB 429/)
  })

  test(`${label} propagates a network error`, async () => {
    globalThis.fetch = async () => { throw new TypeError('fetch failed') }
    await assert.rejects(() => tmdb[method](550), /fetch failed/)
  })
}
