import { test } from 'node:test'
import assert from 'node:assert/strict'
import { movieList } from './movieList.js'
import { tvShowList } from './tvShowList.js'

const data = over => ({
  movies: [], shows: [],
  allGenres: new Map([[28, 'Action']]),
  allRatings: [{ certification: 'R', meaning: 'restricted' }],
  allSorting: [{ name: 'Most Recent', value: 'primary_release_date.desc' }],
  sortBy: 'primary_release_date.desc',
  lookback: 12,
  lookbackMax: 12,
  allLangs: ['english', 'not-english'],
  ...over
})

// The slider's bounds and position are the service's, not the view's, so a change to the catalogue
// window reaches the panel without a second place to edit
test('the panel renders the lookback the request was answered with', () => {
  // Not the catalogue's own twelve, or a hardcoded bound reads as wired
  const rendered = movieList(data({ lookback: 3, lookbackMax: 6 }))

  assert.match(rendered, /type='range' name='months' min='1' max='6' value='3'/)
})

// "the last 1 months" is what a bare count reads as, and the readout is the whole point of the control
test('a one-month lookback reads as a month', () => {
  for (const view of [movieList, tvShowList]) {
    assert.match(view(data({ lookback: 1 })), /in the last <output>month<\/output>/)
    assert.match(view(data({ lookback: 2 })), /in the last <output>2 months<\/output>/)
  }
})

// The unit lived in the readout alone, so the handle announced a bare number
test('the handle carries the unit, not only the readout beside it', () => {
  for (const view of [movieList, tvShowList]) {
    assert.match(view(data({ lookback: 4 })), /aria-valuetext='4 months'/)
    assert.match(view(data({ lookback: 1 })), /aria-valuetext='month'/)
  }
})

// Each catalogue is bounded by its own date field, and a show is not "released"
test('each catalogue describes its own date field', () => {
  assert.match(movieList(data()), /released in the last/)
  assert.match(tvShowList(data()), /first aired in the last/)
})

// The route rejects a state the service cannot honour, so the panel must not offer it — a visible
// option that 400s on submit is worse than an absent one
test('the panel offers only the language states it was given', () => {
  for (const view of [movieList, tvShowList]) {
    const offered = view(data({ allLangs: ['english'] }))

    assert.match(offered, /name='lang' value='english'/)
    assert.doesNotMatch(offered, /value='not-english'/)
    assert.match(offered, /name='lang' value=''/, 'any is always offered')
    assert.match(view(data()), /value='not-english'/)
  }
})
