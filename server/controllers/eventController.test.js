import { test, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'

for (const key of ['TMDB_TOKEN', 'TMDB_API_URL', 'GCP_API_URL', 'GCP_API_KEY', 'GCP_SEARCH_ENGINE']) {
  process.env[key] ??= 'test'
}

const { recordEvent } = await import('./eventController.js')
const { default: redis, WRITTEN, DECLINED, FAILED } = await import('../services/redisService.js')
const { default: log } = await import('../utils/logger.js')

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const VIEW = { name: 'pageview', page: '/movies/550', referrer: 'news.ycombinator.com', device: 'mobile', timeZone: 'America/Los_Angeles' }
let logged, ttls

beforeEach(() => {
  const store = new Map()
  logged = []
  ttls = []
  mock.method(redis, 'setCache', async (key, value, ttl, ifAbsent) => {
    if (ifAbsent && store.has(key)) return DECLINED
    store.set(key, value)
    ttls.push(ttl)
    return WRITTEN
  })
  mock.method(redis, 'getCache', async key => store.get(key) ?? null)
  mock.method(log, 'info', (message, fields) => logged.push(JSON.parse(JSON.stringify({ message, ...fields }))))
})

afterEach(() => mock.reset())

async function record(query, { ip = '203.0.113.7', userAgent = IPHONE } = {}) {
  const ctx = {
    query, ip,
    get: name => name === 'user-agent' ? userAgent : '',
    throw(status) { throw Object.assign(new Error(), { status }) }
  }
  await recordEvent(ctx)
  assert.equal(ctx.status, 204)
  return logged.filter(entry => entry.message === 'Event')
}

const visitor = async (query, options) => (await record(query, options)).at(-1).visitor

test('a page view logs its name, page, referrer, device, OS, browser, time zone, visitor and owner marker, and neither the address nor the user agent', async () => {
  const [view] = await record(VIEW)

  assert.deepEqual(Object.keys(view), ['message', 'name', 'page', 'referrer', 'device', 'os', 'browser', 'timeZone', 'visitor', 'owner'])
  assert.match(view.visitor, /^[0-9a-f]{16}$/)
  assert.doesNotMatch(JSON.stringify(logged), /203\.0\.113\.7|iPhone/)
})

test('the same address and browser are one visitor within a UTC month and a new one the next, and each new salt is logged', async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-29T23:00:00Z') })
  const first = await visitor(VIEW)

  assert.equal(await visitor({ ...VIEW, page: '/about' }), first)
  assert.notEqual(await visitor(VIEW, { ip: '203.0.113.8' }), first)
  assert.notEqual(await visitor(VIEW, { userAgent: 'Mozilla/5.0 (Macintosh)' }), first)
  mock.timers.tick(3600 * 1000)
  assert.equal(await visitor(VIEW), first)
  assert.deepEqual(ttls, [25 * 3600])

  mock.timers.tick(24 * 3600 * 1000)
  assert.notEqual(await visitor(VIEW), first)
  assert.deepEqual(logged.filter(e => e.message === 'Visitor salt created').map(e => e.key), ['visitors/salt/2026-11', 'visitors/salt/2026-12'])
})

test('a page view still counts, without a visitor, while Redis is down', async () => {
  redis.setCache.mock.mockImplementation(async () => FAILED)
  const views = await record(VIEW)

  assert.equal(views.length, 1)
  assert.equal('visitor' in views[0], false)
})

