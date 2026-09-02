import { test } from 'node:test'
import assert from 'node:assert/strict'

// Same shape as the other service tests: env.js only needs the keys to exist.
for (const key of ['TMDB_TOKEN', 'TMDB_API_URL', 'GCP_API_URL', 'GCP_API_KEY', 'GCP_SEARCH_ENGINE']) {
  process.env[key] ??= 'test'
}

const { default: imdb } = await import('./imdbService.js')
const { default: redis } = await import('./redisService.js')

const realGetCache = redis.getCache
const stubBucket = value => { redis.getCache = async () => value }

// A caller that would discard a stored IMDb score on the strength of a missing rating has to know
// which of the two it got. `getCache` answers undefined for an unreadable Redis and null for a miss.
test('a rating the dataset holds comes back with its vote count', async () => {
  stubBucket('tt0000001\t6.5\t120\ntt1375666\t8.8\t2600000')

  try {
    assert.deepEqual(await imdb.getRating('tt1375666'), { rating: 8.8, votes: 2600000 })
  } finally {
    redis.getCache = realGetCache
  }
})

test('a dataset that could not be read is undefined, not a miss', async () => {
  stubBucket(undefined)

  try {
    assert.equal(await imdb.getRating('tt1375666'), undefined)
  } finally {
    redis.getCache = realGetCache
  }
})

// Every id maps to a bucket, so a missing one is a dataset that did not load
test('a bucket that is not there reads as unreadable, not as a title without a rating', async () => {
  stubBucket(null)

  try {
    assert.equal(await imdb.getRating('tt1375666'), undefined)
  } finally {
    redis.getCache = realGetCache
  }
})

test('a bucket without the title is an answer about the title', async () => {
  stubBucket('tt0000001\t6.5\t120')

  try {
    assert.equal(await imdb.getRating('tt1375666'), null)
  } finally {
    redis.getCache = realGetCache
  }
})

// Nothing to look up is an answer too, and it must not read as a dataset failure
test('an id we do not have is an answer, without touching the dataset', async () => {
  let asked = false
  redis.getCache = async () => { asked = true }

  try {
    assert.equal(await imdb.getRating(undefined), null)
    assert.equal(await imdb.getRating('not-an-id'), null)
    assert.equal(asked, false)
  } finally {
    redis.getCache = realGetCache
  }
})
