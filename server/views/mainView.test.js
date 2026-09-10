import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mainView } from './mainView.js'

// A named function, since the shell reads `partial.name` for the body attribute
function movieList() { return '' }

const footer = content => mainView({ partial: movieList, content })
  .match(/<footer>[\s\S]*?<\/footer>/)[0]

// The render condition follows the href rather than re-deriving the boundary from a page count,
// which is what stranded a reader when the list metadata could not be read
test('the control appears only when there is a next page', () => {
  assert.match(footer({ nextPage: '/movies?page=2' }), /<a class='button secondary more' rel='next' href='\/movies\?page=2'>More<\/a>/)
  assert.doesNotMatch(footer({ nextPage: undefined }), /secondary more/)
})

// The shell is shared with the detail pages and About, which carry no list to page through
test('content without a next page renders the footer unchanged', () => {
  assert.doesNotMatch(footer({}), /secondary more/)
  assert.doesNotMatch(footer(undefined), /secondary more/)
})

test('the primary navigation is named', () => {
  assert.match(mainView({ partial: movieList, content: {} }), /<nav class='primary' aria-label='[^']+'>/)
})
