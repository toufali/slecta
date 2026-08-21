import { test } from 'node:test'
import assert from 'node:assert/strict'
import { average, toScore } from './math.js'

test('average ignores non-finite values', () => {
  assert.equal(average([80, 90]), 85)
  assert.equal(average([80, NaN, 90]), 85)
  assert.equal(average([80, Infinity, 90]), 85)
})

test('average of nothing usable is NaN, not 0', () => {
  assert.ok(Number.isNaN(average([])))
  assert.ok(Number.isNaN(average([NaN])))
})

test('a single source averages to itself', () => {
  assert.equal(average([81]), 81)
})

test('toScore keeps real scores, including a genuine zero', () => {
  assert.equal(toScore('92'), 92)
  assert.equal(toScore(79), 79)
  assert.equal(toScore(0), 0) // Rotten Tomatoes can legitimately report 0%
})

test('toScore rejects anything that is not a number', () => {
  assert.equal(toScore(undefined), undefined)
  assert.equal(toScore(null), undefined)
  assert.equal(toScore('n/a'), undefined)
})