for (const [label, userAgent, counted = false] of [
  ['Googlebot', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
  ['Search Console', 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36 (compatible; Google-InspectionTool/1.0;)'],
  ['Lighthouse', 'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse'],
  ['headless Chrome', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/140.0.0.0 Safari/537.36'],
  ['a phone whose model name ends in "bot"', 'Mozilla/5.0 (Linux; Android 10; CUBOT X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36', true]
]) {
  test(`${label} is ${counted ? '' : 'not '}counted`, async () => {
    assert.equal((await record(VIEW, { userAgent })).length, Number(counted))
  })
}

const FILTERS = 'sort=primary_release_date.desc&months=6&wg=28&wg=878&wr=PG-13&wp=8'

for (const [label, query, expected] of [
  ['a page view needs no referrer', { name: 'pageview', page: '/', device: 'desktop' }, { page: '/' }],
  ["the owner's browser is marked", { ...VIEW, owner: 'true' }, { owner: true }],
  ['a trailer play is logged under its name', { ...VIEW, name: 'trailer' }, { name: 'trailer' }],
  ['a search logs the query, the result count and the pick', { ...VIEW, name: 'search', query: 'fight club', results: '12', pick: '/movies/550' }, { query: 'fight club', results: 12, pick: '/movies/550' }],
  ['a search with no results logs a count of 0', { ...VIEW, name: 'search', query: 'zzqq', results: '0' }, { results: 0 }],
  ['a search query is capped at 100 characters', { ...VIEW, name: 'search', query: 'a'.repeat(150) }, { query: 'a'.repeat(100) }],
  ['a filter logs the panel form as it was submitted', { ...VIEW, name: 'filter', filters: FILTERS }, { filters: FILTERS }]
]) {
  test(label, async () => {
    assert.partialDeepStrictEqual((await record(query))[0], expected)
  })
}

for (const [os, browser, userAgent, device = 'mobile'] of [
  ['iOS', 'Safari', IPHONE],
  ['iOS', 'Chrome', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.7339.101 Mobile/15E148 Safari/604.1'],
  ['iOS', 'Google app', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/380.0.0 Mobile/15E148 Safari/604.1'],
  ['iOS', 'Facebook', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/500.0.0.0]'],
  ['iPadOS', 'Safari', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15', 'tablet'],
  ['Android', 'Chrome', 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'],
  ['Android', 'Samsung Internet', 'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36'],
  ['macOS', 'Safari', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15', 'desktop'],
  ['macOS', 'Chrome', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36', 'desktop'],
  ['Windows', 'Edge', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0', 'desktop'],
  ['Windows', 'Firefox', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0', 'desktop'],
  ['iOS', 'Instagram', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 400.0.0.0 (iPhone15,2; iOS 18_6)'],
  ['iOS', 'Opera', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) OPiOS/16.0.15 Mobile/15E148 Safari/9537.53'],
  ['Windows', 'Opera', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 OPR/124.0.0.0', 'desktop'],
  ['ChromeOS', 'Chrome', 'Mozilla/5.0 (X11; CrOS x86_64 16328.65.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36', 'desktop'],
  ['Linux', 'Firefox', 'Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0', 'desktop'],
  ['other', 'other', 'curl/8.7.1', 'desktop']
]) {
  test(`${browser} on ${os} is recorded as such`, async () => {
    assert.partialDeepStrictEqual((await record({ ...VIEW, device }, { userAgent }))[0], { os, browser })
  })
}

for (const [field, value] of [
  ['referrer', ''], ['referrer', 'https://example.com/'], ['referrer', 'Example.com'], ['referrer', '[2001:db8::1]'], ['referrer', ['a.com', 'b.com']],
  ['timeZone', ''], ['timeZone', 'America/Los Angeles'], ['timeZone', '../../etc'], ['timeZone', 'a/b/c/d'], ['timeZone', ['UTC', 'UTC']],
  ['query', ['a', 'b']], ['results', '1000'], ['results', '-1'], ['pick', '/about'], ['pick', '/movies/550/score'],
  ['filters', 'wg=28,878'], ['filters', 'a'.repeat(501)], ['filters', '<script>']
]) {
  test(`a ${field} of ${JSON.stringify(value).slice(0, 30)} is dropped and the event still counts`, async () => {
    const views = await record({ ...VIEW, name: 'search', [field]: value })

    assert.equal(views.length, 1)
    assert.equal(views[0][field], undefined)
  })
}

for (const [field, value, label = JSON.stringify(value)] of [
  ['name', undefined], ['name', 'click'], ['page', undefined], ['page', 'movies'], ['page', '/a b'], ['page', `/${'a'.repeat(200)}`, '201 characters'],
  ['page', ['/', '/about']], ['device', undefined], ['device', 'watch']
]) {
  test(`a ${field} of ${label} is rejected`, async () => {
    await assert.rejects(record({ ...VIEW, [field]: value }), { status: 400 })
    assert.equal(logged.length, 0)
  })
}
