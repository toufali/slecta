import { test } from 'node:test'
import assert from 'node:assert/strict'

for (const key of ['TMDB_TOKEN', 'TMDB_API_URL', 'GCP_API_URL', 'GCP_API_KEY', 'GCP_SEARCH_ENGINE']) {
  process.env[key] ??= 'test'
}
process.env.REDIS_URL = ''

const { writeSnapshot, snapshotKey } = await import('./snapshots.js')
const { default: redis, WRITTEN, FAILED } = await import('../services/redisService.js')

const record = id => ({ id, scores: { imdb: 70 }, counts: { imdb: 900 }, fetchedAt: 1 })

function capture(result = WRITTEN) {
  const writes = []
  const real = redis.setCache

  redis.setCache = async (key, value, ttl) => { writes.push({ key, value, ttl }); return result }

  return { writes, restore: () => { redis.setCache = real } }
}

// A score cache version in the key would orphan every night the moment the record shape changed,
// and the history is the one thing a re-run cannot rebuild
test('a night is keyed by catalogue and date alone', () => {
  assert.equal(snapshotKey('movies', '2026-09-03'), 'snapshot/movies/2026-09-03')
  assert.equal(snapshotKey('shows', '2026-09-03'), 'snapshot/shows/2026-09-03')
})

test('the records are stored as given, under the night they were read', async () => {
  const { writes, restore } = capture()

  try {
    assert.equal(await writeSnapshot('movies', '2026-09-03', [record(1), record(2)]), true)

    assert.equal(writes.length, 1)
    assert.equal(writes[0].key, 'snapshot/movies/2026-09-03')
    assert.deepEqual(writes[0].value, [record(1), record(2)])
  } finally {
    restore()
  }
})

// Expiring rather than trimmed, since nothing reads these: a key that never went away would go
// unnoticed. Asserted as a band, because the constraint is the range and not the number.
test('a night outlives the weeks it takes to read a trajectory, and not much longer', async () => {
  const { writes, restore } = capture()
  const day = 60 * 60 * 24

  try {
    await writeSnapshot('movies', '2026-09-03', [record(1)])

    assert.ok(writes[0].ttl >= day * 28, `${writes[0].ttl}s is under four weeks`)
    assert.ok(writes[0].ttl <= day * 45, `${writes[0].ttl}s keeps nights no analysis asked for`)
  } finally {
    restore()
  }
})

// An empty night reads as "no title carried a score", which is a different fact from "no night"
test('an empty night is not stored', async () => {
  const { writes, restore } = capture()

  try {
    assert.equal(await writeSnapshot('movies', '2026-09-03', []), false)
    assert.deepEqual(writes, [])
  } finally {
    restore()
  }
})

test('a failed write is reported to the caller', async () => {
  const { restore } = capture(FAILED)

  try {
    assert.equal(await writeSnapshot('movies', '2026-09-03', [record(1)]), false)
  } finally {
    restore()
  }
})
