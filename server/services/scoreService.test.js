import { test } from 'node:test'
import assert from 'node:assert/strict'

// Same shape as checks.test.js: env.js only needs the keys to exist.
for (const key of ['TMDB_TOKEN', 'TMDB_API_URL', 'GCP_API_URL', 'GCP_API_KEY', 'GCP_SEARCH_ENGINE']) {
  process.env[key] ??= 'test'
}

const { default: scoreService, orderCandidates, scoreKey } = await import('./scoreService.js')
const { default: redis, WRITTEN, DECLINED, FAILED } = await import('./redisService.js')
const { default: log } = await import('../utils/logger.js')

// Redis is never connected here, so the write is recorded rather than made
const writes = new Map()
// Models NX: a conditional write declines while the record is present, which is the refusal path.
// `vanished` flips it, standing in for a record that expired while the sources were being fetched.
let vanished = false
let writeFails = false
redis.setCache = async (key, value, ttl, ifAbsent) => {
  if (writeFails) return FAILED
  if (ifAbsent && !vanished) return DECLINED

  writes.set(key, { value, ttl })
  return WRITTEN
}
const ttlOf = key => writes.get(key)?.ttl
const realGetCache = redis.getCache
// Through JSON, because that is what Redis stores: undefined keys do not survive the trip
const wrote = key => writes.has(key) ? JSON.parse(JSON.stringify(writes.get(key).value)) : undefined

const realWarn = log.warn

// Captures the fields of one warning, since a rejection is logged rather than counted. Always wraps
// the original, so successive tests do not stack wrappers on each other.
function warnings(message) {
  const seen = []

  log.warn = (msg, fields) => { if (msg === message) seen.push(fields); return realWarn(msg, fields) }

  return () => seen
}

const LD = (value, year = 2010, reviewCount) => `<script type="application/ld+json">${JSON.stringify({
  '@type': 'Movie', aggregateRating: { ratingValue: value, reviewCount }, dateCreated: `${year}-07-16`
})}</script>`

const ok = body => new Response(body, { status: 200 })

// Route by host, since the RT and Metacritic reads run concurrently and their order is not fixed
// Build a fresh Response per call: a body reads once, and a probe to the same host would consume it
function stubHosts(routes) {
  const calls = { count: 0 }
  globalThis.fetch = async url => {
    calls.count++
    return routes[new URL(url).host]?.(String(url)) ?? new Response('', { status: 404 })
  }
  return calls
}

const wikidata = (rt, mc) => () => ok(JSON.stringify({ P1258: [{ value: { content: rt } }], P1712: [{ value: { content: mc } }] }))
// The year matches the fixtures' usual release date, since a guessed slug is only accepted when it does
const rtScorecard = (critic, audience, year = 2010, criticCount, audienceCount) => () => ok(`<script id="media-scorecard-json">${JSON.stringify({
  criticsScore: { score: critic, reviewCount: criticCount }, audienceScore: { score: audience, reviewCount: audienceCount }
})}</script><script type="application/ld+json">${JSON.stringify({ '@type': 'Movie', dateCreated: `${year}-07-16` })}</script>`)

const timeout = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })

// Retry and body-discard policy, through the path production runs. Metacritic's slug is guessed
// from the title, so `movie/inception` is its only candidate and every call to that host is the read
// under test — pinned to one host so the concurrent reads of the other two cannot consume the queue.
// No wikiId, so the lookup is skipped.
async function readMC(key, ...outcomes) {
  const calls = { count: 0 }

  globalThis.fetch = async url => {
    if (new URL(url).host !== 'www.metacritic.com') return new Response('', { status: 404 })

    const outcome = outcomes[calls.count++] ?? outcomes.at(-1)
    if (outcome instanceof Error) throw outcome
    return outcome
  }

  const score = await scoreService.getScore(key, { title: 'Inception', releaseDate: '2010-07-16' }, false)

  return { calls, metacritic: score.scores.metacritic }
}

test('a timeout is retried and the score survives', async () => {
  const { calls, metacritic } = await readMC('test/read/timeout', timeout(), ok(LD(74)))

  assert.equal(metacritic, 74)
  assert.equal(calls.count, 2)
})

test('a 5xx is retried', async () => {
  const { calls, metacritic } = await readMC('test/read/5xx', new Response('', { status: 503 }), ok(LD(74)))

  assert.equal(metacritic, 74)
  assert.equal(calls.count, 2)
})

// A wrong guess 404s by design, so retrying a 4xx would double every miss for nothing.
test('a 404 is not retried', async () => {
  const { calls, metacritic } = await readMC('test/read/404', new Response('', { status: 404 }), ok(LD(74)))

  assert.equal(metacritic, undefined)
  assert.equal(calls.count, 1)
})

