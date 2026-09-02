import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mainView } from './mainView.js'
import { pageLinks } from '../utils/pagination.js'

// A named function, since the shell reads `partial.name` for the body attribute
function movieList() { return '' }

const footer = content => mainView({ partial: movieList, content })
  .match(/<footer>[\s\S]*?<\/footer>/)[0]

// The render condition has to follow `pageLinks` rather than re-derive the boundaries from the page
// count, which is what stranded a reader on page two when the list metadata could not be read.
test('a page with no known total still offers the way back', () => {
  const rendered = footer({ pagination: pageLinks('/movies', { page: '2' }, undefined) })

  assert.match(rendered, /rel='prev' href='\/movies'/)
  assert.doesNotMatch(rendered, /rel='next'/)
})

test('a list of one page renders no control', () => {
  assert.doesNotMatch(footer({ pagination: pageLinks('/movies', {}, 1) }), /pagination/)
})

test('the first page of many offers only the way on', () => {
  const rendered = footer({ pagination: pageLinks('/movies', {}, 41) })

  assert.match(rendered, /rel='next' href='\/movies\?page=2'/)
  assert.doesNotMatch(rendered, /rel='prev'/)
})

// The shell is shared with the detail pages, which carry no pagination at all
test('content with no pagination renders the footer unchanged', () => {
  assert.doesNotMatch(footer({}), /pagination/)
})

// Two navigation landmarks now, and a screen reader's landmark menu cannot tell apart two unnamed ones
test('both navigation landmarks are named', () => {
  const rendered = mainView({ partial: movieList, content: { pagination: pageLinks('/movies', {}, 41) } })

  assert.match(rendered, /<nav class='primary' aria-label='[^']+'>/)
  assert.match(rendered, /<nav class='pagination' aria-label='[^']+'>/)
})

test('the page number is shown without a total', () => {
  assert.match(footer({ pagination: pageLinks('/movies', { page: '7' }, 41) }), /Page 7<\/span>/)
})
