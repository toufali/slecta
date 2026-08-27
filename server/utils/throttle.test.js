import { test } from 'node:test'
import assert from 'node:assert/strict'
import { space } from './throttle.js'

// The web service leaves the interval at 0, so this is the path every visitor request takes
test('no interval means no wait, even on a host holding a claimed slot', async () => {
  await space('unspaced.test', 400) // claims a slot 400ms out

  const started = Date.now()

  await Promise.all(Array.from({ length: 20 }, () => space('unspaced.test', 0)))

  assert.ok(Date.now() - started < 20, 'an unset interval should not wait on an existing claim')
})

// The rate has to hold however many callers arrive at once, since the job runs titles in parallel
test('callers arriving together are spaced, not released together', async () => {
  const at = []

  await Promise.all(Array.from({ length: 4 }, async () => {
    await space('burst.test', 30)
    at.push(Date.now())
  }))

  at.sort((a, b) => a - b)

  assert.equal(at.length, 4)
  assert.ok(at[3] - at[0] >= 85, `four calls at 30ms apart should span ~90ms, spanned ${at[3] - at[0]}`)
})

test('one host waiting does not hold up another', async () => {
  await space('slow.test', 200) // claims the slot; the next caller on this host waits

  const started = Date.now()

  await space('fast.test', 200)

  assert.ok(Date.now() - started < 50, 'a first request to a host should not wait')
})
