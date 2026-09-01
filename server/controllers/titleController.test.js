import { test } from 'node:test'
import assert from 'node:assert/strict'

// Same shape as the service tests: env.js only needs the keys to exist.
for (const key of ['TMDB_TOKEN', 'TMDB_API_URL', 'GCP_API_URL', 'GCP_API_KEY', 'GCP_SEARCH_ENGINE']) {
  process.env[key] ??= 'test'
}

const { getList, getDetail, getScore, getQuotes } = await import('./titleController.js')
const { scoreKey } = await import('../services/scoreService.js')
const { default: tmdb } = await import('../services/tmdbService.js')
const { default: scoreService } = await import('../services/scoreService.js')
const { default: reviewService } = await import('../services/reviewService.js')

// Serving one catalogue from the other is the one way this could fail without changing a response
// shape, so every wire out of the controller is recorded and named.
function recordCalls() {
  const calls = []
  const rows = segment => ({ [segment]: [{ id: 1 }], allGenres: new Map([[28, 'Action']]) })

  tmdb.getMovies = async () => { calls.push(['list:movie']); return rows('movies') }
  tmdb.getTvShows = async () => { calls.push(['list:tv']); return rows('shows') }
  tmdb.getMovieDetail = async id => { calls.push(['detail:movie', id]); return { title: 'A Movie', tmdbScore: 7 } }
  tmdb.getTvShowDetail = async id => { calls.push(['detail:tv', id]); return { title: 'A Show', tmdbScore: 7 } }
  scoreService.getScoreFromCache = async key => { calls.push(['scoreCache', key]); return null }
  scoreService.getScore = async (key, data) => { calls.push(['score', key, data.mediaType]); return { avgScore: 70 } }
  // Defaulted as the service defaults it, so the assertion is on the effective type rather than
  // on whether the argument was passed explicitly
  reviewService.getQuotes = async (id, name, date, mediaType = 'movie') => { calls.push(['quotes', id, mediaType]); return [] }

  return calls
}

const context = () => ({
  query: {}, params: { id: 7 }, headers: {},
  set(name, value) { this.headers[name.toLowerCase()] = value }
})

const MEDIA = [
  { mediaType: 'movie', segment: 'movies' },
  { mediaType: 'tv', segment: 'shows' }
]

for (const { mediaType, segment } of MEDIA) {
  test(`the ${mediaType} list reads its own catalogue and keys badges to its own segment`, async () => {
    const calls = recordCalls()
    const ctx = context()

    await getList(mediaType)(ctx)

    assert.deepEqual(calls, [[`list:${mediaType}`], ['scoreCache', scoreKey(segment, 1)]])
    assert.deepEqual(ctx.body[segment], [{ id: 1 }])
    // A Map cannot cross JSON, so the API path converts it and the page path does not
    assert.deepEqual(ctx.body.allGenres, [[28, 'Action']])
  })

  test(`the ${mediaType} detail reads its own catalogue`, async () => {
    const calls = recordCalls()
    const ctx = context()

    await getDetail(mediaType)(ctx)

    assert.deepEqual(calls, [[`detail:${mediaType}`, 7]])
  })

  test(`a ${mediaType} score is keyed and scored as a ${mediaType}`, async () => {
    const calls = recordCalls()
    const ctx = context()

    await getScore(mediaType)(ctx)

    assert.deepEqual(calls, [
      ['scoreCache', scoreKey(segment, 7)],
      [`detail:${mediaType}`, 7],
      ['score', scoreKey(segment, 7), mediaType]
    ])
  })

  // The quotes key is `${mediaType}s/...`, so the type has to reach the service or a movie and a
  // show sharing a TMDB id collide
  test(`${mediaType} quotes carry their media type to the service`, async () => {
    const calls = recordCalls()
    const ctx = context()

    await getQuotes(mediaType)(ctx)

    assert.deepEqual(calls, [['quotes', 7, mediaType]])
  })
}

// A cache hit must not go on to fetch the title, which is what the header is reporting
test('a cached score is served without touching TMDB', async () => {
  const calls = recordCalls()
  scoreService.getScoreFromCache = async () => ({ avgScore: 81 })
  const ctx = context()

  await getScore('movie')(ctx)

  assert.deepEqual(calls, [])
  assert.deepEqual(ctx.body, { avgScore: 81 })
  assert.equal(ctx.headers['x-server-cache-hit'], 'true')
})
