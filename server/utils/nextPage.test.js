import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextPageHref } from './nextPage.js'

test('the link targets the page after the one requested', () => {
  assert.equal(nextPageHref('/movies', {}, 41), '/movies?page=2')
  assert.equal(nextPageHref('/movies', { page: '2' }, 41), '/movies?page=3')
})

test('the end of the list offers nothing further', () => {
  assert.equal(nextPageHref('/movies', { page: '41' }, 41), undefined)
  assert.equal(nextPageHref('/movies', {}, 1), undefined)
  assert.equal(nextPageHref('/movies', { page: '99' }, 41), undefined)
})

test('every filter survives into the link', () => {
  assert.equal(
    nextPageHref('/movies', { page: '3', sort: 'popularity.desc', streaming: 'true' }, 9),
    '/movies?sort=popularity.desc&streaming=true&page=4'
  )
})

// A repeated filter arrives as an array, and flattening it would send TMDB one comma-joined genre
test('a filter given more than once stays repeated', () => {
  assert.equal(nextPageHref('/movies', { wg: ['28', '12'] }, 4), '/movies?wg=28&wg=12&page=2')
})

test('an unknown page count withholds the link rather than guessing', () => {
  assert.equal(nextPageHref('/movies', { page: '2' }, undefined), undefined)
})
