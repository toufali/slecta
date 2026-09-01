import { test } from 'node:test'
import assert from 'node:assert/strict'

// Same shape as the service tests: env.js only needs the keys to exist.
for (const key of ['TMDB_TOKEN', 'TMDB_API_URL', 'GCP_API_URL', 'GCP_API_KEY', 'GCP_SEARCH_ENGINE']) {
  process.env[key] ??= 'test'
}

const { attachScores } = await import('./attachScores.js')
const { scoreKey } = await import('../services/scoreService.js')
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
  const asked = stubCache({ [scoreKey('movies', 1)]: { scores: { imdb: 81 } }, [scoreKey('movies', 2)]: { scores: { imdb: 64 } } })
  const items = [{ id: 1 }, { id: 2 }]

  await attachScores(items, 'movies')

  assert.deepEqual(items, [{ id: 1, score: 81 }, { id: 2, score: 64 }])
  assert.deepEqual(asked, [scoreKey('movies', 1), scoreKey('movies', 2)])
})

// A movie and a show can share a TMDB id, so the segment is load-bearing rather than cosmetic
test('the segment reaches the key', async () => {
  const asked = stubCache({ [scoreKey('shows', 1)]: { scores: { imdb: 55 } } })
  const items = [{ id: 1 }]

  await attachScores(items, 'shows')

  assert.equal(items[0].score, 55)
  assert.deepEqual(asked, [scoreKey('shows', 1)])
})

// A miss reads as null and a Redis outage as undefined. Neither may leave a `score` key behind:
// the badge renders a placeholder for an absent score and the string "undefined" for a present one.
test('a title with no cached score keeps no score key at all', async () => {
  // A record no source could score is present and truthy, and still has no aggregate
  stubCache({ [scoreKey('movies', 1)]: null, [scoreKey('movies', 2)]: undefined, [scoreKey('movies', 3)]: { scores: {} } })
  const items = [{ id: 1 }, { id: 2 }, { id: 3 }]

  await attachScores(items, 'movies')

  assert.deepEqual(items, [{ id: 1 }, { id: 2 }, { id: 3 }])
})

// Settled rather than all: one unreadable record must not reject the whole list
test('one failed read costs its own badge, not the list', async () => {
  stubCache({ [scoreKey('movies', 1)]: new Error('redis unavailable'), [scoreKey('movies', 2)]: { scores: { imdb: 64 } } })
  const items = [{ id: 1 }, { id: 2 }]

  await attachScores(items, 'movies')

  assert.deepEqual(items, [{ id: 1 }, { id: 2, score: 64 }])
})

test('an empty list asks nothing', async () => {
  const asked = stubCache({ [scoreKey('movies', 1)]: { scores: { imdb: 81 } } })

  await attachScores([], 'movies')

  assert.deepEqual(asked, [])
})