test('two timeouts in a row give up rather than looping', async () => {
  const { calls, metacritic } = await readMC('test/read/twotimeouts', timeout(), timeout())

  assert.equal(metacritic, undefined)
  assert.equal(calls.count, 2)
})

// Undici holds the connection for a response whose body is never read.
test('the discarded 5xx body is released, not left holding a connection', async () => {
  const discarded = new Response('boom', { status: 503 })
  const { metacritic } = await readMC('test/read/discard', discarded, ok(LD(74)))

  assert.equal(metacritic, 74)
  assert.equal(discarded.bodyUsed, true, 'body of the abandoned 5xx was never released')
})

// A retry that also fails still hands the response back to the caller, which only
// reads its status — so the final body needs releasing too, not just the first.
test('a 5xx surviving the retry releases both bodies', async () => {
  const first = new Response('boom', { status: 503 })
  const final = new Response('boom', { status: 503 })

  const { metacritic } = await readMC('test/read/bothbodies', first, final)

  assert.equal(metacritic, undefined)
  assert.equal(first.bodyUsed, true, 'first 5xx body was never released')
  assert.equal(final.bodyUsed, true, 'final 5xx body was never released')
})

test('a 4xx body is released even though it is never retried', async () => {
  const missing = new Response('not found', { status: 404 })

  const { metacritic } = await readMC('test/read/4xxbody', missing)

  assert.equal(metacritic, undefined)
  assert.equal(missing.bodyUsed, true, '404 body was never released')
})

test('a healthy response is not retried', async () => {
  const { calls, metacritic } = await readMC('test/read/healthy', ok(LD(74)))

  assert.equal(metacritic, 74)
  assert.equal(calls.count, 1)
})


// Ordering is pure, so the rules can be read straight off the list with no host contacted
test('Wikidata outranks a cached guess without discarding it', () => {
  assert.deepEqual(orderCandidates('m/guess', 'guessed', 'm/wiki', ['m/title']), [
    { slug: 'm/wiki', source: 'wikidata' },
    { slug: 'm/guess', source: 'guessed' },
    { slug: 'm/title', source: 'guessed' }
  ])
})

test('a cached guess Wikidata confirms becomes authoritative and stands alone', () => {
  assert.deepEqual(orderCandidates('m/same', 'guessed', 'm/same', ['m/title']), [
    { slug: 'm/same', source: 'wikidata' },
    { slug: 'm/title', source: 'guessed' }
  ])
})

// A record written before the source field existed must be verified, not trusted
test('a cached slug of unknown source counts as guessed', () => {
  assert.deepEqual(orderCandidates('m/legacy', undefined, undefined, []), [{ slug: 'm/legacy', source: 'guessed' }])
})

test('a guess matching the Wikidata slug is not asked for twice', () => {
  assert.deepEqual(orderCandidates(undefined, undefined, 'm/title', ['m/title', 'm/title_2010']), [
    { slug: 'm/title', source: 'wikidata' },
    { slug: 'm/title_2010', source: 'guessed' }
  ])
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
    wikiId: 'Q25188', title: 'Inception', releaseDate: '2010-07-16', mediaType: 'movie'
  }, false)

  // Wikidata carried both slugs, so no probe was needed and no source was retried
  assert.equal(calls.count, 3)

  // (52 + 50 + 85) / 3 is 62.3
  assert.deepEqual(score.scores, { metacritic: 52, rtCritic: 50, rtAudience: 85 })
  assert.equal(score.avgScore, 62)
})

// Every source publishes how many reviews its score came from, and an unweighted mean over a
// 37-rating audience score and a 2,780-rating one favours whichever thin component happens to be high
test('each score is stored beside the sample size it came from', async () => {
  const { default: imdb } = await import('./imdbService.js')
  const realGetRating = imdb.getRating
  imdb.getRating = async () => ({ rating: 8.4, votes: 912_000 })

  stubHosts({
    'www.wikidata.org': wikidata('m/inception', 'movie/inception'),
    'www.rottentomatoes.com': rtScorecard(87, 91, 2010, 526, 9065),
    'www.metacritic.com': () => ok(LD(74, 2010, 68))
  })

  const score = await scoreService.getScore('test/movie/counts', {
    imdbId: 'tt1375666', wikiId: 'Q25188', title: 'Inception', releaseDate: '2010-07-16', mediaType: 'movie'
  }, false)

  imdb.getRating = realGetRating

  assert.deepEqual(score.scores, { imdb: 84, metacritic: 74, rtCritic: 87, rtAudience: 91 })
  assert.deepEqual(score.counts, { imdb: 912_000, metacritic: 68, rtCritic: 526, rtAudience: 9065 })
})

