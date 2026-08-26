import { test } from 'node:test'
import assert from 'node:assert/strict'

// Same shape as checks.test.js: env.js only needs the keys to exist.
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

// A caller has to be able to tell an outage from an empty catalogue, so a failure propagates
for (const [label, method] of [['getMovies', 'getMovies'], ['getTvShows', 'getTvShows'], ['getTitlesByString', 'getTitlesByString']]) {
  test(`${label} throws on an upstream 5xx`, async () => {
    respond(503)
    await assert.rejects(() => tmdb[method]('dune'), /TMDB 503/)
  })

  test(`${label} throws on a rate limit`, async () => {
    respond(429)
    await assert.rejects(() => tmdb[method]('dune'), /TMDB 429/)
  })

  test(`${label} propagates a network error`, async () => {
    globalThis.fetch = async () => { throw new TypeError('fetch failed') }
    await assert.rejects(() => tmdb[method]('dune'), /fetch failed/)
  })
}


// Coercing an absent page count to 1 made twenty titles look like the whole window to the nightly
// walk, so the absence has to stay visible for the job's completeness check to fire
for (const method of ['getMovies', 'getTvShows']) {
  test(`${method} leaves the page count unusable when TMDB omits total_pages`, async () => {
    respond(200, JSON.stringify({ results: [], total_results: 538 }))

    const data = await tmdb[method]()

    assert.ok(!Number.isFinite(data.totalPages), `expected an unusable page count, got ${data.totalPages}`)
    assert.equal(data.totalResults, 538)
  })
}
