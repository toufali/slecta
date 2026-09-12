import { test } from 'node:test'
import assert from 'node:assert/strict'

for (const key of ['TMDB_TOKEN', 'TMDB_API_URL', 'GCP_API_URL', 'GCP_API_KEY', 'GCP_SEARCH_ENGINE']) {
  process.env[key] ??= 'test'
}

const { getTitles } = await import('./searchController.js')
const { default: tmdb } = await import('../services/tmdbService.js')

const context = query => ({
  query, headers: {},
  set() { },
  throw(status, message) { const e = new Error(message); e.status = status; throw e }
})

test('a search asks TMDB for the title it was given', async () => {
  tmdb.getTitlesByString = async str => [{ echoed: str }]

  const ctx = context({ title: 'dune' })
  await getTitles(ctx)

  assert.deepEqual(ctx.body, [{ echoed: 'dune' }])
})

test('a missing, blank or repeated title is a 400, not a search for "undefined"', async () => {
  tmdb.getTitlesByString = async () => { throw new Error('must not be asked') }

  for (const query of [{}, { titel: 'dune' }, { title: '  ' }, { title: ['a', 'b'] }]) {
    await assert.rejects(getTitles(context(query)), { status: 400 })
  }
})
