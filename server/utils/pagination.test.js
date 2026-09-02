import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pageLinks } from './pagination.js'

test('the first page has no previous, and its next carries the page number', () => {
  const links = pageLinks('/movies', {}, 41)

  assert.equal(links.prev, undefined)
  assert.equal(links.next, '/movies?page=2')
  assert.equal(links.page, 1)
})

// One address for the first page, so a reader paging back does not land on a second URL for it
test('paging back to the first page drops the parameter rather than setting page=1', () => {
  assert.equal(pageLinks('/movies', { page: '2' }, 41).prev, '/movies')
})

test('the last page has no next', () => {
  const links = pageLinks('/movies', { page: '41' }, 41)

  assert.equal(links.next, undefined)
  assert.equal(links.prev, '/movies?page=40')
})

// The filters are what make the link worth building: a page of the unfiltered list is a different list
test('every filter survives into both links', () => {
  const links = pageLinks('/movies', { page: '3', sort: 'popularity.desc', streaming: 'true' }, 9)

  assert.equal(links.prev, '/movies?sort=popularity.desc&streaming=true&page=2')
  assert.equal(links.next, '/movies?sort=popularity.desc&streaming=true&page=4')
})

// A repeated filter arrives as an array, and flattening it would send TMDB one comma-joined genre
test('a filter given more than once stays repeated', () => {
  assert.equal(pageLinks('/movies', { wg: ['28', '12'] }, 4).next, '/movies?wg=28&wg=12&page=2')
})

// `totalPages` is undefined when the list metadata could not be read. Offering a next page then
// would hand the reader a link that 400s against pageMax.
test('an unknown page count withholds the next link rather than guessing', () => {
  const links = pageLinks('/movies', { page: '2' }, undefined)

  assert.equal(links.next, undefined)
  assert.equal(links.prev, '/movies')
})

test('a single-page list offers neither direction', () => {
  const links = pageLinks('/movies', {}, 1)

  assert.equal(links.prev, undefined)
  assert.equal(links.next, undefined)
})

// A hand-typed page beyond the end still has to lead back rather than nowhere
test('a page past the end keeps its previous link', () => {
  assert.equal(pageLinks('/movies', { page: '99' }, 41).prev, '/movies?page=98')
})
