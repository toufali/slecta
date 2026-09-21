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
  const asked = stubCache({ [scoreKey('movies', 1)]: { scores: { imdb: 81 }, counts: { imdb: 500_000 } }, [scoreKey('movies', 2)]: { scores: { imdb: 64 }, counts: { imdb: 500_000 } } })
  const items = [{ id: 1 }, { id: 2 }]

  await attachScores(items, 'movies')

  assert.deepEqual(items, [{ id: 1, score: 90, lowConfidence: false }, { id: 2, score: 65, lowConfidence: false }])
  assert.deepEqual(asked, [scoreKey('movies', 1), scoreKey('movies', 2)])
})

// A movie and a show can share a TMDB id, so the segment is load-bearing rather than cosmetic
test('the segment reaches the key', async () => {
  const asked = stubCache({ [scoreKey('shows', 1)]: { scores: { imdb: 55 }, counts: { imdb: 500_000 } } })
  const items = [{ id: 1 }]

  await attachScores(items, 'shows')

  assert.equal(items[0].score, 53)
  assert.deepEqual(asked, [scoreKey('shows', 1)])
})

// A miss reads as null and a Redis outage as undefined. Neither may leave a `score` key behind:
// only a present record with no aggregate is a completed answer, and it says so without a score.
// the badge renders a placeholder for an absent score and the string "undefined" for a present one.
test('a title with no cached score keeps no score key at all', async () => {
  // A record no source could score is present and truthy, and still has no aggregate
  stubCache({ [scoreKey('movies', 1)]: null, [scoreKey('movies', 2)]: undefined, [scoreKey('movies', 3)]: { scores: {}, answered: true }, [scoreKey('movies', 4)]: { scores: {} } })
  const items = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]

  await attachScores(items, 'movies')

  assert.deepEqual(items, [{ id: 1 }, { id: 2 }, { id: 3, noScore: true }, { id: 4 }], 'an unanswered retry record keeps its badge')
})

// Settled rather than all: one unreadable record must not reject the whole list
test('one failed read costs its own badge, not the list', async () => {
  stubCache({ [scoreKey('movies', 1)]: new Error('redis unavailable'), [scoreKey('movies', 2)]: { scores: { imdb: 64 } } })
  const items = [{ id: 1 }, { id: 2 }]

  await attachScores(items, 'movies')

  assert.deepEqual(items, [{ id: 1 }, { id: 2, score: 65, lowConfidence: true }])
})

// Prove it on the well-sampled case: a mark on every badge would read as decoration
test('a well-sampled row is not marked', async () => {
  stubCache({ [scoreKey('movies', 1)]: { scores: { imdb: 81, metacritic: 90 }, counts: { imdb: 900_000, metacritic: 300 } } })
  const items = [{ id: 1 }]

  await attachScores(items, 'movies')

  assert.deepEqual(items, [{ id: 1, score: 96, lowConfidence: false }])
})

test('an empty list asks nothing', async () => {
  const asked = stubCache({ [scoreKey('movies', 1)]: { scores: { imdb: 81 } } })

  await attachScores([], 'movies')

  assert.deepEqual(asked, [])
})
