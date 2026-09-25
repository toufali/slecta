import { test } from 'node:test'
import assert from 'node:assert/strict'
for (const key of ['TMDB_TOKEN', 'TMDB_API_URL', 'GCP_API_URL', 'GCP_API_KEY', 'GCP_SEARCH_ENGINE']) {
  process.env[key] ??= 'test'
}

const { titleDetail } = await import('./titleDetail.js')
import { scoreBadge } from '../../../client/src/scripts/components/scoreBadge.js'
import { titleCard } from '../../../client/src/scripts/components/titleCard.js'

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

  assert.match(tag(scoreBadge(83, true)), / low-confidence>$/)
  assert.doesNotMatch(tag(scoreBadge(83, false)), /low-confidence/)
  // A title scored by RT alone can aggregate to 0, which every falsy check here used to read as absent
  assert.equal(tag(scoreBadge(0, true)), '<score-badge score="0" style="--score: 0; --band: var(--red-70)" low-confidence>')
})

test('the server sets the band colour, so the badge is right before it upgrades', () => {
  const band = score => scoreBadge(score).match(/--band: var\(--(\w+)-70\)/)?.[1]

  assert.equal(band(80), 'green')
  assert.equal(band(79.6), 'yellow')
  assert.equal(band(65), 'yellow')
  assert.equal(band(64.9), 'red')
  assert.equal(band(undefined), undefined)
})

// Grey alone is not self-evident, so back it with something visible where there is room
test('a thin score is explained in words, and a settled one is not', () => {
  assert.match(titleDetail(data({ lowConfidence: true })), /<li class='low-confidence'>Score may be inaccurate/)
  assert.match(titleDetail(data({ lowConfidence: false })), /<li class='low-confidence' hidden>/)
})

// Ship the line either way, since a cache miss fills the badge in by script
test('the line ships hidden rather than absent', () => {
  assert.match(titleDetail(data({ lowConfidence: false })), /class='low-confidence' hidden/)
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
  const card = over => titleCard({ id: 1, title: 'A Film', genres: [], releaseDate: '2026-01-01', posterThumb: '', detailPath: '/movies/1', score: 83, ...over })
  const tag = rendered => rendered.match(/<score-badge[^>]*>/)[0]

  assert.match(tag(card({ lowConfidence: true })), /low-confidence/)
  assert.doesNotMatch(tag(card({ lowConfidence: false })), /low-confidence/)
})

// Colour is invisible to a screen reader and a card has no sentence, so say it in the badge itself
test('the badge qualifies a thin score in words a screen reader can reach', () => {
  const rendered = scoreBadge(83, true)

  assert.match(rendered, /aria-label="Score 83, few ratings so far"/)
  assert.match(scoreBadge(83, false), /aria-label="Score 83"/)
  assert.match(rendered, /:host\(\[low-confidence\]\)\{\s*--color: var\(--gray-30\)/,
    'the band colour is withheld, which has to hold before the element upgrades too')
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

test('providers group by cost, and rent-or-buy is curated to the top storefronts', () => {
  const rendered = titleDetail(data({
    included: [8],
    providers: [
      { provider_id: 8, provider_name: 'Netflix', logoUrl: '/n.png' },
      { provider_id: 10, provider_name: 'Amazon Video', logoUrl: '/a.png' },
      { provider_id: 68, provider_name: 'Microsoft Store', logoUrl: '/m.png' },
      { provider_id: 257, provider_name: 'fuboTV', logoUrl: '/f.png' }
    ]
  }))

  assert.match(rendered, /Included with:<\/label><\/p><ul><li><img src='\/n\.png'/)
  assert.match(rendered, /Rent or buy:<\/label><\/p><ul><li><img src='\/a\.png'/)
  assert.doesNotMatch(rendered, /Microsoft|fubo/)
})

test('a title with no provider in either group falls back, with no group headers', () => {
  // Available only on an uncurated service reads the same as unavailable, by decision
  const uncurated = titleDetail(data({ providers: [{ provider_id: 34, provider_name: 'MGM Plus', logoUrl: '/m.png' }], included: [34] }))

  assert.match(uncurated, /Not yet on major streaming services/)
  assert.doesNotMatch(uncurated, /MGM/)

  const rendered = titleDetail(data({ providers: [], included: [] }))

  assert.match(rendered, /Not yet on major streaming services/)
  assert.doesNotMatch(rendered, /Included with:|Rent or buy:/)
})

test('a completed no-score answer says the score is unavailable', () => {
  assert.match(titleDetail(data({ score: undefined, noScore: true })), /<li class='no-score'>Score unavailable\.<\/li>/)
  assert.match(titleDetail(data()), /<li class='no-score' hidden>/)
})

test('an unscored badge says it is loading until the sources have answered', () => {
  assert.match(scoreBadge(undefined, false, false), /aria-label="Loading score"/)
  assert.match(scoreBadge(undefined, false, true), /aria-label="Score unavailable"/)
})

test('a badge loads only a score that is neither cached nor answered as none', () => {
  const loads = rendered => / loading>/.test(rendered.match(/<score-badge[^>]*>/)[0])

  assert.equal(loads(scoreBadge(undefined, false, false)), true)
  assert.equal(loads(scoreBadge(undefined, false, true)), false)
  assert.equal(loads(scoreBadge(0, false, false)), false)
})

test('a detail badge grows in only a score it already has', () => {
  const grows = rendered => / arrived>/.test(rendered.match(/<score-badge[^>]*>/)[0])

  assert.equal(grows(titleDetail(data())), true)
  assert.equal(grows(titleDetail(data({ score: undefined }))), false)
  assert.equal(grows(titleCard({ id: 1, title: 'A Film', genres: [], releaseDate: '2026-01-01', posterThumb: '', detailPath: '/movies/1', score: 83 })), false)
})

test('a card passes a no-score answer to its badge', () => {
  const row = { id: 1, title: 'A Film', genres: [], releaseDate: '2026-01-01', posterThumb: '', detailPath: '/movies/1' }
  const loads = rendered => / loading>/.test(rendered.match(/<score-badge[^>]*>/)[0])

  assert.equal(loads(titleCard({ ...row, noScore: true })), false)
  assert.equal(loads(titleCard(row)), true)
})
