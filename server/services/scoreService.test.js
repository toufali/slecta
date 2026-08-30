import { test } from 'node:test'
import assert from 'node:assert/strict'

// Same shape as checks.test.js: env.js only needs the keys to exist.
for (const key of ['TMDB_TOKEN', 'TMDB_API_URL', 'GCP_API_URL', 'GCP_API_KEY', 'GCP_SEARCH_ENGINE']) {
  process.env[key] ??= 'test'
}

const { default: scoreService } = await import('./scoreService.js')
const { default: redis } = await import('./redisService.js')

// Redis is never connected here, so the write is recorded rather than made
const writes = new Map()
redis.setCache = async (key, value, ttl) => Boolean(writes.set(key, ttl))
const ttlOf = key => writes.get(key)

const LD = (value, year = 2010) => `<script type="application/ld+json">${JSON.stringify({
  '@type': 'Movie', aggregateRating: { ratingValue: value }, dateCreated: `${year}-07-16`
})}</script>`

const ok = body => new Response(body, { status: 200 })

// Route by host, since the RT and Metacritic reads run concurrently and their order is not fixed
// Build a fresh Response per call: a body reads once, and a probe to the same host would consume it
function stubHosts(routes) {
  const calls = { count: 0 }
  globalThis.fetch = async url => {
    calls.count++
    return routes[new URL(url).host]?.() ?? new Response('', { status: 404 })
  }
  return calls
}

const wikidata = (rt, mc) => () => ok(JSON.stringify({ P1258: [{ value: { content: rt } }], P1712: [{ value: { content: mc } }] }))
// The year matches the fixtures' usual release date, since a probed slug is only accepted when it does
const rtScorecard = (critic, audience, year = 2010) => () => ok(`<script id="media-scorecard-json">${JSON.stringify({
  criticsScore: { score: critic }, audienceScore: { score: audience }
})}</script><script type="application/ld+json">${JSON.stringify({ '@type': 'Movie', dateCreated: `${year}-07-16` })}</script>`)

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
  const calls = stubHosts({
    'www.wikidata.org': wikidata('m/inception', 'movie/inception'),
    'www.rottentomatoes.com': rtScorecard(50, 85),
    'www.metacritic.com': () => ok(LD(52))
  })

  const score = await scoreService.getScore('test/movie/27205', {
    tmdbScore: 67, wikiId: 'Q25188', title: 'Inception', releaseDate: '2010-07-16', mediaType: 'movie'
  }, false)

  // Wikidata carried both slugs, so no probe was needed and no source was retried
  assert.equal(calls.count, 3)

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

// "No page for this title" and "would not answer" must not be recorded alike: one is worth re-asking
test('a score missing a source that refused expires early', async () => {
  stubHosts({
    'www.wikidata.org': wikidata('m/inception', 'movie/inception'),
    'www.rottentomatoes.com': () => new Response('', { status: 429 }),
    'www.metacritic.com': () => ok(LD(52))
  })

  const score = await scoreService.getScore('test/movie/27205', {
    tmdbScore: 67, wikiId: 'Q25188', title: 'Inception', releaseDate: '2010-07-16', mediaType: 'movie'
  }, false)

  assert.deepEqual(Object.keys(score.scores), ['metacritic', 'tmdb'])
  assert.equal(ttlOf('test/movie/27205'), 60 * 60)
})

// A 404 is the title's own answer, so the thinner score is settled and keeps the full life
test('a score missing a source that has no page keeps the full life', async () => {
  stubHosts({
    'www.wikidata.org': wikidata('m/nope', 'movie/inception'),
    'www.rottentomatoes.com': () => new Response('', { status: 404 }),
    'www.metacritic.com': () => ok(LD(52))
  })

  const score = await scoreService.getScore('test/movie/27205', {
    tmdbScore: 67, wikiId: 'Q25188', title: 'Inception', releaseDate: '2010-07-16', mediaType: 'movie'
  }, false)

  assert.deepEqual(Object.keys(score.scores), ['metacritic', 'tmdb'])
  assert.equal(ttlOf('test/movie/27205'), 60 * 60 * 48)
})

// A block arrives as whatever status the CDN in front of the source happens to use
test('a block on any status shortens the record, a 404 does not', async () => {
  for (const status of [403, 406, 429, 451, 503]) {
    stubHosts({
      'www.wikidata.org': wikidata('m/inception', 'movie/inception'),
      'www.rottentomatoes.com': () => new Response('', { status }),
      'www.metacritic.com': () => ok(LD(52))
    })

    await scoreService.getScore(`test/movie/${status}`, {
      tmdbScore: 67, wikiId: 'Q25188', title: 'Inception', releaseDate: '2010-07-16', mediaType: 'movie'
    }, false)

    assert.equal(ttlOf(`test/movie/${status}`), 60 * 60, `status ${status}`)
  }
})

