import { test } from 'node:test'
import assert from 'node:assert/strict'

// Same shape as verify.test.js: env.js only needs the keys to exist.
for (const key of ['TMDB_TOKEN', 'TMDB_API_URL', 'GCP_API_URL', 'GCP_API_KEY', 'GCP_SEARCH_ENGINE']) {
  process.env[key] ??= 'test'
}

const { default: scoreService } = await import('./scoreService.js')

const LD = value => `<script type="application/ld+json">${JSON.stringify({
  '@type': 'Movie', aggregateRating: { ratingValue: value }
})}</script>`

const ok = body => new Response(body, { status: 200 })

// Replaces global fetch with a queue of canned outcomes, and records the call count.
function stubFetch(...outcomes) {
  const calls = { count: 0 }
  globalThis.fetch = async () => {
    const outcome = outcomes[calls.count++] ?? outcomes.at(-1)
    if (outcome instanceof Error) throw outcome
    return outcome
  }
  return calls
}

const timeout = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })

test('a timeout is retried and the score survives', async () => {
  const calls = stubFetch(timeout(), ok(LD(74)))
  assert.equal(await scoreService.getMetacriticScore('movie/inception'), 74)
  assert.equal(calls.count, 2)
})

test('a 5xx is retried', async () => {
  const calls = stubFetch(new Response('', { status: 503 }), ok(LD(74)))
  assert.equal(await scoreService.getMetacriticScore('movie/inception'), 74)
  assert.equal(calls.count, 2)
})

// The slug probes 404 by design, so retrying a 4xx would double every miss for nothing.
test('a 404 is not retried', async () => {
  const calls = stubFetch(new Response('', { status: 404 }), ok(LD(74)))
  assert.equal(await scoreService.getMetacriticScore('movie/nope'), undefined)
  assert.equal(calls.count, 1)
})

test('two timeouts in a row give up rather than looping', async () => {
  const calls = stubFetch(timeout(), timeout())
  assert.equal(await scoreService.getMetacriticScore('movie/inception'), undefined)
  assert.equal(calls.count, 2)
})

// Undici holds the connection for a response whose body is never read.
test('the discarded 5xx body is released, not left holding a connection', async () => {
  const discarded = new Response('boom', { status: 503 })
  stubFetch(discarded, ok(LD(74)))

  assert.equal(await scoreService.getMetacriticScore('movie/inception'), 74)
  assert.equal(discarded.bodyUsed, true, 'body of the abandoned 5xx was never released')
})

// A retry that also fails still hands the response back to the caller, which only
// reads its status — so the final body needs releasing too, not just the first.
test('a 5xx surviving the retry releases both bodies', async () => {
  const first = new Response('boom', { status: 503 })
  const final = new Response('boom', { status: 503 })
  stubFetch(first, final)

  assert.equal(await scoreService.getMetacriticScore('movie/inception'), undefined)
  assert.equal(first.bodyUsed, true, 'first 5xx body was never released')
  assert.equal(final.bodyUsed, true, 'final 5xx body was never released')
})

test('a 4xx body is released even though it is never retried', async () => {
  const missing = new Response('not found', { status: 404 })
  stubFetch(missing)

  assert.equal(await scoreService.getMetacriticScore('movie/nope'), undefined)
  assert.equal(missing.bodyUsed, true, '404 body was never released')
})

test('a healthy response is not retried', async () => {
  const calls = stubFetch(ok(LD(74)))
  assert.equal(await scoreService.getMetacriticScore('movie/inception'), 74)
  assert.equal(calls.count, 1)
})
