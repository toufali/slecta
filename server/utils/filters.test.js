import { test } from 'node:test'
import assert from 'node:assert/strict'
import { invalidFilters } from './filters.js'

const MOVIE_RATINGS = [{ certification: 'R' }, { certification: 'PG-13' }]

const MOVIE = {
  pageMax: 500,
  minVotes: 25,
  lookbackMax: 12,
  sorts: [{ name: 'Most Recent', value: 'primary_release_date.desc' }, { name: 'Popularity', value: 'popularity.desc' }],
  genres: new Map([[27, 'Horror'], [878, 'Science Fiction']]),
  ratings: MOVIE_RATINGS
}
const SHOW = {
  pageMax: 500,
  minVotes: 25,
  lookbackMax: 12,
  sorts: [{ name: 'Most Recent', value: 'first_air_date.desc' }],
  genres: new Map([[18, 'Drama'], [10765, 'Sci-Fi & Fantasy']])
}

test('a request from the filter panel passes', () => {
  const query = { sort: 'popularity.desc', wg: ['27', '878'], wr: 'R', page: '3', streaming: 'on', minVotes: '50', months: '6', english: 'on' }

  assert.deepEqual(invalidFilters(query, MOVIE), [])
})

test('page must be within the range TMDB serves', () => {
  for (const page of ['0', '-1', '501', 'abc', '1.5', 'gravitysmtp-settings']) {
    assert.deepEqual(invalidFilters({ page }, MOVIE), ['page'], page)
  }
  assert.deepEqual(invalidFilters({ page: '500' }, MOVIE), [])
})

test('a lookback is whole months inside the catalogue window', () => {
  for (const months of ['0', '-1', '13', 'abc', '1.5']) {
    assert.deepEqual(invalidFilters({ months }, MOVIE), ['months'], months)
  }
  for (const months of ['1', '6', '12', '']) {
    assert.deepEqual(invalidFilters({ months }, SHOW), [], months)
  }
})

// Discover ignores an original-language value it does not know and answers with everything
test('the language filter takes only the value the checkbox sends', () => {
  for (const english of ['true', 'en', 'yes', 'On']) {
    assert.deepEqual(invalidFilters({ english }, MOVIE), ['english'], english)
  }
  for (const english of ['on', '']) {
    assert.deepEqual(invalidFilters({ english }, SHOW), [], english)
  }
})

test('a sort key belonging to the other media type is rejected', () => {
  assert.deepEqual(invalidFilters({ sort: 'first_air_date.desc' }, MOVIE), ['sort'])
  assert.deepEqual(invalidFilters({ sort: 'primary_release_date.desc' }, SHOW), ['sort'])
})

test('a genre id absent from this media type is rejected', () => {
  // 27 is Horror for film; TMDB has no such genre for television
  assert.deepEqual(invalidFilters({ wg: '27' }, SHOW), ['wg'])
  assert.deepEqual(invalidFilters({ wg: '99999' }, MOVIE), ['wg'])
  assert.deepEqual(invalidFilters({ wog: 'notanumber' }, MOVIE), ['wog'])
})

test('every value of a repeated filter is checked', () => {
  assert.deepEqual(invalidFilters({ wg: ['27', '878'] }, MOVIE), [])
  assert.deepEqual(invalidFilters({ wg: ['27', '99999'] }, MOVIE), ['wg'])
})

test('a comma-joined filter is rejected, since TMDB reads it as AND', () => {
  // The panel repeats the param instead, which TMDB reads as OR and the view can label
  assert.deepEqual(invalidFilters({ wg: '27,878' }, MOVIE), ['wg'])
  assert.deepEqual(invalidFilters({ wr: 'R,PG-13' }, MOVIE), ['wr'])
  assert.deepEqual(invalidFilters({ page: '1,2' }, MOVIE), ['page'])
})

