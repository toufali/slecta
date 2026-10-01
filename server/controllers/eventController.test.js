import { test, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'

for (const key of ['TMDB_TOKEN', 'TMDB_API_URL', 'GCP_API_URL', 'GCP_API_KEY', 'GCP_SEARCH_ENGINE']) {
  process.env[key] ??= 'test'
}

const { recordEvent } = await import('./eventController.js')
const { default: redis, WRITTEN, DECLINED, FAILED } = await import('../services/redisService.js')
const { default: log } = await import('../utils/logger.js')

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const VIEW = { name: 'pageview', page: '/movies/550', referrer: 'news.ycombinator.com', device: 'mobile', timeZone: 'America/Los_Angeles' }
const originals = { setCache: redis.setCache, getCache: redis.getCache, info: log.info }

afterEach(() => {
  Object.assign(redis, { setCache: originals.setCache, getCache: originals.getCache })
  log.info = originals.info
  mock.timers.reset()
})

const context = (query, { ip = '203.0.113.7', userAgent = IPHONE } = {}) => ({
  query, ip,
  get: name => name === 'user-agent' ? userAgent : '',
  throw(status) { throw Object.assign(new Error(), { status }) }
})

function stubRedis() {
  const ttls = []
  const store = new Map()

  redis.setCache = async (key, value, ttl, ifAbsent) => {
    if (ifAbsent && store.has(key)) return DECLINED
    store.set(key, value)
    ttls.push(ttl)
    return WRITTEN
  }
  redis.getCache = async key => store.get(key) ?? null

  return ttls
}

function recordViews() {
  const views = []
  log.info = (message, fields) => message === 'Event' && views.push(JSON.parse(JSON.stringify({ message, ...fields })))
  return views
}

async function visitor(query, options) {
  const views = recordViews()
  await recordEvent(context(query, options))
  return views[0].visitor
}

test('a page view logs its name, page, referrer, device, time zone, visitor and owner marker, and neither the address nor the browser', async () => {
  stubRedis()
  const views = recordViews()
  const ctx = context(VIEW)

  await recordEvent(ctx)

  assert.equal(ctx.status, 204)
  assert.deepEqual(Object.keys(views[0]), ['message', 'name', 'page', 'referrer', 'device', 'timeZone', 'visitor', 'owner'])
  assert.match(views[0].visitor, /^[0-9a-f]{16}$/)
  assert.doesNotMatch(JSON.stringify(views), /203\.0\.113\.7|iPhone/)
})

test('the same address and browser are one visitor within a UTC month and a new one the next', async () => {
  const ttls = stubRedis()
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-29T23:00:00Z') })

  const first = await visitor(VIEW)

  assert.equal(await visitor({ ...VIEW, page: '/about' }), first)
  assert.notEqual(await visitor(VIEW, { ip: '203.0.113.8' }), first)
  assert.notEqual(await visitor(VIEW, { userAgent: 'Mozilla/5.0 (Macintosh)' }), first)
  assert.deepEqual(ttls, [25 * 3600])

  mock.timers.tick(3600 * 1000)
  assert.equal(await visitor(VIEW), first)

  mock.timers.tick(24 * 3600 * 1000)
  assert.notEqual(await visitor(VIEW), first)
})

test('a new salt is logged once, when it is created', async () => {
  stubRedis()
  const created = []
  log.info = (message, fields) => message === 'Visitor salt created' && created.push(fields.key)
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-29T23:00:00Z') })

  await recordEvent(context(VIEW))
  await recordEvent(context(VIEW))

  assert.deepEqual(created, ['visitors/salt/2026-11'])
})

test('a page view still counts, without a visitor, while Redis is down', async () => {
  redis.setCache = async () => FAILED
  const views = recordViews()

  await recordEvent(context(VIEW))

  assert.equal(views.length, 1)
  assert.equal('visitor' in views[0], false)
})

test("a page view from the owner's browser is marked", async () => {
  stubRedis()
  const views = recordViews()

  await recordEvent(context({ ...VIEW, owner: 'true' }))

  assert.equal(views[0].owner, true)
})

test('a page view needs no referrer', async () => {
  stubRedis()
  const views = recordViews()

  await recordEvent(context({ name: 'pageview', page: '/', device: 'desktop' }))

  assert.equal(views[0].page, '/')
})

test('a declared crawler is not counted', async () => {
  stubRedis()
  const views = recordViews()
  const ctx = context(VIEW, { userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' })

  await recordEvent(ctx)

  assert.equal(ctx.status, 204)
  assert.equal(views.length, 0)
})

test('a phone whose model name ends in "bot" is counted', async () => {
  stubRedis()
  const views = recordViews()

  await recordEvent(context(VIEW, { userAgent: 'Mozilla/5.0 (Linux; Android 10; CUBOT X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36' }))

  assert.equal(views.length, 1)
})

for (const referrer of ['', 'https://example.com/', 'Example.com', '[2001:db8::1]', ['a.com', 'b.com']]) {
  test(`a referrer of ${JSON.stringify(referrer)} is dropped and the view still counts`, async () => {
    stubRedis()
    const views = recordViews()

    await recordEvent(context({ ...VIEW, referrer }))

    assert.equal(views.length, 1)
    assert.equal(views[0].referrer, undefined)
  })
}

for (const timeZone of ['', 'America/Los Angeles', '../../etc', 'a/b/c/d', ['UTC', 'UTC']]) {
  test(`a time zone of ${JSON.stringify(timeZone)} is dropped and the view still counts`, async () => {
    stubRedis()
    const views = recordViews()

    await recordEvent(context({ ...VIEW, timeZone }))

    assert.equal(views.length, 1)
    assert.equal(views[0].timeZone, undefined)
  })
}

for (const [field, value, label = JSON.stringify(value)] of [
  ['name', undefined], ['name', 'click'], ['page', undefined], ['page', 'movies'], ['page', '/a b'], ['page', `/${'a'.repeat(200)}`, '201 characters'],
  ['page', ['/', '/about']], ['device', undefined], ['device', 'watch']
]) {
  test(`a ${field} of ${label} is rejected`, async () => {
    stubRedis()
    const views = recordViews()

    await assert.rejects(recordEvent(context({ ...VIEW, [field]: value })), { status: 400 })
    assert.equal(views.length, 0)
  })
}
