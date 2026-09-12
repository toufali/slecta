import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mainView } from './mainView.js'

// A named function, since the shell reads `partial.name` for the body attribute
function titleList() { return '' }
function searchList() { return '' }

test('the primary navigation is named', () => {
  assert.match(mainView({ partial: titleList, content: {} }), /<nav class='primary' aria-label='[^']+'>/)
})

test('the nav marks the section the handler names', () => {
  const current = rendered => [...rendered.matchAll(/<a href='([^']+)' class="current"/g)].map(m => m[1])

  assert.deepEqual(current(mainView({ partial: titleList, content: { movies: [] }, section: 'movies' })), ['/movies'])
  assert.deepEqual(current(mainView({ partial: titleList, content: { shows: [] }, section: 'shows' })), ['/shows'])
  assert.deepEqual(current(mainView({ partial: searchList, section: 'search' })), ['/search'])
  assert.deepEqual(current(mainView({ partial: titleList, content: {} })), [], 'a page naming no section marks nothing')
})

test('a partial declares its stylesheet into the head, or none when it has no styles', () => {
  const styled = () => ''
  styled.styles = '/styles/partials/titleList.css'

  const head = rendered => rendered.slice(0, rendered.indexOf('</head>'))

  assert.match(head(mainView({ partial: styled, content: {} })), /<link rel='stylesheet' href='\/styles\/partials\/titleList.css'/)
  assert.doesNotMatch(mainView({ partial: titleList, content: {} }), /styles\/partials\//)
})