test('a filter the panel only sends once is rejected when repeated', () => {
  // Two of them reach the view as an array, which no sort option can match
  assert.deepEqual(invalidFilters({ sort: ['popularity.desc', 'popularity.desc'] }, MOVIE), ['sort'])
  assert.deepEqual(invalidFilters({ page: ['1', '2'] }, MOVIE), ['page'])
})

test('a prototype the querystring put there is rejected', () => {
  // Assigned the way the query parser does it, which replaces the prototype rather than adding a key
  const query = {}
  query.__proto__ = ['0', '0']

  assert.equal(typeof query.sort, 'function', 'inherited from the array, readable as a filter')
  assert.deepEqual(invalidFilters(query, MOVIE), ['__proto__'])
})

test('a query Koa returned from its own cache is left alone', () => {
  // Some querystrings make Koa's own query cache hand back a function
  assert.deepEqual(invalidFilters(Object.prototype.toString, MOVIE), [])
})

test('streaming takes only the value the checkbox sends', () => {
  assert.deepEqual(invalidFilters({ streaming: 'on' }, MOVIE), [])
  // Otherwise the filter applies while the page renders the box unchecked
  assert.deepEqual(invalidFilters({ streaming: 'off' }, MOVIE), ['streaming'])
  assert.deepEqual(invalidFilters({ streaming: 'false' }, MOVIE), ['streaming'])
})

test('a blank among several values is rejected, though a lone blank means absent', () => {
  assert.deepEqual(invalidFilters({ wg: ['', ''] }, MOVIE), ['wg'])
  assert.deepEqual(invalidFilters({ wg: ['27', ''] }, MOVIE), ['wg'])
  assert.deepEqual(invalidFilters({ wg: '' }, MOVIE), [])
})

test('a param named after an Object.prototype member is not treated as a check', () => {
  for (const name of ['hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', '__defineGetter__', 'constructor', 'toString']) {
    assert.deepEqual(invalidFilters({ [name]: '1' }, MOVIE), [], name)
  }
})

test('a genre id must be plain digits, like the id route param', () => {
  // `+'0x1b'` is 27, which passes the lookup and then renders a genre TMDB was never sent
  assert.deepEqual(invalidFilters({ wg: '0x1b' }, MOVIE), ['wg'])
  assert.deepEqual(invalidFilters({ wg: '2.7e1' }, MOVIE), ['wg'])
  assert.deepEqual(invalidFilters({ wog: '+27' }, MOVIE), ['wog'])
})

test('an empty value counts as absent, matching what the services send', () => {
  assert.deepEqual(invalidFilters({ sort: '', wg: '', page: '', wr: '' }, MOVIE), [])
})

test('params we do not use are left alone', () => {
  const query = { rest_route: '/gravitysmtp/v1/tests/mock-data', utm_source: 'x', wog: '27' }

  assert.deepEqual(invalidFilters(query, MOVIE), [])
})

test('certifications are checked only where the route sends them', () => {
  assert.deepEqual(invalidFilters({ wr: 'BOGUS' }, MOVIE), ['wr'])
  // The TV route neither fetches nor sends TV certifications, so it cannot judge one
  assert.deepEqual(invalidFilters({ wr: 'TV-MA' }, SHOW), [])
})

test('every offending param is named, not just the first', () => {
  assert.deepEqual(invalidFilters({ page: '0', sort: 'nonsense', wg: '5' }, MOVIE), ['page', 'sort', 'wg'])
})

// The catalogue is defined by its vote floor, so a request below it asks for titles outside the
// catalogue — and the ranked path could not serve them, since the index is built at the floor
test('a vote override may narrow the catalogue but not widen it', () => {
  for (const minVotes of ['24', '0', '-1', 'abc', '1.5']) {
    assert.deepEqual(invalidFilters({ minVotes }, MOVIE), ['minVotes'], minVotes)
  }
  assert.deepEqual(invalidFilters({ minVotes: '25' }, MOVIE), [])
  assert.deepEqual(invalidFilters({ minVotes: '5000' }, MOVIE), [])
})