// RT reports 0 where it has no reviews, and a zero sample would read as a real one a weighting could divide by
test('a source with no reviews has no count rather than a zero', async () => {
  stubHosts({
    'www.wikidata.org': wikidata('m/inception', 'movie/inception'),
    'www.rottentomatoes.com': rtScorecard(87, undefined, 2010, 526, 0),
    'www.metacritic.com': () => ok(LD(74))
  })

  const score = await scoreService.getScore('test/movie/nocount', {
    wikiId: 'Q25188', title: 'Inception', releaseDate: '2010-07-16', mediaType: 'movie'
  }, false)

  assert.deepEqual(score.counts, { rtCritic: 526 })
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

  const score = await scoreService.getScore('test/movie/refusedsource', {
    wikiId: 'Q25188', title: 'Inception', releaseDate: '2010-07-16', mediaType: 'movie'
  }, false)

  assert.deepEqual(Object.keys(score.scores), ['metacritic'])
  assert.equal(ttlOf('test/movie/refusedsource'), 60 * 60)
})

// A 404 is the title's own answer, so the thinner score is settled and keeps the full life
test('a score missing a source that has no page keeps the full life', async () => {
  stubHosts({
    'www.wikidata.org': wikidata('m/nope', 'movie/inception'),
    'www.rottentomatoes.com': () => new Response('', { status: 404 }),
    'www.metacritic.com': () => ok(LD(52))
  })

  const score = await scoreService.getScore('test/movie/nopage', {
    wikiId: 'Q25188', title: 'Inception', releaseDate: '2010-07-16', mediaType: 'movie'
  }, false)

  assert.deepEqual(Object.keys(score.scores), ['metacritic'])
  assert.equal(ttlOf('test/movie/nopage'), 60 * 60 * 48)
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
      wikiId: 'Q25188', title: 'Inception', releaseDate: '2010-07-16', mediaType: 'movie'
    }, false)

    assert.equal(ttlOf(`test/movie/${status}`), 60 * 60, `status ${status}`)
    assert.deepEqual(Object.keys(wrote(`test/movie/${status}`).scores), ['metacritic'], `status ${status}`)
  }
})

// The lookup is the only external read here whose own failure could cost the two that carry scores:
// the outer catch sits outside the Promise.all that contacts them. A throw is the case a bad status
// does not cover — the test above covers that one.
// An id and title of their own: the slug key is built from them, and the recorded writes are shared
// across every test in this file
for (const [label, id, wikidata] of [
  ['a timeout', 'Q900', () => Promise.reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' }))],
  ['a 200 that is not JSON', 'Q901', () => ok('<html>a challenge page</html>')]
]) {
  test(`a slug lookup answering with ${label} costs the lookup, not the title`, async () => {
    stubHosts({
      'www.wikidata.org': wikidata,
      'www.rottentomatoes.com': rtScorecard(50, 85),
      'www.metacritic.com': () => ok(LD(52))
    })

    const key = `test/movie/${id}`
    const score = await scoreService.getScore(key, {
      wikiId: id, title: 'Wiki Throw', releaseDate: '2010-07-16', mediaType: 'movie'
    }, false)

    assert.deepEqual(Object.keys(score.scores), ['metacritic', 'rtCritic', 'rtAudience'],
      'both score sources were read despite the lookup failing')
    // Both slugs resolved by guessing, so nothing is missing and the score keeps its full life
    assert.equal(ttlOf(key), 60 * 60 * 48)
    assert.equal(wrote(`slugs/v1/movie/${id}/Wiki Throw/2010-07-16`), undefined,
      'an unanswered lookup still leaves the stored record alone')
  })
}

// Half of the Metacritic pages that answer have no Metascore yet, which is the title's own answer
test('a Metacritic page with no Metascore keeps the full life', async () => {
  const unrated = () => ok('<script type="application/ld+json">{"@type":"Movie","name":"x"}</script>')
  stubHosts({
    'www.wikidata.org': wikidata('m/inception', 'movie/inception'),
    'www.rottentomatoes.com': rtScorecard(50, 85),
    'www.metacritic.com': unrated
  })

  await scoreService.getScore('test/movie/unrated', {
    wikiId: 'Q25188', title: 'Inception', releaseDate: '2010-07-16', mediaType: 'movie'
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

  const score = await scoreService.getScore('test/movie/challenge', {
    wikiId: 'Q25188', title: 'Inception', releaseDate: '2010-07-16', mediaType: 'movie'
  }, false)

  assert.deepEqual(Object.keys(score.scores), ['rtCritic', 'rtAudience'], 'the challenge page yielded no Metascore')
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
    wikiId: 'Q777', title: 'Nothing Answers', releaseDate: '2026-01-01', mediaType: 'movie'
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

  const score = await scoreService.getScore('test/movie/empty', {
    wikiId: 'Q25188', title: 'Inception', releaseDate: '2010-07-16', mediaType: 'movie'
  }, false)

  assert.deepEqual(Object.keys(score.scores), ['metacritic'], 'the empty RT body yielded no scores')
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
    wikiId: 'Q42', title: 'Probed Fine', releaseDate: '2010-07-16', mediaType: 'movie'
  }, false)

  assert.deepEqual(Object.keys(score.scores), ['metacritic', 'rtCritic', 'rtAudience'])
  assert.equal(ttlOf('test/movie/wikiblip'), 60 * 60 * 48)
  assert.equal(ttlOf('slugs/v1/movie/Q42/Probed Fine/2010-07-16'), undefined,
    'an unread lookup leaves the record alone, so the guesses are re-resolved next run')
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
    wikiId: 'Q25188', title: 'Inception', releaseDate: '2010-07-16', mediaType: 'movie'
  }, false)

  assert.equal(score.scores.metacritic, 52)
  assert.equal(ttlOf('test/movie/mixedld'), 60 * 60 * 48)
})


