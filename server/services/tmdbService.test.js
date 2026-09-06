import { test } from 'node:test'
import assert from 'node:assert/strict'

// Same shape as checks.test.js: env.js only needs the keys to exist.
for (const key of ['TMDB_TOKEN', 'TMDB_API_URL', 'GCP_API_URL', 'GCP_API_KEY', 'GCP_SEARCH_ENGINE']) {
  process.env[key] ??= 'test'
}

const { default: tmdb } = await import('./tmdbService.js')
const { default: redis } = await import('./redisService.js')

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
  poster_path: '/p.jpg', vote_average: 7.5, vote_count: 99, popularity: 12,
  original_language: 'ja'
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

// Ad-supported is watchable now, which is what the filter asks, so both catalogues count it. Movies
// excluding it also put the ranked path five titles ahead of discover, which had no way to exclude it.
test('both catalogues count ad-supported as streaming', async () => {
  const seen = captureUrl()

  await tmdb.getMovies({ streaming: 'true' })
  await tmdb.getTvShows({ streaming: 'true' })

  for (const url of seen) {
    assert.match(decodeURIComponent(url), /with_watch_monetization_types=buy\|free\|flatrate\|rent\|ads$/)
  }
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

// A walk is many requests, so the window has to be the walk's rather than each page's — pages either
// side of midnight would be bounded by different days and shift titles across page boundaries
test('a supplied window is used instead of the clock', async () => {
  const seen = captureUrl()

  await tmdb.getMovies({ page: 2, months: '1' }, { from: '2001-01-01', to: '2001-12-31' })

  assert.match(decodeURIComponent(seen[0]), /primary_release_date\.gte=2001-01-01/)
  assert.match(decodeURIComponent(seen[0]), /primary_release_date\.lte=2001-12-31/)
})

// Two clock reads either side of midnight gave a window a day narrow, so the instant is passed in
// and used twice rather than read twice
test('the window is twelve months back from one instant', () => {
  assert.deepEqual(tmdb.dateWindow(undefined, new Date('2026-09-02T23:59:59.999Z')), { from: '2025-09-02', to: '2026-09-02' })
  assert.deepEqual(tmdb.dateWindow(undefined, new Date('2026-09-03T00:00:00.000Z')), { from: '2025-09-03', to: '2026-09-03' })
})

// One reading of the window, whichever sort is asked for, so the lookback cannot mean two things
test('a lookback narrows the window discover is sent', async () => {
  const seen = captureUrl()

  await tmdb.getMovies({ months: '3' })
  await tmdb.getTvShows({ months: '3' })
  await tmdb.getMovies()

  // Read as the span between the bounds sent, since which day they land on is tested on its own
  const monthsBack = url => {
    const bound = name => decodeURIComponent(url).match(new RegExp(`date\\.${name}=(\\d+)-(\\d+)`)).slice(1).map(Number)
    const [[fromYear, fromMonth], [toYear, toMonth]] = [bound('gte'), bound('lte')]

    return (toYear - fromYear) * 12 + toMonth - fromMonth
  }

  assert.equal(monthsBack(seen[0]), 3)
  assert.equal(monthsBack(seen[1]), 3, 'both catalogues, or a sort change moves the window')
  assert.equal(monthsBack(seen[2]), 12, 'absent means the whole catalogue')
})

// The window is mandatory, so a lookback that cannot be honoured falls back to the catalogue's own
// rather than to none: unbounded means paging the whole of TMDB
test('a lookback outside the range reads as the widest, not as itself', () => {
  // A fraction included: it is a request the panel cannot make, so it reads as unusable rather than
  // as the whole month it truncates to
  for (const months of [undefined, '', '0', '-6', '13', '99', 'abc', '1.9', 2.5, ['3', '5']]) {
    assert.equal(tmdb.lookback(months), tmdb.lookbackMax, JSON.stringify(months))
  }

  assert.equal(tmdb.lookback('1'), 1)
  assert.equal(tmdb.lookback('12'), 12)
  assert.equal(tmdb.lookback(5), 5)
})

// The window is formatted as UTC, so the arithmetic has to be UTC too: read through the local
// calendar it shifted a day east of the line, which is the bug class the slug year check already hit
test('the window does not depend on the host timezone', () => {
  const real = process.env.TZ
  // Paired with a lookback where one is what makes the instant interesting: a month end rolls back
  const instants = [['2028-02-29T12:00:00Z'], ['2026-09-02T23:59:59.999Z'], ['2026-01-01T00:30:00Z'],
    ['2026-08-31T12:00:00Z', 6], ['2026-03-31T00:30:00Z', 1]]

  try {
    const windows = instants.map(([at, months]) => {
      return ['UTC', 'Pacific/Kiritimati', 'Pacific/Midway'].map(tz => {
        process.env.TZ = tz
        return JSON.stringify(tmdb.dateWindow(months, new Date(at)))
      })
    })

    for (const [i, perZone] of windows.entries()) {
      assert.equal(new Set(perZone).size, 1, `${instants[i][0]} gave ${perZone.join(' vs ')}`)
    }
  } finally {
    // Deleted rather than reassigned when it was unset: assigning undefined stores the string
    // "undefined", which is not a zone and would leave every later test running somewhere else
    if (real === undefined) delete process.env.TZ
    else process.env.TZ = real
  }
})

// Month arithmetic overflows a target month too short to hold the day, landing inside the month after
// and dropping the oldest days of the window asked for
test('a lookback from a month end lands on a month end', () => {
  assert.deepEqual(tmdb.dateWindow(6, new Date('2026-08-31T12:00:00.000Z')), { from: '2026-02-28', to: '2026-08-31' })
  assert.deepEqual(tmdb.dateWindow(1, new Date('2026-03-31T12:00:00.000Z')), { from: '2026-02-28', to: '2026-03-31' })
  // A leap day has no counterpart twelve months back either
  assert.deepEqual(tmdb.dateWindow(undefined, new Date('2028-02-29T12:00:00.000Z')), { from: '2027-02-28', to: '2028-02-29' })
})

// The ranked filter reads this off the row, so a typo here fails every ranked language request while
// leaving the discover path correct
test('each catalogue maps the original language onto its rows', async () => {
  captureUrl()

  assert.equal((await tmdb.getMovies()).movies[0].originalLanguage, 'ja')
  assert.equal((await tmdb.getTvShows()).shows[0].originalLanguage, 'ja')
})

// TMDB uses `cn` for Cantonese, which is not an ISO 639-1 code, so `Intl` answers with the code
test('the detail page names a language, including the code Intl does not know', async () => {
  captureDetail({ original_language: 'cn' })

  assert.equal((await tmdb.getMovieDetail(11)).language, 'Cantonese')

  captureDetail({ original_language: 'ja' })

  assert.equal((await tmdb.getMovieDetail(12)).language, 'Japanese')
})

// The panel needs its own state back, or the checkbox renders unticked on the next page
test('a list page carries the language choice and sends the code', async () => {
  const seen = captureUrl()

  assert.equal((await tmdb.getMovies({ english: 'on' })).inEnglish, 'on')
  assert.equal((await tmdb.getMovies()).inEnglish, undefined)

  assert.match(decodeURIComponent(seen[0]), /with_original_language=en(&|$)/)
  assert.doesNotMatch(seen[1], /with_original_language/, 'unticked is no filter, not an empty one')
})

// The validator bounds both by these, so losing a wiring rejects every value rather than only the
// out-of-range ones — an unwired lookback 400s every submit the panel makes
test('the filter rules carry the catalogue vote floor and lookback', () => {
  for (const mediaType of ['movie', 'tv']) {
    assert.equal(tmdb.filterRules(mediaType).minVotes, tmdb.minVotes, mediaType)
    assert.equal(tmdb.filterRules(mediaType).lookbackMax, tmdb.lookbackMax, mediaType)
  }
})

// The view cannot tell the two list paths apart, so the slider's own state has to come from both
test('a list page carries the lookback the panel renders', async () => {
  captureUrl()

  const narrowed = await tmdb.getMovies({ months: '3' })

  assert.equal(narrowed.lookback, 3)
  assert.equal(narrowed.lookbackMax, tmdb.lookbackMax)
  assert.equal((await tmdb.getTvShows()).lookback, tmdb.lookbackMax, 'absent means the widest')
})

// `filterRules` reports no TV ratings, so the panel must not be offered them either
test('the ratings filter is offered for movies and withheld for TV', async () => {
  captureUrl()

  assert.ok((await tmdb.getMovies()).allRatings !== undefined)
  assert.equal('allRatings' in await tmdb.getTvShows(), false)
  assert.equal(tmdb.filterRules('tv').ratings, undefined)
  assert.ok(tmdb.filterRules('movie').ratings !== undefined)
})


// The detail pair diverges further than the list pair: different appended resources, a different
// place to read the certificate from, a different credits payload, and different extra fields.
const DETAIL = {
  id: 7, overview: 'x', vote_average: 7.5, backdrop_path: null,
  external_ids: { imdb_id: 'tt1', wikidata_id: 'Q1' },
  'watch/providers': { results: {} },
  videos: { results: [] },
  original_language: 'en',
  genres: [{ name: 'Action' }],
  // movie-side
  title: 'A Movie', release_date: '2026-01-02', runtime: 100,
  release_dates: { results: [{ iso_3166_1: 'US', release_dates: [{ certification: 'PG-13' }] }] },
  credits: { cast: [{ name: 'Lead' }], crew: [{ job: 'Director', name: 'A Director' }] },
  // tv-side
  name: 'A Show', first_air_date: '2026-03-04', number_of_seasons: 3,
  content_ratings: { results: [{ iso_3166_1: 'US', rating: 'TV-MA' }] },
  aggregate_credits: { cast: [{ name: 'Regular' }] },
  created_by: [{ name: 'A Creator' }]
}

function captureDetail(over) {
  const seen = []

  globalThis.fetch = async url => {
    seen.push(String(url))
    return new Response(JSON.stringify({ ...DETAIL, ...over }), { status: 200 })
  }

  return seen
}

test('each detail asks its own endpoint and appends only what it can read', async () => {
  const seen = captureDetail()

  await tmdb.getMovieDetail(7)
  await tmdb.getTvShowDetail(7)

  assert.match(decodeURIComponent(seen[0]), /\/movie\/7\?append_to_response=videos,release_dates,watch\/providers,external_ids,credits$/)
  assert.match(decodeURIComponent(seen[1]), /\/tv\/7\?append_to_response=videos,watch\/providers,external_ids,aggregate_credits,content_ratings$/)
})

// A movie certificate lives under the release date for the region; a TV one has its own resource
test('the certificate comes from each catalogue\'s own resource', async () => {
  captureDetail()

  assert.equal((await tmdb.getMovieDetail(7)).rating, 'PG-13')
  assert.equal((await tmdb.getTvShowDetail(7)).rating, 'TV-MA')
})

test('a movie carries a director and a runtime, a show a creator and a season count', async () => {
  captureDetail()

  const movie = await tmdb.getMovieDetail(7)
  const show = await tmdb.getTvShowDetail(7)

  assert.deepEqual(
    [movie.title, movie.releaseDate, movie.cast, movie.director, movie.runtime],
    ['A Movie', '2026-01-02', 'Lead', 'A Director', 100]
  )
  assert.deepEqual(
    [show.title, show.releaseDate, show.cast, show.creator, show.seasons],
    ['A Show', '2026-03-04', 'Regular', 'A Creator', 3]
  )
  assert.equal('director' in show, false)
  assert.equal('seasons' in movie, false)
})

// The nightly check fails a settled title missing any of these, so a field renamed in one place and
// not the other passes every test and fails against TMDB
test('every field the nightly check requires is one the detail record carries', async () => {
  const { REQUIRED_DETAIL } = await import('../jobs/checks.js')

  captureDetail()

  for (const [mediaType, detail] of [['movie', await tmdb.getMovieDetail(7)], ['tv', await tmdb.getTvShowDetail(7)]]) {
    for (const field of REQUIRED_DETAIL[mediaType]) {
      assert.ok(field in detail, `${mediaType} detail has no ${field}`)
    }
  }
})

// The cached object is stored and served as JSON, so its key order is part of the shape
test('the stored field order is unchanged for both catalogues', async () => {
  captureDetail()

  assert.deepEqual(Object.keys(await tmdb.getMovieDetail(7)), [
    'tmdbId', 'imdbId', 'wikiId', 'title', 'overview', 'releaseDate',
    'rating', 'cast', 'director', 'runtime',
    'language', 'genres', 'providers', 'backdropUrl', 'ytTrailerId'
  ])
  assert.deepEqual(Object.keys(await tmdb.getTvShowDetail(7)), [
    'tmdbId', 'imdbId', 'wikiId', 'title', 'overview', 'releaseDate',
    'cast', 'creator', 'rating', 'seasons',
    'language', 'genres', 'providers', 'backdropUrl', 'ytTrailerId'
  ])
})


// One constant decides both what the job scores and what a visitor can browse to
test('the vote floor reaches the query for both catalogues, and a caller can override it', async () => {
  const seen = captureUrl()

  await tmdb.getMovies()
  await tmdb.getTvShows()
  await tmdb.getMovies({ minVotes: 200 })

  assert.match(seen[0], /vote_count\.gte=25(&|$)/)
  assert.match(seen[1], /vote_count\.gte=25(&|$)/)
  assert.match(seen[2], /vote_count\.gte=200(&|$)/)
})

// A list response used to be cached whole, including this service's own config, so adding a sort
// option left it missing from every cached browse page until the entries expired a day later
test('a cached list is reshaped on the way out, not served as it was stored', async () => {
  const realGetCache = redis.getCache

  tmdb.genres.movie = new Map([[28, 'Action']])
  tmdb.ratings = ['R']
  // Stored before Top Rated existed, and with the wrong query echoed back
  redis.getCache = async () => ({ movies: [], allSorting: [{ name: 'Most Recent', value: 'stale' }], sortBy: 'stale' })

  try {
    const data = await tmdb.getMovies({ sort: 'score', months: '2' })

    assert.deepEqual(data.allSorting.map(option => option.value),
      ['primary_release_date.desc', 'popularity.desc', 'score'])
    assert.equal(data.sortBy, 'score')
    assert.equal(data.lookback, 2, 'the slider reads the request, not the stored page')
  } finally {
    redis.getCache = realGetCache
  }
})
