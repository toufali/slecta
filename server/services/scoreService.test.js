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

// Routes by host, since the RT and Metacritic reads run concurrently and their order is not fixed
function stubHosts(routes) {
  globalThis.fetch = async url => {
    const host = Object.keys(routes).find(name => String(url).includes(name))
    return routes[host] ?? new Response('', { status: 404 })
  }
}

const wikidata = (rt, mc) => ok(JSON.stringify({ P1258: [{ value: { content: rt } }], P1712: [{ value: { content: mc } }] }))
const rtScorecard = (critic, audience) => ok(`<script id="media-scorecard-json">${JSON.stringify({
  criticsScore: { score: critic }, audienceScore: { score: audience }
})}</script>`)

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


// The badge renders this number and lists order by it, so it has to be an integer or absent.
// Redis is never connected here, so reads miss and the write is a no-op.
test('the aggregate is a rounded integer, not the raw mean', async () => {
  stubHosts({
    'wikidata.org': wikidata('m/inception', 'movie/inception'),
    'rottentomatoes.com': rtScorecard(50, 85),
    'metacritic.com': ok(LD(52))
  })

  const score = await scoreService.getScore('test/movie/27205', {
    tmdbScore: 67, wikiId: 'Q25188', title: 'Inception', releaseDate: '2010-07-16', mediaType: 'movie'
  }, false)

  // (52 + 50 + 85 + 67) / 4 is 63.5
  assert.deepEqual(score.scores, { metacritic: 52, rtCritic: 50, rtAudience: 85, tmdb: 67 })
  assert.equal(score.avgScore, 64)
})

// NaN serialises to null, which would order ahead of real scores and lose the badge placeholder
test('a title with no resolvable source has no aggregate at all', async () => {
  stubHosts({})

  const score = await scoreService.getScore('test/movie/999', {
    title: 'Nothing Resolves', releaseDate: '2026-01-01', mediaType: 'movie'
  }, false)

  assert.deepEqual(score.scores, {})
  assert.equal('avgScore' in JSON.parse(JSON.stringify(score)), false)
})
