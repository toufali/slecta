import { test } from 'node:test'
import assert from 'node:assert/strict'
import { titleList } from './titleList.js'

const movie = over => ({
  movies: [],
  allGenres: new Map([[28, 'Action']]),
  allRatings: [{ certification: 'R', meaning: 'restricted' }],
  allSorting: [{ name: 'Most Recent', value: 'primary_release_date.desc' }],
  sortBy: 'primary_release_date.desc',
  lookback: 12,
  lookbackMax: 12,
  ...over
})
const tv = over => {
  const { movies, allRatings, ...rest } = movie()
  return { shows: [], ...rest, ...over }
}

// The slider's bounds and position are the service's, not the view's, so a change to the catalogue
// window reaches the panel without a second place to edit
test('the panel renders the lookback the request was answered with', () => {
  // Not the catalogue's own twelve, or a hardcoded bound reads as wired
  const rendered = titleList(movie({ lookback: 3, lookbackMax: 6 }))

  assert.match(rendered, /type='range' name='months' min='1' max='6' value='3'/)
})

// "the last 1 months" is what a bare count reads as, and the readout is the whole point of the control
test('a one-month lookback reads as a month', () => {
  for (const data of [movie, tv]) {
    assert.match(titleList(data({ lookback: 1 })), /in the last <output>month<\/output>/)
    assert.match(titleList(data({ lookback: 2 })), /in the last <output>2 months<\/output>/)
  }
})

// The unit lived in the readout alone, so the handle announced a bare number
test('the handle carries the unit, not only the readout beside it', () => {
  for (const data of [movie, tv]) {
    assert.match(titleList(data({ lookback: 4 })), /aria-valuetext='4 months'/)
    assert.match(titleList(data({ lookback: 1 })), /aria-valuetext='month'/)
  }
})

// The panel renders the request's own state back, or an applied filter shows as unticked
test('the language checkbox reflects the request', () => {
  for (const data of [movie, tv]) {
    assert.match(titleList(data({ inEnglish: 'on' })), /name='english' checked/)
    assert.doesNotMatch(titleList(data()), /name='english' checked/)
  }
})

// Each catalogue is bounded by its own date field, and a show is not "released"
test('each catalogue describes its own date field', () => {
  assert.match(titleList(movie()), /released in the last/)
  assert.match(titleList(movie()), /Released in the last:/)
  assert.match(titleList(tv()), /first aired in the last/)
  assert.match(titleList(tv()), /First aired in the last:/)
})

test('each catalogue gets its own name and form action', () => {
  assert.match(titleList(movie()), /<h1 class='list-description'>Movies /)
  assert.match(titleList(movie()), /action='\/api\/v1\/movies'/)
  assert.match(titleList(tv()), /<h1 class='list-description'>TV Shows /)
  assert.match(titleList(tv()), /action='\/api\/v1\/shows'/)
})

// Keyed off the data, so TV certifications light the fieldset up with no view change
test('the ratings fieldset renders only when the data carries ratings', () => {
  assert.match(titleList(movie()), /Include ratings:/)
  assert.doesNotMatch(titleList(tv()), /Include ratings:/)
  assert.match(titleList(tv({ allRatings: [{ certification: 'TV-MA', meaning: 'mature' }] })), /Include ratings:/)
})

// The render condition follows the href rather than re-deriving the boundary from a page count,
// which is what stranded a reader when the list metadata could not be read
test('the More control ships hidden without a next page, above the filter button', () => {
  for (const data of [movie, tv]) {
    const rendered = titleList(data({ nextPage: '/movies?page=2' }))
    const more = rendered.indexOf("<a class='button pill more' rel='next' href='/movies?page=2'>Show more</a>")

    assert.notEqual(more, -1)
    assert.ok(rendered.indexOf('</ul>') < more && more < rendered.indexOf('filter-toggle'))
    assert.match(titleList(data()), /<a class='button pill more' rel='next' hidden>Show more<\/a>/)
  }
})

test('a long genre list reads as two and etc, a short one in full', () => {
  const four = new Map([[1, 'A'], [2, 'B'], [3, 'C'], [4, 'D']])

  assert.match(titleList(movie({ allGenres: four, withGenres: ['1', '2', '3'] })), /<output>A, B, etc<\/output>/)
  assert.match(titleList(movie({ allGenres: four, withGenres: ['1', '2'] })), /<output>A or B<\/output>/)
})

// On mobile there is no escape key and no click-outside habit; the visible button is the dismissal
test('the panel carries its own close button, and ships inert', () => {
  assert.match(titleList(movie()), /<button class='close' type='button' aria-label='Close filters'>/)
  // Hidden by opacity alone, the closed panel kept every control in the tab order
  assert.match(titleList(movie()), /<div class='filter-panel hidden' inert>/)
})
