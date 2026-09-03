import { test } from 'node:test'
import assert from 'node:assert/strict'

for (const key of ['TMDB_TOKEN', 'TMDB_API_URL', 'GCP_API_URL', 'GCP_API_KEY', 'GCP_SEARCH_ENGINE']) {
  process.env[key] ??= 'test'
}

const { default: reviewService } = await import('./reviewService.js')
const { default: redis } = await import('./redisService.js')

const realGetCache = redis.getCache
// Nothing cached, so every call reaches the search-window logic under test
redis.getCache = async () => null

// The search is never expected to run in these cases; a call would be the failure
const noSearch = () => {
  const asked = []

  globalThis.fetch = async url => {
    asked.push(String(url))
    return new Response(JSON.stringify({ items: [] }), { status: 200 })
  }

  return asked
}

const day = offsetDays => {
  const date = new Date()

  date.setUTCDate(date.getUTCDate() + offsetDays)

  return date.toISOString().substring(0, 10)
}

// The guard read `new Date() < dateMinusOneWeek` against a formatted string, which coerces to NaN,
// so it was always false and every unreleased title was searched for anyway.
test('a title more than a week from release is not searched for', async () => {
  const asked = noSearch()

  assert.deepEqual(await reviewService.getQuotes(1, 'Far Off', day(30)), [])
  assert.deepEqual(asked, [], 'no search should have been made')
})

test('a title inside the week before release is searched for', async () => {
  const asked = noSearch()

  await reviewService.getQuotes(2, 'Almost Out', day(3))
  assert.equal(asked.length, 1)
})

test('a released title is searched for', async () => {
  const asked = noSearch()

  await reviewService.getQuotes(3, 'Out Now', day(-30))
  assert.equal(asked.length, 1)
})

// The window is formatted as UTC, so the arithmetic has to be UTC: read through the local calendar a
// seven-day span crossing a DST transition landed a day out
test('the search window does not depend on the host timezone', async () => {
  const real = process.env.TZ
  const windows = []

  // Two dates, because the bounds fail separately: a seven-day span crossing a DST transition moves
  // the start, and a first-of-month release moves the end, since local time is still the month before
  try {
    for (const released of ['2025-11-04', '2025-12-01']) {
      const perZone = []

      for (const tz of ['UTC', 'America/New_York', 'Australia/Lord_Howe']) {
        process.env.TZ = tz

        const asked = noSearch()

        await reviewService.getQuotes(4, 'Shifted', released)
        perZone.push(decodeURIComponent(asked[0]).match(/date:r:\d+:\d+/)[0])
      }

      windows.push(perZone)
      assert.equal(new Set(perZone).size, 1, `${released}: ${perZone.join(' vs ')}`)
    }
  } finally {
    process.env.TZ = real
  }
})

// An unvalidated date stringifies to 'undefined' and the arithmetic below it throws a RangeError
test('an unusable release date is answered with nothing, not a throw', async () => {
  const asked = noSearch()

  for (const date of [undefined, '', 'undefined', 'not-a-date']) {
    assert.deepEqual(await reviewService.getQuotes(5, 'Bad Date', date), [], String(date))
  }

  assert.deepEqual(asked, [])
})

test.after(() => { redis.getCache = realGetCache })
