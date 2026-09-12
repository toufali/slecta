import { test } from 'node:test'
import assert from 'node:assert/strict'
import { titleDetail } from './titleDetail.js'
import { scoreBadge } from '../../../client/src/scripts/components/scoreBadge.js'
import { movieCard } from '../../../client/src/scripts/components/movieCard.js'

const data = over => ({
  tmdbId: 7, title: 'A Title', overview: 'Words', releaseDate: '2026-01-01', rating: 'PG-13',
  genres: 'Drama', cast: 'Someone', director: 'Someone', runtime: 100,
  // Not English, so the assertion cannot match the panel's own "English" label by accident
  seasons: 1, language: 'Japanese', providers: [], quotes: [], score: 83, ...over
})

// Carry the mark as an attribute, so Declarative Shadow DOM delivers it with nothing recomputed
test('the badge carries the mark only when the score is thin', () => {
  // The opening tag alone: the style block names the attribute in a selector either way
  const tag = rendered => rendered.match(/<score-badge[^>]*>/)[0]

  assert.equal(tag(scoreBadge(83, true)), '<score-badge score="83" low-confidence>')
  assert.equal(tag(scoreBadge(83, false)), '<score-badge score="83">')
  // A title scored by RT alone can aggregate to 0, which every falsy check here used to read as absent
  assert.equal(tag(scoreBadge(0, true)), '<score-badge score="0" low-confidence>')
})

// Grey alone is not self-evident, so back it with something visible where there is room
test('a thin score is explained in words, and a settled one is not', () => {
  assert.match(titleDetail(data({ lowConfidence: true })), /<p class='unsettled'>Score may be inaccurate/)
  assert.match(titleDetail(data({ lowConfidence: false })), /<p class='unsettled' hidden>/)
})

// Ship the line either way, since a cache miss fills the badge in by script
test('the line ships hidden rather than absent', () => {
  assert.match(titleDetail(data({ lowConfidence: false })), /class='unsettled' hidden/)
})

// Naming the source belongs in the component breakdown; the badge answers how much to trust it
test('no source is named beside the badge', () => {
  const rendered = titleDetail(data({ lowConfidence: true }))
  const header = rendered.match(/<header>[\s\S]*?<\/header>/)[0]

  for (const source of ['IMDb', 'imdb', 'Rotten', 'Metacritic', 'Tomatoes']) {
    assert.doesNotMatch(header, new RegExp(source), `${source} named in the header`)
  }
})

// Cover the card too: a list is where most readers meet a badge
test('a card passes the mark to its badge', () => {
  const card = over => movieCard({ id: 1, title: 'A Film', genres: [], releaseDate: '2026-01-01', posterThumb: '', detailPath: '/movies/1', score: 83, ...over })
  const tag = rendered => rendered.match(/<score-badge[^>]*>/)[0]

  assert.match(tag(card({ lowConfidence: true })), /low-confidence/)
  assert.doesNotMatch(tag(card({ lowConfidence: false })), /low-confidence/)
})

// Colour is invisible to a screen reader and a card has no sentence, so say it in the badge itself
test('the badge qualifies a thin score in words a screen reader can reach', () => {
  const rendered = scoreBadge(83, true)

  assert.match(rendered, /<figcaption>Few ratings so far<\/figcaption>/)
  assert.match(rendered, /:host\(\[low-confidence\]\) \.badge\{\s*background-color: var\(--gray-50\)/,
    'the band colour is withheld, which has to hold before the element upgrades too')
  assert.match(rendered, /:host\(:not\(\[low-confidence\]\)\) figcaption\{\s*display: none/,
    'a settled badge must drop the caption from the accessibility tree, not just hide it')
})

// The spoken list read as needing subtitles for a film that is substantially English
test('the detail page names the original language', () => {
  assert.match(titleDetail(data()), /<label>Language:<\/label><span>Japanese<\/span>/)
  assert.doesNotMatch(titleDetail(data()), /Spoken languages/)
})

test('the rows follow the record: a film gets a director, a show gets a creator and seasons', () => {
  const film = titleDetail(data())
  const show = titleDetail(data({ director: undefined, runtime: undefined, creator: 'Someone', seasons: 3 }))

  assert.match(film, /<label>Director:/)
  assert.match(film, /<label>Running time:<\/label><span>100 min/)
  assert.doesNotMatch(film, /<label>Creator:|title='Seasons'/)
  assert.match(show, /<label>Creator:/)
  assert.match(show, /<li title='Seasons'>3 seasons<\/li>/)
  assert.doesNotMatch(show, /<label>Director:|Running time/)
})

// A single season carries no information the page does not already show
test('one season is not worth a row', () => {
  assert.doesNotMatch(titleDetail(data({ seasons: 1 })), /Seasons/)
})
