import { createHmac, randomBytes } from 'node:crypto'
import redis, { WRITTEN, DECLINED } from '../services/redisService.js'
import log from '../utils/logger.js'

const NAMES = ['pageview', 'trailer', 'search', 'filter']
const PAGE = /^\/[\w\-./%]{0,199}$/
const HOSTNAME = /^[a-z0-9.-]{1,253}$/
const TIME_ZONE = /^[\w+-]{1,32}(\/[\w+-]{1,32}){0,2}$/
const DEVICES = ['mobile', 'tablet', 'desktop']
const QUERY_MAX = 100
const RESULTS = /^\d{1,3}$/
const PICK = /^\/(movies|shows)\/\d+$/
const FILTERS = /^[\w.=&%+-]{1,500}$/

// Crawlers and audit tools that render pages run the script too
const CRAWLER = /bot\/|spider|headless|lighthouse|inspectiontool/i

// Families only, never the user agent itself. First match wins: an iPhone also says Mac OS X, Android
// says Linux, and Chrome-based browsers say Chrome and Safari.
const OS = [['iPadOS', /iPad/], ['iOS', /iPhone|iPod/], ['Android', /Android/], ['ChromeOS', /CrOS/], ['Windows', /Windows/], ['macOS', /Mac OS X/], ['Linux', /Linux/]]
const BROWSERS = [
  ['Facebook', /FBAN|FBAV/], ['Instagram', /Instagram/], ['Google app', /GSA\//], ['Samsung Internet', /SamsungBrowser/],
  ['Edge', /Edg/], ['Opera', /OPR\//], ['Firefox', /Firefox|FxiOS/], ['Chrome', /Chrome|CriOS/], ['Safari', /Safari/]
]

const family = (list, userAgent) => list.find(([, pattern]) => pattern.test(userAgent))?.[0] ?? 'other'

// Safari on an iPad presents as a Mac by default; the page's touch check is what tells them apart
function osOf(userAgent, device) {
  const os = family(OS, userAgent)

  return os === 'macOS' && device === 'tablet' ? 'iPadOS' : os
}

// A malformed optional field is dropped, not the event
const valid = (pattern, value) => pattern.test(value ?? '') ? value : undefined

// Shared by every instance and expired when the UTC month ends, so nobody can be followed across months
async function monthlySalt() {
  const now = new Date()
  const key = `visitors/salt/${now.toISOString().slice(0, 7)}`
  const fresh = randomBytes(16).toString('hex')
  const untilMonthEnd = Math.ceil((Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1) - now.getTime()) / 1000)
  const outcome = await redis.setCache(key, fresh, untilMonthEnd, true)

  if (outcome === WRITTEN) {
    // A second one in a month means the salt was lost and visitors were counted twice
    log.info('Visitor salt created', { key })
    return fresh
  }
  if (outcome === DECLINED) return redis.getCache(key)
}

export async function recordEvent(ctx) {
  const { name, page, device, referrer, timeZone, query, results, pick, filters, owner } = ctx.query
  const userAgent = ctx.get('user-agent')

  if (!NAMES.includes(name) || !PAGE.test(page) || !DEVICES.includes(device)) ctx.throw(400)

  ctx.status = 204

  if (CRAWLER.test(userAgent)) return

  const salt = await monthlySalt()
  const visitor = salt ? createHmac('sha256', salt).update(`${ctx.ip} ${userAgent}`).digest('hex').slice(0, 16) : undefined

  log.info('Event', {
    name,
    page,
    referrer: valid(HOSTNAME, referrer),
    device,
    os: osOf(userAgent, device),
    browser: family(BROWSERS, userAgent),
    timeZone: valid(TIME_ZONE, timeZone),
    query: typeof query === 'string' ? query.slice(0, QUERY_MAX) : undefined,
    results: valid(RESULTS, results) && Number(results),
    pick: valid(PICK, pick),
    filters: valid(FILTERS, filters),
    visitor,
    owner: owner === 'true'
  })
}
