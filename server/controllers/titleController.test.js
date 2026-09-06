import { test } from 'node:test'
import assert from 'node:assert/strict'

// Same shape as the service tests: env.js only needs the keys to exist.
for (const key of ['TMDB_TOKEN', 'TMDB_API_URL', 'GCP_API_URL', 'GCP_API_KEY', 'GCP_SEARCH_ENGINE']) {
  process.env[key] ??= 'test'
}

const { showDetail, getList, getDetail, getScore, getQuotes } = await import('./titleController.js')
const { scoreKey } = await import('../services/scoreService.js')
const { default: tmdb } = await import('../services/tmdbService.js')
const { default: scoreService } = await import('../services/scoreService.js')
const { default: reviewService } = await import('../services/reviewService.js')
const { default: index } = await import('../services/indexService.js')

// Serving one catalogue from the other is the one way this could fail without changing a response
// shape, so every wire out of the controller is recorded and named.
function recordCalls() {
  const calls = []
  const rows = segment => ({ [segment]: [{ id: 1 }], allGenres: new Map([[28, 'Action']]) })

  index.getList = async mediaType => { calls.push([`index:${mediaType}`]); return rows(mediaType === 'movie' ? 'movies' : 'shows') }
  tmdb.getMovies = async () => { calls.push(['list:movie']); return rows('movies') }
  tmdb.getTvShows = async () => { calls.push(['list:tv']); return rows('shows') }
  tmdb.getMovieDetail = async id => { calls.push(['detail:movie', id]); return { title: 'A Movie', tmdbScore: 7 } }
  tmdb.getTvShowDetail = async id => { calls.push(['detail:tv', id]); return { title: 'A Show', tmdbScore: 7, seasons: 1 } }
  scoreService.getScoreFromCache = async key => { calls.push(['scoreCache', key]); return null }
  // `seasons` recorded too: it decides which RT page is read, so a detail field that stops here
  // silently reverts TV to the banded series page
  scoreService.getScore = async (key, data, tryCache) => { calls.push(['score', key, data.mediaType, tryCache, data.seasons]); return { scores: { imdb: 70 } } }
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
  { mediaType: 'tv', segment: 'shows', seasons: 1 }
]

for (const { mediaType, segment, seasons } of MEDIA) {
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
      // Undefined, not false: the detail fetch above gives another request time to fill the cache,
      // so the score lookup has to check it again before paying for the sources
      ['score', scoreKey(segment, 7), mediaType, undefined, seasons]
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
  scoreService.getScoreFromCache = async () => ({ scores: { imdb: 81 } })
  const ctx = context()

  await getScore('movie')(ctx)

  assert.deepEqual(calls, [])
  // Both derived here: the browser would need the weighting thresholds to work either out
  assert.deepEqual(ctx.body, { scores: { imdb: 81 }, avgScore: 81, lowConfidence: true },
    'the aggregate is derived into the response the browser reads')
  assert.equal(ctx.headers['x-server-cache-hit'], 'true')
})

// Top Rated is the one sort discover cannot serve, and serving the wrong catalogue from the index
// would not change any response shape — so the wire is named, per media type
for (const { mediaType, segment } of MEDIA) {
  test(`sorting by score serves ${segment} from the index, not from discover`, async () => {
    const calls = recordCalls()
    const ctx = context()

    ctx.query = { sort: 'score' }
    await getList(mediaType)(ctx)

    assert.ok(calls.some(call => call[0] === `index:${mediaType}`), `expected the index, got ${JSON.stringify(calls)}`)
    assert.equal(calls.some(call => call[0].startsWith('list:')), false, 'discover must not be asked')
    assert.ok(ctx.body[segment], 'the page carries its own segment')
    // The badge comes from the score record even here, so the rows still go through the score cache
    assert.ok(calls.some(call => call[0] === 'scoreCache' && call[1] === scoreKey(segment, 1)))
  })
}

// An empty page would read as "the filter found nothing" when in fact we failed to ask
test('an unreadable index fails the request rather than serving an empty page', async () => {
  recordCalls()
  index.getList = async () => undefined

  const ctx = context()
  let thrown

  ctx.query = { sort: 'score' }
  ctx.throw = status => { thrown = status; throw new Error(String(status)) }

  await assert.rejects(() => getList('movie')(ctx))
  assert.equal(thrown, 503)
})

test('any other sort still goes to discover', async () => {
  const calls = recordCalls()
  const ctx = context()

  ctx.query = { sort: 'popularity.desc' }
  await getList('movie')(ctx)

  assert.deepEqual(calls.filter(call => call[0].startsWith('index:') || call[0].startsWith('list:')), [['list:movie']])
})

// The mark is derived here from the stored record, not carried on the detail data, so a detail page
// rendering a settled badge for a thin score is a failure only this reaches
test('the detail page marks a thin score and leaves a settled one alone', async () => {
  const thin = { scores: { imdb: 81 }, counts: { imdb: 200 } }
  const settled = { scores: { imdb: 81 }, counts: { imdb: 900_000 } }

  // The scoreless case included: a badge showing a dash has no number for the ring to qualify
  const scoreless = { scores: {}, counts: {} }

  for (const [record, marked] of [[thin, true], [settled, false], [scoreless, false]]) {
    recordCalls()
    scoreService.getScoreFromCache = async () => record
    reviewService.getQuotesFromCache = async () => []

    const ctx = context()

    await showDetail('movie')(ctx)

    assert.equal(/low-confidence>/.test(ctx.body), marked, JSON.stringify(record))
    assert.equal(/<p class='unsettled'>/.test(ctx.body), marked, 'the line in words follows the ring')
  }
})

// A record no source could score has no number for a mark to qualify
test('a record with no score is not marked', async () => {
  recordCalls()
  scoreService.getScoreFromCache = async () => ({ scores: {}, counts: {} })

  const ctx = context()

  await getScore('movie')(ctx)

  assert.equal(ctx.body.avgScore, undefined)
  assert.equal(ctx.body.lowConfidence, false)
})
