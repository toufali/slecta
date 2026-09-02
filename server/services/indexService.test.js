import { test } from 'node:test'
import assert from 'node:assert/strict'

for (const key of ['TMDB_TOKEN', 'TMDB_API_URL', 'GCP_API_URL', 'GCP_API_KEY', 'GCP_SEARCH_ENGINE']) {
  process.env[key] ??= 'test'
}

const { default: index, indexKey } = await import('./indexService.js')
const { default: tmdb } = await import('./tmdbService.js')
const { default: redis } = await import('./redisService.js')

// `init` never runs here, so the presentation config a card is built from has to be supplied
tmdb.imgConfig = { secure_base_url: 'https://img/', poster_sizes: ['w92'] }
tmdb.genres.movie = new Map([[35, 'Comedy'], [18, 'Drama']])
tmdb.ratings = ['G', 'PG', 'PG-13', 'R']

const ALL = ['imdb', 'metacritic', 'rtCritic', 'rtAudience']
const row = over => ({
  id: 1, title: 'A Film', posterPath: '/a.jpg', releaseDate: new Date().toISOString().substring(0, 10), genreIds: [35],
  votes: 100, certification: 'R', providers: [8], score: 80, sources: ALL, ...over
})

const stubIndex = rows => { redis.getCache = async key => key === indexKey('movies') ? rows : null }
const realGetCache = redis.getCache
const titles = data => data.movies.map(movie => movie.title)

async function listing(rows, query = {}) {
  stubIndex(rows)

  try {
    return await index.getList('movie', query)
  } finally {
    redis.getCache = realGetCache
  }
}

// Ungated, the head of the list is single-source audience scores — what the rule is for
test('a title with no critic score is not rankable', async () => {
  const data = await listing([
    row({ id: 1, title: 'metacritic', sources: ['imdb', 'metacritic'] }),
    row({ id: 2, title: 'rt critic', sources: ['imdb', 'rtCritic'] }),
    row({ id: 3, title: 'audience only', sources: ['imdb', 'rtAudience'] }),
    row({ id: 4, title: 'imdb alone', sources: ['imdb'] })
  ])

  assert.deepEqual(titles(data), ['metacritic', 'rt critic'])
})

// A source count would admit this: three of them, none a critic. Letterboxd lands here next.
test('any number of audience scores is still not a critic score', async () => {
  const data = await listing([row({ title: 'audiences only', sources: ['imdb', 'rtAudience', 'letterboxd'] })])

  assert.deepEqual(titles(data), [])
})

// Metacritic is the thinnest source, so requiring it rejected titles for its coverage, not theirs
test('a title RT reviewed but Metacritic did not is rankable', async () => {
  const data = await listing([row({ title: 'rt only', sources: ['imdb', 'rtCritic', 'rtAudience'] })])

  assert.deepEqual(titles(data), ['rt only'])
})

// The row's score ranks and filters; the rendered one comes from the score record. Passing it
// through would let a row whose record has expired serve a number Redis no longer holds.
test('a card carries no score of its own', async () => {
  const data = await listing([row()])

  assert.equal('score' in data.movies[0], false)
})

test('a card carries everything the card component renders', async () => {
  const [movie] = (await listing([row()])).movies

  assert.deepEqual(movie, {
    id: 1,
    title: 'A Film',
    genres: ['Comedy'],
    genreIds: [35],
    releaseDate: new Date().toISOString().substring(0, 10),
    posterThumb: 'https://img/w92/a.jpg',
    posterPath: '/a.jpg',
    tmdbScoreCount: 100,
    detailPath: '/movies/1'
  })
})

test('a genre filter keeps the titles carrying it', async () => {
  const data = await listing([
    row({ id: 1, title: 'comedy', genreIds: [35] }),
    row({ id: 2, title: 'drama', genreIds: [18] })
  ], { wg: '18' })

  assert.deepEqual(titles(data), ['drama'])
})

