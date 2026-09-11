import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mainView } from './mainView.js'

// A named function, since the shell reads `partial.name` for the body attribute
function titleList() { return '' }
function searchList() { return '' }

// A screen reader's landmark menu lists navs by name
test('the primary navigation is named', () => {
  assert.match(mainView({ partial: titleList, content: {} }), /<nav class='primary' aria-label='[^']+'>/)
})

// Keyed off the catalogue the page carries, since one shared view name can no longer tell the two
// list pages apart — and the old name check left the Show tab permanently unhighlighted
test('the nav marks the section whose catalogue the page carries', () => {
  const current = rendered => [...rendered.matchAll(/<a href='([^']+)' class="current"/g)].map(m => m[1])

  assert.deepEqual(current(mainView({ partial: titleList, content: { movies: [] } })), ['/movies'])
  assert.deepEqual(current(mainView({ partial: titleList, content: { shows: [] } })), ['/shows'])
  assert.deepEqual(current(mainView({ partial: searchList, content: undefined })), ['/search'])
  assert.deepEqual(current(mainView({ partial: titleList, content: {} })), [], 'a detail page marks nothing')
})
