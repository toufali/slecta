import { test } from 'node:test'
import assert from 'node:assert/strict'
import { average, toCount, toFloor, toScore } from './math.js'

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

test('toCount keeps a real sample size', () => {
  assert.equal(toCount('526'), 526)
  assert.equal(toCount(37), 37)
})

test('toCount rejects a zero, which is a source with nothing to count', () => {
  assert.equal(toCount(0), undefined)
  assert.equal(toCount(undefined), undefined)
  assert.equal(toCount('n/a'), undefined)
})

// Absent beats wrong: a truncated count is a thick component that reads as thin
test('toCount rejects a thousands-separated string rather than truncating it', () => {
  assert.equal(toCount('1,234'), undefined)
  assert.equal(toCount('526 reviews'), undefined)
  assert.equal(toCount(9.5), undefined)
})

// RT bands a cross-season audience count rather than publishing one, in these exact shapes
test('toFloor reads the lower bound out of a band', () => {
  assert.equal(toFloor('50+ Ratings'), 50)
  assert.equal(toFloor('250+ Ratings'), 250)
  assert.equal(toFloor('10,000+ Verified Ratings'), 10000)
})

// A floor of nothing is no floor: at this band the true count could be 5 or 49
test('toFloor rejects a band with no lower bound', () => {
  assert.equal(toFloor('Fewer than 50 Ratings'), undefined)
  assert.equal(toFloor(undefined), undefined)
  assert.equal(toFloor('Ratings'), undefined)
})
