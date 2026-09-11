import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mainView } from './mainView.js'

// A named function, since the shell reads `partial.name` for the body attribute
function movieList() { return '' }

// A screen reader's landmark menu lists navs by name
test('the primary navigation is named', () => {
  assert.match(mainView({ partial: movieList, content: {} }), /<nav class='primary' aria-label='[^']+'>/)
})
