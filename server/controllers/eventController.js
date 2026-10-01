import { createHmac, randomBytes } from 'node:crypto'
import redis, { WRITTEN, DECLINED } from '../services/redisService.js'
import log from '../utils/logger.js'

const NAMES = ['pageview']
const PAGE = /^\/[\w\-./%]{0,199}$/
const HOSTNAME = /^[a-z0-9.-]{1,253}$/
const TIME_ZONE = /^[\w+-]{1,32}(\/[\w+-]{1,32}){0,2}$/
const DEVICES = ['mobile', 'tablet', 'desktop']

// Crawlers and audit tools that render pages run the script too
const CRAWLER = /bot\/|spider|headless|lighthouse|inspectiontool/i

// Shared by every instance and expired when the UTC month ends, so nobody can be followed across months
async function monthlySalt(now = new Date()) {
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
  const { name, page, device, referrer, timeZone, owner } = ctx.query
  const userAgent = ctx.get('user-agent')

  if (!NAMES.includes(name) || !PAGE.test(page) || !DEVICES.includes(device)) ctx.throw(400)

  ctx.status = 204

  if (CRAWLER.test(userAgent)) return

  const salt = await monthlySalt()
  const visitor = salt ? createHmac('sha256', salt).update(`${ctx.ip} ${userAgent}`).digest('hex').slice(0, 16) : undefined

  log.info('Event', {
    name,
    page,
    referrer: HOSTNAME.test(referrer ?? '') ? referrer : undefined,
    device,
    timeZone: TIME_ZONE.test(timeZone ?? '') ? timeZone : undefined,
    visitor,
    owner: owner === 'true'
  })
}
