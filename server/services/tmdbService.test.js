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


// The two catalogues differ in a dozen small ways that used to live in two copies of one method.
// These pin the ones a merge could quietly get wrong — the pair had already drifted once, on the
// release-date field.
const ROW = {
  id: 7, title: 'A Movie', name: 'A Show', genre_ids: [28],
  release_date: '2026-01-02', first_air_date: '2026-03-04',
  poster_path: '/p.jpg', vote_average: 7.5, vote_count: 99, popularity: 12
}

// init is not run in this file, so supply only the fields the row mapping reads. Set once: the
// tests above never reach the mapping, so nothing there depends on these being absent.
tmdb.imgConfig = { secure_base_url: 'https://img/', poster_sizes: ['w92'] }
tmdb.genres = { movie: new Map([[28, 'Action']]), show: new Map([[28, 'Action & Adventure']]) }
tmdb.ratings = ['PG-13', 'R']

function captureUrl(results = [ROW]) {
  const seen = []

  globalThis.fetch = async url => {
    seen.push(String(url))
    return new Response(JSON.stringify({ results, total_pages: 3, total_results: 60 }), { status: 200 })
  }

  return seen
}

test('each catalogue asks its own discover endpoint over its own date field', async () => {
  const seen = captureUrl()

  await tmdb.getMovies()
  await tmdb.getTvShows()

  assert.match(seen[0], /\/discover\/movie\?/)
  assert.match(seen[0], /primary_release_date\.lte=/)
  assert.match(seen[1], /\/discover\/tv\?/)
  assert.match(seen[1], /first_air_date\.lte=/)
})

// TMDB has no TV equivalent for either, and sending them anyway would be silently ignored
test('include_video and certification_country are movie-only', async () => {
  const seen = captureUrl()

  await tmdb.getMovies({ wr: 'R' })
  await tmdb.getTvShows({ wr: 'R' })

  assert.match(seen[0], /include_video=/)
  assert.match(seen[0], /certification_country=/)
  assert.doesNotMatch(seen[1], /include_video=/)
  assert.doesNotMatch(seen[1], /certification(_country)?=/)
})

test('TV alone counts ad-supported as streaming', async () => {
  const seen = captureUrl()

  await tmdb.getMovies({ streaming: 'true' })
  await tmdb.getTvShows({ streaming: 'true' })

  assert.match(decodeURIComponent(seen[0]), /with_watch_monetization_types=buy\|free\|flatrate\|rent$/)
  assert.match(decodeURIComponent(seen[1]), /with_watch_monetization_types=buy\|free\|flatrate\|rent\|ads$/)
})

test('a row takes its title, date and genre names from its own catalogue', async () => {
  captureUrl()

  const movie = (await tmdb.getMovies()).movies[0]
  const show = (await tmdb.getTvShows()).shows[0]

  assert.deepEqual(
    [movie.title, movie.releaseDate, movie.genres, movie.detailPath],
    ['A Movie', '2026-01-02', ['Action'], '/movies/7']
  )
  assert.deepEqual(
    [show.title, show.releaseDate, show.genres, show.detailPath],
    ['A Show', '2026-03-04', ['Action & Adventure'], '/shows/7']
  )
})

// `filterRules` reports no TV ratings, so the panel must not be offered them either
test('the ratings filter is offered for movies and withheld for TV', async () => {
  captureUrl()

  assert.ok((await tmdb.getMovies()).allRatings !== undefined)
  assert.equal('allRatings' in await tmdb.getTvShows(), false)
  assert.equal(tmdb.filterRules('tv').ratings, undefined)
  assert.ok(tmdb.filterRules('movie').ratings !== undefined)
})