// A Wikidata timeout leaves no slugs, so the score is missing sources rather than lacking them
test('a slug lookup that never answered shortens the record too', async () => {
  globalThis.fetch = async url => new URL(url).host === 'www.wikidata.org'
    ? Promise.reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' }))
    : new Response('', { status: 404 })

  await scoreService.getScore('test/movie/slugfail', {
    tmdbScore: 67, wikiId: 'Q25188', title: 'Inception', releaseDate: '2010-07-16', mediaType: 'movie'
  }, false)

  assert.equal(ttlOf('test/movie/slugfail'), 60 * 60)
})

// Half of the Metacritic pages that answer have no Metascore yet, which is the title's own answer
test('a Metacritic page with no Metascore keeps the full life', async () => {
  const unrated = () => ok('<script type="application/ld+json">{"@type":"Movie","name":"x"}</script>')
  stubHosts({
    'www.wikidata.org': wikidata('m/inception', 'movie/inception'),
    'www.rottentomatoes.com': rtScorecard(50, 85),
    'www.metacritic.com': unrated
  })

  await scoreService.getScore('test/movie/unrated', {
    tmdbScore: 67, wikiId: 'Q25188', title: 'Inception', releaseDate: '2010-07-16', mediaType: 'movie'
  }, false)

  assert.equal(ttlOf('test/movie/unrated'), 60 * 60 * 48)
})

// A challenge page answers 200 and parses; the absence of a whole-title block is the tell
test('a page with no whole-title block shortens the record', async () => {
  const challenge = () => ok('<script type="application/ld+json">{"@type":"WebPage"}</script>')
  stubHosts({
    'www.wikidata.org': wikidata('m/inception', 'movie/inception'),
    'www.rottentomatoes.com': rtScorecard(50, 85),
    'www.metacritic.com': challenge
  })

  await scoreService.getScore('test/movie/challenge', {
    tmdbScore: 67, wikiId: 'Q25188', title: 'Inception', releaseDate: '2010-07-16', mediaType: 'movie'
  }, false)

  assert.equal(ttlOf('test/movie/challenge'), 60 * 60)
})

// Caching an unanswered guess would outlive the score's retry window, so the rebuild an hour
// later would find the same thin data and give it a full life
test('an unanswered slug lookup is not cached, so the retry re-asks', async () => {
  stubHosts({
    'www.wikidata.org': () => new Response('', { status: 429 }),
    'www.rottentomatoes.com': () => new Response('', { status: 429 }),
    'www.metacritic.com': () => new Response('', { status: 429 })
  })

  // A key of its own: the recorded writes are shared across tests in this file
  await scoreService.getScore('test/movie/noslug', {
    tmdbScore: 67, wikiId: 'Q777', title: 'Nothing Answers', releaseDate: '2026-01-01', mediaType: 'movie'
  }, false)

  assert.equal(ttlOf('test/movie/noslug'), 60 * 60)
  assert.equal(ttlOf('slugs/v1/movie/Q777/Nothing Answers/2026-01-01'), undefined)
})

// A 200 with nothing in it is not a page either, and some proxies answer that way on error
test('an empty body shortens the record despite the status', async () => {
  stubHosts({
    'www.wikidata.org': wikidata('m/inception', 'movie/inception'),
    'www.rottentomatoes.com': () => ok(''),
    'www.metacritic.com': () => ok(LD(52))
  })

  await scoreService.getScore('test/movie/empty', {
    tmdbScore: 67, wikiId: 'Q25188', title: 'Inception', releaseDate: '2010-07-16', mediaType: 'movie'
  }, false)

  assert.equal(ttlOf('test/movie/empty'), 60 * 60)
})

// Wikidata rate-limits readily, and it is only a shortcut: if the probes resolve both slugs and
// both sources answer, nothing is missing and the record deserves its full life
test('a Wikidata blip does not shorten a score the probes resolved', async () => {
  stubHosts({
    'www.wikidata.org': () => new Response('', { status: 429 }),
    'www.rottentomatoes.com': rtScorecard(50, 85),
    'www.metacritic.com': () => ok(LD(52))
  })

  const score = await scoreService.getScore('test/movie/wikiblip', {
    tmdbScore: 67, wikiId: 'Q42', title: 'Probed Fine', releaseDate: '2010-07-16', mediaType: 'movie'
  }, false)

  assert.deepEqual(Object.keys(score.scores), ['metacritic', 'rtCritic', 'rtAudience', 'tmdb'])
  assert.equal(ttlOf('test/movie/wikiblip'), 60 * 60 * 48)
  assert.ok(ttlOf('slugs/v1/movie/Q42/Probed Fine/2010-07-16'), 'the resolved slugs are still worth caching')
})

