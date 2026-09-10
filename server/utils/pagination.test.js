import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextPageHref } from './pagination.js'

test('the next page carries the page number', () => {
  assert.equal(nextPageHref('/movies', {}, 41), '/movies?page=2')
  assert.equal(nextPageHref('/movies', { page: '2' }, 41), '/movies?page=3')
})

test('the last page has no next', () => {
  assert.equal(nextPageHref('/movies', { page: '41' }, 41), undefined)
})

test('a single-page list has no next', () => {
  assert.equal(nextPageHref('/movies', {}, 1), undefined)
})

// The filters are what make the link worth building: a page of the unfiltered list is a different list
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

// `totalPages` is undefined when the list metadata could not be read. Offering a next page then
// would hand the reader a link that 400s against pageMax.
test('an unknown page count withholds the link rather than guessing', () => {
  assert.equal(nextPageHref('/movies', { page: '2' }, undefined), undefined)
})

test('a hand-typed page past the end offers nothing further', () => {
  assert.equal(nextPageHref('/movies', { page: '99' }, 41), undefined)
})
