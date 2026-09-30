import test from 'node:test'
import assert from 'node:assert/strict'
import { about } from './about.js'

test('the About page carries TMDB’s and IMDb’s required credits word for word, and credits JustWatch', () => {
  const page = about()

  assert.match(page, /<img src='\/images\/tmdb\.svg' alt='TMDB'>/)
  assert.ok(page.includes('This website uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.'))
  assert.ok(page.includes('Information courtesy of IMDb (https://www.imdb.com). Used with permission.'))
  assert.match(page, /Streaming data from JustWatch/)
})