// A malformed sibling block used to throw and discard a rating that had already been found
test('a malformed JSON-LD block does not lose a rating', async () => {
  const mixed = () => ok(`<script type="application/ld+json">{"@type":"Movie","aggregateRating":{"ratingValue":52}}</script><script type="application/ld+json">{ not json </script>`)
  stubHosts({
    'www.wikidata.org': wikidata('m/inception', 'movie/inception'),
    'www.rottentomatoes.com': rtScorecard(50, 85),
    'www.metacritic.com': mixed
  })

  const score = await scoreService.getScore('test/movie/mixedld', {
    tmdbScore: 67, wikiId: 'Q25188', title: 'Inception', releaseDate: '2010-07-16', mediaType: 'movie'
  }, false)

  assert.equal(score.scores.metacritic, 52)
  assert.equal(ttlOf('test/movie/mixedld'), 60 * 60 * 48)
})


// throttleMs is set by the job and read nowhere else, so the wiring needs its own cover
test('a set throttle spaces repeat requests to one host', async () => {
  // No slug from Wikidata, so both RT candidates get probed: two requests to the same host
  const calls = stubHosts({
    'www.wikidata.org': () => ok('{}'),
    'www.rottentomatoes.com': () => new Response('', { status: 404 }),
    'www.metacritic.com': () => new Response('', { status: 404 })
  })
  const started = Date.now()

  scoreService.throttleMs = 120

  try {
    await scoreService.getScore('test/movie/spaced', {
      tmdbScore: 67, wikiId: 'Q4', title: 'Spaced', releaseDate: '2010-07-16', mediaType: 'movie'
    }, false)
  } finally {
    scoreService.throttleMs = 0
  }

  assert.ok(calls.count >= 3, `expected a Wikidata call and two RT probes, got ${calls.count}`)
  assert.ok(Date.now() - started >= 120, 'the second request to a host should have waited out the interval')
})

// Measured: metacritic.com/movie/inception// 404s where movie/inception/ is a 200, so a slug
// carrying its own trailing slash silently dropped the Metascore
test('a Wikidata slug with a trailing slash still reaches Metacritic', async () => {
  let requested
  stubHosts({
    'www.wikidata.org': wikidata('m/trailing', 'movie/trailing/'),
    'www.rottentomatoes.com': rtScorecard(50, 85),
    // 404 on the doubled slash, as Metacritic really does, so the score proves the trim happened
    'www.metacritic.com': () => new Response('', { status: 404 })
  })
  const routed = globalThis.fetch
  globalThis.fetch = async (url, options) => {
    if (new URL(url).host !== 'www.metacritic.com') return routed(url, options)
    requested = url
    return url.includes('//', 8) ? new Response('', { status: 404 }) : ok(LD(52))
  }

  const score = await scoreService.getScore('test/movie/trailing', {
    tmdbScore: 67, wikiId: 'Q5', title: 'Trailing', releaseDate: '2010-07-16', mediaType: 'movie'
  }, false)

  assert.equal(requested, 'https://www.metacritic.com/movie/trailing/')
  assert.equal(score.scores.metacritic, 52)
})

// `m/breach` answers 200 with a confident 2007 title for a 2026 release. The year in schema.org
// JSON-LD is what separates them; any 200 used to be accepted.
const rtPage = (critic, audience, year) => () => ok(
  `<script id="media-scorecard-json">${JSON.stringify({ criticsScore: { score: critic }, audienceScore: { score: audience } })}</script>` +
  (year ? `<script type="application/ld+json">${JSON.stringify({ '@type': 'Movie', dateCreated: `${year}-02-16` })}</script>` : '')
)

// Per-host request counting, since the point of one GET is that it replaces a probe plus a read
function countingHosts(routes) {
  const seen = []
  globalThis.fetch = async url => {
    seen.push(String(url))
    return routes[new URL(url).host]?.(String(url)) ?? new Response('', { status: 404 })
  }
  return seen
}

test('a guessed slug for a different film is rejected, and the year variant tried', async () => {
  const slugs = { probed: 0, rejected: 0 }
  const seen = countingHosts({
    'www.wikidata.org': () => ok('{}'),
    // the bare guess is a 2007 film; the year variant is the real one
    'www.rottentomatoes.com': url => url.endsWith('_2026') ? rtPage(70, 80, 2026)() : rtPage(83, 91, 2007)(),
    'www.metacritic.com': () => new Response('', { status: 404 })
  })

  const score = await scoreService.getScore('test/movie/breach', {
    tmdbScore: 67, title: 'Breach', releaseDate: '2026-05-01', mediaType: 'movie'
  }, false, slugs)

  assert.equal(score.scores.rtCritic, 70, 'the 2026 page, not the 2007 one')
  assert.deepEqual(slugs, { probed: 1, rejected: 1 })
  assert.deepEqual(seen.filter(url => url.includes('rottentomatoes')),
    ['https://www.rottentomatoes.com/m/breach', 'https://www.rottentomatoes.com/m/breach_2026'])
})

