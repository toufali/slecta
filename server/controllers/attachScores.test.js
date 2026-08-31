import { test } from 'node:test'
import assert from 'node:assert/strict'

// Same shape as the service tests: env.js only needs the keys to exist.
for (const key of ['TMDB_TOKEN', 'TMDB_API_URL', 'GCP_API_URL', 'GCP_API_KEY', 'GCP_SEARCH_ENGINE']) {
  process.env[key] ??= 'test'
}

const { attachScores } = await import('./attachScores.js')
const { default: scoreService } = await import('../services/scoreService.js')

// Records the keys asked for, since the segment is the only thing separating the two media types.
// Not restored afterwards: every test here stubs before it reads, and none wants the real one.
function stubCache(records) {
  const asked = []

  scoreService.getScoreFromCache = async key => {
    asked.push(key)

    const record = records[key]
    if (record instanceof Error) throw record
    return record
  }

  return asked
}

test('each row gets its own cached badge, keyed by media segment', async () => {
  const asked = stubCache({ 'movies/1/score': { avgScore: 81 }, 'movies/2/score': { avgScore: 64 } })
  const items = [{ id: 1 }, { id: 2 }]

  await attachScores(items, 'movies')

  assert.deepEqual(items, [{ id: 1, score: 81 }, { id: 2, score: 64 }])
  assert.deepEqual(asked, ['movies/1/score', 'movies/2/score'])
})

// A movie and a show can share a TMDB id, so the segment is load-bearing rather than cosmetic
test('the segment reaches the key', async () => {
  const asked = stubCache({ 'shows/1/score': { avgScore: 55 } })
  const items = [{ id: 1 }]

  await attachScores(items, 'shows')

  assert.equal(items[0].score, 55)
  assert.deepEqual(asked, ['shows/1/score'])
})

// A miss reads as null and a Redis outage as undefined. Neither may leave a `score` key behind:
// the badge renders a placeholder for an absent score and the string "undefined" for a present one.
test('a title with no cached score keeps no score key at all', async () => {
  stubCache({ 'movies/1/score': null, 'movies/2/score': undefined })
  const items = [{ id: 1 }, { id: 2 }]

  await attachScores(items, 'movies')

  assert.deepEqual(items, [{ id: 1 }, { id: 2 }])
})

// Settled rather than all: one unreadable record must not reject the whole list
test('one failed read costs its own badge, not the list', async () => {
  stubCache({ 'movies/1/score': new Error('redis unavailable'), 'movies/2/score': { avgScore: 64 } })
  const items = [{ id: 1 }, { id: 2 }]

  await attachScores(items, 'movies')

  assert.deepEqual(items, [{ id: 1 }, { id: 2, score: 64 }])
})

test('an empty list asks nothing', async () => {
  const asked = stubCache({ 'movies/1/score': { avgScore: 81 } })

  await attachScores([], 'movies')

  assert.deepEqual(asked, [])
})
