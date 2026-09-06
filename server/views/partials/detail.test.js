import { test } from 'node:test'
import assert from 'node:assert/strict'
import { movieDetail } from './movieDetail.js'
import { tvShowDetail } from './tvShowDetail.js'
import { scoreBadge } from '../../../client/src/scripts/components/scoreBadge.js'
import { movieCard } from '../../../client/src/scripts/components/movieCard.js'

const data = over => ({
  tmdbId: 7, title: 'A Title', overview: 'Words', releaseDate: '2026-01-01', rating: 'PG-13',
  genres: 'Drama', cast: 'Someone', director: 'Someone', creator: 'Someone', runtime: 100,
  seasons: 1, languages: 'English', providers: [], quotes: [], score: 83, ...over
})

// The mark is an attribute on the badge, so it reaches the browser through Declarative Shadow DOM
// without the client recomputing anything
test('the badge carries the mark only when the score is thin', () => {
  // The opening tag alone: the style block names the attribute in a selector either way
  const tag = rendered => rendered.match(/<score-badge[^>]*>/)[0]

  assert.equal(tag(scoreBadge(83, true)), '<score-badge score="83" low-confidence>')
  assert.equal(tag(scoreBadge(83, false)), '<score-badge score="83">')
})

// A dashed ring is not self-evident, so on the detail page it is accompanied by something visible
test('a thin score is explained in words, and a settled one is not', () => {
  for (const view of [movieDetail, tvShowDetail]) {
    assert.match(view(data({ lowConfidence: true })), /<p class='unsettled'>Few ratings so far/)
    assert.match(view(data({ lowConfidence: false })), /<p class='unsettled' hidden>/)
  }
})

// The badge is filled in by script on a cache miss, so the line has to be in the markup either way
test('the line ships hidden rather than absent', () => {
  assert.match(movieDetail(data({ lowConfidence: false })), /class='unsettled' hidden/)
})

// Naming the source belongs in the component breakdown; the badge answers how much to trust it
test('no source is named beside the badge', () => {
  const rendered = movieDetail(data({ lowConfidence: true }))
  const header = rendered.match(/<header>[\s\S]*?<\/header>/)[0]

  for (const source of ['IMDb', 'imdb', 'Rotten', 'Metacritic', 'Tomatoes']) {
    assert.doesNotMatch(header, new RegExp(source), `${source} named in the header`)
  }
})

// A card is the other place a badge is rendered, and a list is where most readers meet one
test('a card passes the mark to its badge', () => {
  const card = over => movieCard({ id: 1, title: 'A Film', genres: [], releaseDate: '2026-01-01', posterThumb: '', detailPath: '/movies/1', score: 83, ...over })
  const tag = rendered => rendered.match(/<score-badge[^>]*>/)[0]

  assert.match(tag(card({ lowConfidence: true })), /low-confidence/)
  assert.doesNotMatch(tag(card({ lowConfidence: false })), /low-confidence/)
})