// Wikidata is authoritative — paying the year check there would reject legitimate slugs whose
// page year differs from TMDB's by a re-release or a festival date
test('a Wikidata slug is accepted even when the page year differs', async () => {
  const slugs = { probed: 0, rejected: 0 }
  stubHosts({
    'www.wikidata.org': wikidata('m/authoritative', 'movie/authoritative'),
    'www.rottentomatoes.com': rtPage(55, 60, 1999),
    'www.metacritic.com': () => ok(LD(52))
  })

  const score = await scoreService.getScore('test/movie/authoritative', {
    tmdbScore: 67, wikiId: 'Q9', title: 'Authoritative', releaseDate: '2026-05-01', mediaType: 'movie'
  }, false, slugs)

  assert.equal(score.scores.rtCritic, 55)
  assert.deepEqual(slugs, { probed: 0, rejected: 0 }, 'an authoritative slug is neither guessed nor rejected')
})

// One GET per candidate replaces a HEAD probe plus a separate read
test('resolving a guess costs one request, not a probe and a read', async () => {
  const seen = countingHosts({
    'www.wikidata.org': () => ok('{}'),
    'www.rottentomatoes.com': rtPage(70, 80, 2026),
    'www.metacritic.com': () => new Response('', { status: 404 })
  })

  await scoreService.getScore('test/movie/onerequest', {
    tmdbScore: 67, title: 'One Request', releaseDate: '2026-05-01', mediaType: 'movie'
  }, false)

  assert.deepEqual(seen.filter(url => url.includes('rottentomatoes')), ['https://www.rottentomatoes.com/m/one_request'])
})

// A year we cannot read must not pass as a year that matched: if a host drops the field, the
// verification would silently stop working and go back to scoring whatever answered
test('a guessed slug whose page has no year is rejected, not trusted', async () => {
  const slugs = { probed: 0, rejected: 0 }
  stubHosts({
    'www.wikidata.org': () => ok('{}'),
    'www.rottentomatoes.com': rtPage(83, 91, null),
    'www.metacritic.com': () => new Response('', { status: 404 })
  })

  const score = await scoreService.getScore('test/movie/noyear', {
    tmdbScore: 67, title: 'No Year', releaseDate: '2026-05-01', mediaType: 'movie'
  }, false, slugs)

  assert.equal(score.scores.rtCritic, undefined, 'an unverifiable page cannot resolve a guess')
  assert.deepEqual(slugs, { probed: 0, rejected: 2 }, 'both candidates rejected')
})

// Wikidata confirming a cached guess makes it authoritative, so it stops paying the year check
test('a cached guess that Wikidata confirms stops being treated as a guess', async () => {
  const slugs = { probed: 0, rejected: 0 }
  stubHosts({
    'www.wikidata.org': wikidata('m/confirmed', 'movie/confirmed'),
    // the page year disagrees with TMDB, which would reject it if it were still a guess
    'www.rottentomatoes.com': rtPage(55, 60, 1999),
    'www.metacritic.com': () => new Response('', { status: 404 })
  })
  redis.getCache = async key => key.startsWith('slugs/') ? { rt: 'm/confirmed', rtSource: 'probed' } : null

  try {
    const score = await scoreService.getScore('test/movie/confirmed', {
      tmdbScore: 67, wikiId: 'Q11', title: 'Confirmed', releaseDate: '2026-05-01', mediaType: 'movie'
    }, false, slugs)

    assert.equal(score.scores.rtCritic, 55, 'the confirmed slug is authoritative, so the year is not checked')
    assert.equal(slugs.rejected, 0)
  } finally {
    redis.getCache = async () => null
  }
})

// A 429 is not evidence a slug is wrong. Overwriting the record would drop an authoritative slug
// that only Wikidata can return, so a failed read must leave the stored record alone.
test('a source refusing to answer does not erase its cached slug', async () => {
  stubHosts({
    'www.wikidata.org': () => ok('{}'),
    'www.rottentomatoes.com': () => new Response('', { status: 429 }),
    'www.metacritic.com': () => ok(LD(52))
  })
  redis.getCache = async key => key.startsWith('slugs/')
    ? { rt: 'm/authoritative', mc: 'movie/authoritative', rtSource: 'wikidata', mcSource: 'wikidata' }
    : null

  try {
    await scoreService.getScore('test/movie/refused', {
      tmdbScore: 67, wikiId: 'Q12', title: 'Refused', releaseDate: '2010-07-16', mediaType: 'movie'
    }, false)

    assert.equal(ttlOf('slugs/v1/movie/Q12/Refused/2010-07-16'), undefined, 'no slug write, so the stored record survives')
  } finally {
    redis.getCache = async () => null
  }
})