// The panel sends one value or several, and any of them matching is a match
test('several genres match any of them', async () => {
  const data = await listing([
    row({ id: 1, title: 'comedy', genreIds: [35] }),
    row({ id: 2, title: 'drama', genreIds: [18] }),
    row({ id: 3, title: 'neither', genreIds: [99] })
  ], { wg: ['18', '35'] })

  assert.deepEqual(titles(data), ['comedy', 'drama'])
})

test('a certification filter keeps its own rating', async () => {
  const data = await listing([
    row({ id: 1, title: 'restricted', certification: 'R' }),
    row({ id: 2, title: 'general', certification: 'G' })
  ], { wr: 'G' })

  assert.deepEqual(titles(data), ['general'])
})

test('the streaming filter drops a title no provider carries', async () => {
  const data = await listing([
    row({ id: 1, title: 'streaming', providers: [8] }),
    row({ id: 2, title: 'nowhere', providers: [] })
  ], { streaming: 'on' })

  assert.deepEqual(titles(data), ['streaming'])
})

// Changing the sort must not change what a filter means, so every parameter discover is sent has
// to hold here too
test('an excluded genre is dropped', async () => {
  const data = await listing([
    row({ id: 1, title: 'comedy', genreIds: [35] }),
    row({ id: 2, title: 'drama', genreIds: [18] })
  ], { wog: '35' })

  assert.deepEqual(titles(data), ['drama'])
})

// The index is built at the catalogue's own floor, so an override can only narrow from there
test('a vote override narrows the list', async () => {
  const rows = [row({ id: 1, title: 'popular', votes: 500 }), row({ id: 2, title: 'obscure', votes: 30 })]

  assert.deepEqual(titles(await listing(rows, { minVotes: '200' })), ['popular'])
  assert.deepEqual(titles(await listing(rows)), ['popular', 'obscure'])
})

// An incomplete walk keeps rows it could not confirm, so one can outlast the window it came from.
// Discover bounds its own results; here the bound has to be applied on the way out.
test('a title that has left the release window is dropped', async () => {
  const data = await listing([
    row({ id: 1, title: 'in window', releaseDate: new Date().toISOString().substring(0, 10) }),
    row({ id: 2, title: 'long past', releaseDate: '2019-04-01' }),
    row({ id: 3, title: 'unreleased', releaseDate: '2099-01-01' })
  ])

  assert.deepEqual(titles(data), ['in window'])
})

test('a page is twenty titles, and the count follows the filter', async () => {
  const rows = Array.from({ length: 45 }, (_, i) => row({ id: i, title: `t${i}` }))
  const first = await listing(rows)
  const last = await listing(rows, { page: '3' })

  assert.equal(first.movies.length, 20)
  assert.equal(first.totalPages, 3)
  assert.equal(first.totalResults, 45)
  assert.equal(last.movies.length, 5, 'the last page is the remainder')
})

// Publishing an empty page over a failed read would read as "the filter found nothing"
test('an index that cannot be read is not an empty list', async () => {
  redis.getCache = async () => undefined

  try {
    assert.equal(await index.getList('movie', {}), undefined)
  } finally {
    redis.getCache = realGetCache
  }
})

test('a filter matching nothing is an empty page, not a failure', async () => {
  const data = await listing([row({ genreIds: [35] })], { wg: '99' })

  assert.deepEqual(titles(data), [])
  assert.equal(data.totalResults, 0)
})

// The view cannot tell the two list paths apart, so the panel's own options have to come through
test('the page carries the same shape a discover page does', async () => {
  const data = await listing([row()], { sort: 'score' })

  assert.equal(data.sortBy, 'score')
  assert.ok(data.allSorting.some(option => option.value === 'score'))
  assert.equal(data.allGenres.get(35), 'Comedy')
  assert.ok(data.allRatings, 'movies carry certifications')
})