// throttleMs is set by the job and read nowhere else, so the wiring needs its own cover
test('a set throttle spaces repeat requests to one host', async () => {
  // No slug from Wikidata, so both RT candidates get guessed: two requests to the same host
  const calls = stubHosts({
    'www.wikidata.org': () => ok('{}'),
    'www.rottentomatoes.com': () => new Response('', { status: 404 }),
    'www.metacritic.com': () => new Response('', { status: 404 })
  })
  const started = Date.now()

  scoreService.throttleMs = 120

  try {
    await scoreService.getScore('test/movie/spaced', {
      wikiId: 'Q4', title: 'Spaced', releaseDate: '2010-07-16', mediaType: 'movie'
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
  const requested = []
  stubHosts({
    'www.wikidata.org': wikidata('m/trailing', 'movie/trailing/'),
    'www.rottentomatoes.com': rtScorecard(50, 85),
    // 404 on the doubled slash, as Metacritic really does, so the score proves the trim happened
    'www.metacritic.com': () => new Response('', { status: 404 })
  })
  const routed = globalThis.fetch
  globalThis.fetch = async (url, options) => {
    if (new URL(url).host !== 'www.metacritic.com') return routed(url, options)
    requested.push(String(url))
    return url.includes('//', 8) ? new Response('', { status: 404 }) : ok(LD(52))
  }

  const score = await scoreService.getScore('test/movie/trailing', {
    wikiId: 'Q5', title: 'Trailing', releaseDate: '2010-07-16', mediaType: 'movie'
  }, false)

  // Every request, not the last: an untrimmed slug 404s and the guessed candidate is the same
  // string trimmed, so keeping only the final URL passed with the trim deleted
  assert.deepEqual(requested, ['https://www.metacritic.com/movie/trailing/'])
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
  const rejections = warnings('Slug rejected as a different title')
  const seen = countingHosts({
    'www.wikidata.org': () => ok('{}'),
    // the bare guess is a 2007 film; the year variant is the real one
    'www.rottentomatoes.com': url => url.endsWith('_2026') ? rtPage(70, 80, 2026)() : rtPage(83, 91, 2007)(),
    'www.metacritic.com': () => new Response('', { status: 404 })
  })

  const score = await scoreService.getScore('test/movie/breach', {
    title: 'Breach', releaseDate: '2026-05-01', mediaType: 'movie'
  }, false)

  assert.equal(score.scores.rtCritic, 70, 'the 2026 page, not the 2007 one')
  assert.deepEqual(rejections(), [{ slug: 'm/breach', pageYear: 2007, wantYear: 2026 }])
  assert.deepEqual(seen.filter(url => url.includes('rottentomatoes')),
    ['https://www.rottentomatoes.com/m/breach', 'https://www.rottentomatoes.com/m/breach_2026'])
})

// Wikidata is authoritative — paying the year check there would reject legitimate slugs whose
// page year differs from TMDB's by a re-release or a festival date
test('a Wikidata slug is accepted even when the page year differs', async () => {
  const rejections = warnings('Slug rejected as a different title')
  stubHosts({
    'www.wikidata.org': wikidata('m/authoritative', 'movie/authoritative'),
    'www.rottentomatoes.com': rtPage(55, 60, 1999),
    'www.metacritic.com': () => ok(LD(52))
  })

  const score = await scoreService.getScore('test/movie/authoritative', {
    wikiId: 'Q9', title: 'Authoritative', releaseDate: '2026-05-01', mediaType: 'movie'
  }, false)

  assert.equal(score.scores.rtCritic, 55)
  assert.deepEqual(rejections(), [], 'an authoritative slug does not pay the year check')
})

// One GET per candidate replaces a HEAD probe plus a separate read
test('resolving a guess costs one request, not a probe and a read', async () => {
  const seen = countingHosts({
    'www.wikidata.org': () => ok('{}'),
    'www.rottentomatoes.com': rtPage(70, 80, 2026),
    'www.metacritic.com': () => new Response('', { status: 404 })
  })

  await scoreService.getScore('test/movie/onerequest', {
    title: 'One Request', releaseDate: '2026-05-01', mediaType: 'movie'
  }, false)

  assert.deepEqual(seen.filter(url => url.includes('rottentomatoes')), ['https://www.rottentomatoes.com/m/one_request'])
})

// A year we cannot read must not pass as a year that matched: if a host drops the field, the
// verification would silently stop working and go back to scoring whatever answered
test('a guessed slug whose page has no year is rejected, not trusted', async () => {
  const rejections = warnings('Slug rejected as a different title')
  stubHosts({
    'www.wikidata.org': () => ok('{}'),
    'www.rottentomatoes.com': rtPage(83, 91, null),
    'www.metacritic.com': () => new Response('', { status: 404 })
  })

  const score = await scoreService.getScore('test/movie/noyear', {
    title: 'No Year', releaseDate: '2026-05-01', mediaType: 'movie'
  }, false)

  assert.equal(score.scores.rtCritic, undefined, 'an unverifiable page cannot resolve a guess')
  assert.equal(rejections().length, 2, 'both candidates rejected')
})

// Wikidata confirming a cached guess makes it authoritative, so it stops paying the year check
test('a cached guess that Wikidata confirms stops being treated as a guess', async () => {
  const rejections = warnings('Slug rejected as a different title')
  stubHosts({
    'www.wikidata.org': wikidata('m/confirmed', 'movie/confirmed'),
    // the page year disagrees with TMDB, which would reject it if it were still a guess
    'www.rottentomatoes.com': rtPage(55, 60, 1999),
    'www.metacritic.com': () => new Response('', { status: 404 })
  })
  redis.getCache = async key => key.startsWith('slugs/') ? { rt: 'm/confirmed', rtSource: 'guessed' } : null

  try {
    const score = await scoreService.getScore('test/movie/confirmed', {
      wikiId: 'Q11', title: 'Confirmed', releaseDate: '2026-05-01', mediaType: 'movie'
    }, false)

    assert.equal(score.scores.rtCritic, 55, 'the confirmed slug is authoritative, so the year is not checked')
    assert.deepEqual(rejections(), [])
  } finally {
    redis.getCache = realGetCache
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
      wikiId: 'Q12', title: 'Refused', releaseDate: '2010-07-16', mediaType: 'movie'
    }, false)

    assert.equal(wrote('slugs/v1/movie/Q12/Refused/2010-07-16'), undefined,
      'nothing is written, so the stored slug survives untouched')
  } finally {
    redis.getCache = realGetCache
  }
})

// A guess that verifies must not displace an authoritative slug the run merely failed to read —
// once it did, the record held both slugs, the lookup stopped being asked, and it was permanent
test('a refused authoritative slug is not replaced by a guess that verifies', async () => {
  stubHosts({
    'www.wikidata.org': () => ok('{}'),
    'www.rottentomatoes.com': url => url.endsWith('m/displaced')
      ? new Response('', { status: 403 })
      : rtPage(70, 80, 2026)(),
    'www.metacritic.com': () => ok(LD(52, 2026))
  })
  redis.getCache = async key => key.startsWith('slugs/')
    ? { rt: 'm/displaced', mc: 'movie/displaced', rtSource: 'wikidata', mcSource: 'wikidata' }
    : null

  try {
    await scoreService.getScore('test/movie/displaced', {
      wikiId: 'Q13', title: 'Displaced', releaseDate: '2026-05-01', mediaType: 'movie'
    }, false)

    assert.equal(wrote('slugs/v1/movie/Q13/Displaced/2026-05-01'), undefined,
      'a blocked read writes nothing, so the guess cannot displace the stored slug')
  } finally {
    redis.getCache = realGetCache
  }
})

// Wikidata must outrank a cached guess, or a guess that happens to verify discards the
// authoritative answer and then suppresses the lookup that could restore it
test('Wikidata outranks a cached guess for the same title', async () => {
  stubHosts({
    'www.wikidata.org': wikidata('m/from_wikidata', 'movie/from_wikidata'),
    'www.rottentomatoes.com': rtPage(70, 80, 2026),
    'www.metacritic.com': () => ok(LD(52, 2026))
  })
  // rt cached as a guess, mc missing, so the lookup runs and returns a different rt slug
  redis.getCache = async key => key.startsWith('slugs/') ? { rt: 'm/a_guess', rtSource: 'guessed' } : null

  try {
    await scoreService.getScore('test/movie/outranked', {
      wikiId: 'Q14', title: 'Outranked', releaseDate: '2026-05-01', mediaType: 'movie'
    }, false)

    const record = wrote('slugs/v1/movie/Q14/Outranked/2026-05-01')

    assert.equal(record?.rt, 'm/from_wikidata', 'the authoritative slug wins')
    assert.equal(record?.rtSource, 'wikidata')
  } finally {
    redis.getCache = realGetCache
  }
})

// A 404 on a cached slug is a verdict — the page is gone, so the slug must not be kept warm just
// because a different host happened to be unreadable in the same run
test('a cached slug that 404s is dropped, and takes its source with it', async () => {
  stubHosts({
    'www.wikidata.org': () => ok('{}'),
    'www.rottentomatoes.com': () => new Response('', { status: 404 }),
    'www.metacritic.com': () => ok(LD(52))
  })
  redis.getCache = async key => key.startsWith('slugs/')
    ? { rt: 'm/gone', mc: 'movie/still_here', rtSource: 'wikidata', mcSource: 'wikidata' }
    : null

  try {
    await scoreService.getScore('test/movie/verdict', {
      wikiId: 'Q15', title: 'Verdict', releaseDate: '2010-07-16', mediaType: 'movie'
    }, false)

    const record = wrote('slugs/v1/movie/Q15/Verdict/2010-07-16')

    assert.deepEqual(record, { mc: 'movie/still_here', mcSource: 'wikidata' },
      'a 404 is a verdict, so the dead slug and its source both go')
  } finally {
    redis.getCache = realGetCache
  }
})

// A host that just refused will refuse the next guess too, so asking anyway multiplied the
// rate-limit wait by the number of candidates
test('a refusing host is asked once, not once per candidate', async () => {
  const seen = countingHosts({
    'www.rottentomatoes.com': () => new Response('', { status: 429, headers: { 'retry-after': '1' } })
  })

  await scoreService.getScore('test/movie/amplified', {
    title: 'Amplified', releaseDate: '2010-07-16', mediaType: 'movie'
  }, false)

  // Two guesses exist, `m/amplified` and `m/amplified_2010`. Only the first is tried, and it
  // costs the one 429 plus the one retry the wait is for.
  assert.deepEqual(seen.filter(url => url.includes('rottentomatoes')),
    ['https://www.rottentomatoes.com/m/amplified', 'https://www.rottentomatoes.com/m/amplified'])
})

// A quiet lookup counts against the score only while a slug is still missing: it may have held the
// one the guesses could not find, so the thin score is worth rebuilding sooner
test('a Wikidata blip shortens the score when a slug is still missing', async () => {
  stubHosts({
    'www.wikidata.org': () => new Response('', { status: 429 }),
    'www.rottentomatoes.com': () => new Response('', { status: 404 }),
    'www.metacritic.com': () => ok(LD(52))
  })

  const score = await scoreService.getScore('test/movie/wikigap', {
    wikiId: 'Q43', title: 'Wiki Gap', releaseDate: '2010-07-16', mediaType: 'movie'
  }, false)

  // Metacritic resolved and RT did not, which is the case this exists for — a 1h TTL alone would
  // also hold if neither had
  assert.equal(score.scores.metacritic, 52)
  assert.equal(score.scores.rtCritic, undefined)
  assert.equal(ttlOf('test/movie/wikigap'), 60 * 60)
})

// Fall-through on a 404, which became a path of its own once `!page` and `!answered` split. The
// year-mismatch route above covers the same pair of URLs but never exercises this branch.
test('a 404 on the first guess falls through to the year variant', async () => {
  const seen = countingHosts({
    'www.wikidata.org': () => ok('{}'),
    'www.rottentomatoes.com': url => url.endsWith('_2026') ? rtPage(70, 80, 2026)() : new Response('', { status: 404 }),
    'www.metacritic.com': () => new Response('', { status: 404 })
  })

  const score = await scoreService.getScore('test/movie/fallthrough', {
    title: 'Fall Through', releaseDate: '2026-05-01', mediaType: 'movie'
  }, false)

  assert.equal(score.scores.rtCritic, 70, 'the year variant resolved after the bare guess 404d')
  assert.deepEqual(seen.filter(url => url.includes('rottentomatoes')),
    ['https://www.rottentomatoes.com/m/fall_through', 'https://www.rottentomatoes.com/m/fall_through_2026'])
})


// Refusing has to mean not writing: rewriting the stored value to keep it would renew its TTL every
// night and make a wrong score permanent.
const storedScore = record => { redis.getCache = async key => key.startsWith('test/') ? record : null }

const RICH = { avgScore: 80, scores: { imdb: 90, metacritic: 70, rtCritic: 80, rtAudience: 80 }, fetchedAt: 1 }

test('a run resolving fewer outlets leaves the record untouched and still returns tonight numbers', async () => {
  stubHosts({
    'www.wikidata.org': wikidata('m/inception', 'movie/inception'),
    'www.rottentomatoes.com': () => new Response('', { status: 403 }),
    'www.metacritic.com': () => ok(LD(52))
  })
  storedScore(RICH)

  try {
    const score = await scoreService.getScore('test/movie/degraded', {
      wikiId: 'Q25188', title: 'Inception', releaseDate: '2010-07-16', mediaType: 'movie'
    }, false)

    assert.equal(wrote('test/movie/degraded'), undefined, 'no write at all, so the record keeps its own clock')
    // The nightly check compares tonight's values; handing it the stored ones would pass while RT is down
    assert.deepEqual(Object.keys(score.scores), ['metacritic'])
    assert.equal(score.kept.avgScore, 80, 'the record it preserved, for a caller that must not publish tonight')
    assert.equal(score.cached, true, 'a refusal is not a persistence failure')
  } finally {
    redis.getCache = realGetCache
  }
})

// RT's two keys come from one page. Counted apart, this stored record would read as 3 outlets
// against tonight's 2 and be refused.
test('RT critic and audience count as one outlet', async () => {
  stubHosts({
    'www.wikidata.org': wikidata('m/inception', 'movie/inception'),
    'www.rottentomatoes.com': () => new Response('', { status: 403 }),
    'www.metacritic.com': () => ok(LD(52))
  })
  storedScore({ avgScore: 75, scores: { rtCritic: 80, rtAudience: 80 }, fetchedAt: 1 })

  try {
    await scoreService.getScore('test/movie/rtoutlet', {
      wikiId: 'Q25188', title: 'Inception', releaseDate: '2010-07-16', mediaType: 'movie'
    }, false)

    assert.ok(wrote('test/movie/rtoutlet'), 'equal outlet counts still write, refreshing the record')
  } finally {
    redis.getCache = realGetCache
  }
})

test('a richer result replaces a thinner record', async () => {
  stubHosts({
    'www.wikidata.org': wikidata('m/inception', 'movie/inception'),
    'www.rottentomatoes.com': rtScorecard(50, 85),
    'www.metacritic.com': () => ok(LD(52))
  })
  storedScore({ avgScore: 67, scores: { tmdb: 67 }, fetchedAt: 1 })

  try {
    const score = await scoreService.getScore('test/movie/richer', {
      wikiId: 'Q25188', title: 'Inception', releaseDate: '2010-07-16', mediaType: 'movie'
    }, false)

    assert.deepEqual(Object.keys(wrote('test/movie/richer').scores), ['metacritic', 'rtCritic', 'rtAudience'])
    assert.equal(score.kept, undefined)
  } finally {
    redis.getCache = realGetCache
  }
})

// Phase 4's "as of" label and the refresh cadence both read this, so it must mean when the numbers
// were taken, not when they were last attempted
test('an accepted write stamps when the numbers are from, a refused one does not', async () => {
  stubHosts({
    'www.wikidata.org': wikidata('m/inception', 'movie/inception'),
    'www.rottentomatoes.com': rtScorecard(50, 85),
    'www.metacritic.com': () => ok(LD(52))
  })

  await scoreService.getScore('test/movie/stamped', {
    wikiId: 'Q25188', title: 'Inception', releaseDate: '2010-07-16', mediaType: 'movie'
  }, false)

  assert.ok(wrote('test/movie/stamped').fetchedAt > 0)

  storedScore(RICH)

  try {
    const score = await scoreService.getScore('test/movie/unstamped', {
      wikiId: 'Q25188', title: 'Inception', releaseDate: '2010-07-16', mediaType: 'movie'
    }, false)

    assert.equal('fetchedAt' in score, false, 'a refused result carries no stamp of its own')
    assert.equal(score.kept.fetchedAt, 1, 'the stored stamp is left as it was')
  } finally {
    redis.getCache = realGetCache
  }
})


// The record read at the start can reach its TTL while the sources are being fetched. Skipping the
// write outright would leave the title with no score at all and still report one.
test('a record that expires mid-run is rebuilt rather than left absent', async () => {
  stubHosts({
    'www.wikidata.org': wikidata('m/inception', 'movie/inception'),
    'www.rottentomatoes.com': () => new Response('', { status: 403 }),
    'www.metacritic.com': () => ok(LD(52))
  })
  storedScore(RICH)
  vanished = true

  try {
    const score = await scoreService.getScore('test/movie/vanished', {
      wikiId: 'Q25188', title: 'Inception', releaseDate: '2010-07-16', mediaType: 'movie'
    }, false)

    assert.deepEqual(Object.keys(wrote('test/movie/vanished').scores), ['metacritic'],
      'a thin score beats none once the richer record is gone')
    assert.equal(score.kept, undefined)
    assert.ok(score.fetchedAt > 0, 'the rebuild is an accepted write, so it is stamped')
  } finally {
    vanished = false
    redis.getCache = realGetCache
  }
})


// A failed write stores nothing, so the result must not claim a stamp or a cached record — the job
// alerts on exactly this, and the index must never carry a row Redis does not hold
test('a failed write reports nothing stored', async () => {
  stubHosts({
    'www.wikidata.org': wikidata('m/inception', 'movie/inception'),
    'www.rottentomatoes.com': rtScorecard(50, 85),
    'www.metacritic.com': () => ok(LD(52))
  })
  writeFails = true

  try {
    const score = await scoreService.getScore('test/movie/writefail', {
      wikiId: 'Q25188', title: 'Inception', releaseDate: '2010-07-16', mediaType: 'movie'
    }, false)

    assert.equal(score.cached, false)
    assert.equal(score.kept, undefined)
    assert.equal('fetchedAt' in score, false, 'nothing was stored, so nothing is stamped')
  } finally {
    writeFails = false
  }
})

// Outlet names are looked up, and an unmapped one used to fall to undefined so every future source
// collapsed into a single entry. Two of them is what makes that visible.
test('a source with no outlet mapping counts as its own outlet', async () => {
  stubHosts({
    'www.wikidata.org': wikidata('m/inception', 'movie/inception'),
    'www.rottentomatoes.com': () => new Response('', { status: 403 }),
    'www.metacritic.com': () => ok(LD(52))
  })
  storedScore({ avgScore: 70, scores: { letterboxd: 72, mubi: 68 }, fetchedAt: 1 })

  try {
    await scoreService.getScore('test/movie/unmapped', {
      wikiId: 'Q25188', title: 'Inception', releaseDate: '2010-07-16', mediaType: 'movie'
    }, false)

    assert.equal(wrote('test/movie/unmapped'), undefined, 'three stored outlets beat tonight two')
  } finally {
    redis.getCache = realGetCache
  }
})

// `kept` is published to the ranked index, so it has to be what Redis holds now, not what the
// comparison read a moment earlier
test('a declined write reports the record that declined it', async () => {
  stubHosts({
    'www.wikidata.org': wikidata('m/inception', 'movie/inception'),
    'www.rottentomatoes.com': () => new Response('', { status: 403 }),
    'www.metacritic.com': () => ok(LD(52))
  })

  let reads = 0
  const replaced = { avgScore: 91, scores: { imdb: 95, metacritic: 88, rtCritic: 90, rtAudience: 92 } }

  redis.getCache = async key => key.startsWith('test/') ? (reads++ === 0 ? RICH : replaced) : null

  try {
    const score = await scoreService.getScore('test/movie/replaced', {
      wikiId: 'Q25188', title: 'Inception', releaseDate: '2010-07-16', mediaType: 'movie'
    }, false)

    assert.equal(score.kept.avgScore, 91, 'the value that won, not the one the comparison saw')
  } finally {
    redis.getCache = realGetCache
  }
})


// TMDB supplies the catalogue and the vote counts, not a score
test('a supplied TMDB score never reaches the aggregate', async () => {
  stubHosts({
    'www.wikidata.org': wikidata('m/inception', 'movie/inception'),
    'www.rottentomatoes.com': () => new Response('', { status: 404 }),
    'www.metacritic.com': () => ok(LD(52))
  })

  const score = await scoreService.getScore('test/movie/notmdb', {
    tmdbScore: 90, wikiId: 'Q25188', title: 'Inception', releaseDate: '2010-07-16', mediaType: 'movie'
  }, false)

  assert.deepEqual(score.scores, { metacritic: 52 })
  assert.equal(score.avgScore, 52)
})

test('a title only TMDB could have scored has no aggregate at all', async () => {
  stubHosts({})

  const score = await scoreService.getScore('test/movie/tmdbonly', {
    tmdbScore: 90, title: 'Nothing Resolves', releaseDate: '2026-01-01', mediaType: 'movie'
  }, false)

  assert.deepEqual(score.scores, {})
  assert.equal('avgScore' in JSON.parse(JSON.stringify(score)), false)
})

// Records written before TMDB was dropped hold one outlet more than anything computed now, so
// without a versioned key never-degrade would refuse every write until they expired
test('a record under the previous key does not decline today writes', async () => {
  stubHosts({
    'www.wikidata.org': wikidata('m/inception', 'movie/inception'),
    'www.rottentomatoes.com': rtScorecard(50, 85),
    'www.metacritic.com': () => ok(LD(52))
  })
  // Five outlets, as a pre-TMDB record held; only reachable under the unversioned key
  redis.getCache = async key => key === 'test/movie/legacy'
    ? { avgScore: 80, scores: { imdb: 90, metacritic: 70, rtCritic: 80, rtAudience: 80, tmdb: 67 } }
    : null

  try {
    await scoreService.getScore(scoreKey('test/movie', 'legacy'), {
      wikiId: 'Q25188', title: 'Inception', releaseDate: '2010-07-16', mediaType: 'movie'
    }, false)

    assert.ok(wrote(scoreKey('test/movie', 'legacy')), 'the versioned key has nothing to compare against')
  } finally {
    redis.getCache = realGetCache
  }
})
