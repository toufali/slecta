import { createClient } from 'redis'
import { setTimeout as delay } from 'node:timers/promises'
import env from '../env.js'
import log from '../utils/logger.js'

const TTL_DEFAULT = 60 * 60 * 24 // seconds

// node-redis retries a refused connection forever, so connect() never rejects — cap the wait
const CONNECT_TIMEOUT = 2000

// isReady only turns false once the socket notices a failure, so an unresponsive Redis holding
// the connection open leaves a command pending indefinitely. Real commands take single-digit ms.
const COMMAND_TIMEOUT = 2000
const TIMED_OUT = Symbol('timed out')

let client
let degraded = false

class RedisService {
  async init() {
    if (client) return log.info('Redis client was already initialised')

    // disableOfflineQueue: a command racing a dropped socket fails now, rather than replaying on reconnect
    client = createClient({ url: env.REDIS_URL, disableOfflineQueue: true })

    // Thrown, this would be an uncaught exception. Fires per retry, so log only the transition.
    client.on('error', e => {
      if (!degraded) log.error('Redis unavailable, falling back to the source', { error: e })
      degraded = true
    })

    client.on('ready', () => {
      if (degraded) log.info('Redis connection recovered')
      degraded = false
    })

    // Reconnection continues in the background; isReady lets commands through once it lands
    await Promise.race([client.connect().catch(() => {}), delay(CONNECT_TIMEOUT, null, { ref: false })])

    if (client.isReady) log.info('Redis client connected')
  }

  // Batch processes must close this or it keeps the event loop alive.
  // Never throws: it runs in the job's `finally`, where an error would mask the real exit status.
  async close() {
    try {
      // close() waits for pending commands, which never arrive from an absent or wedged connection
      if (client?.isReady) await bounded(client.close())
      else client?.destroy()
    } catch (e) {
      log.warn('Error closing the Redis connection', { error: e })
      // close() already marked the client closed, so destroy() would throw. unref instead, so a
      // socket still waiting on an unresponsive server cannot hold the process open.
      client?.unref()
    }
    client = null
    degraded = false
  }

  async getCache(key) {
    // undefined, not null: an outage is not a cache miss. Logged on transition, not per key.
    if (!client?.isReady) return

    try {
      let value = await bounded(client.get(key))
      if (!value) return null
      value = JSON.parse(value, this.#jsonReviver)
      // add non-enumerable/non-writable property `cacheHit` to all Objects including Arrays, Maps, etc
      if (value instanceof Object) Object.defineProperty(value, 'cacheHit', { value: true })
      return value
    } catch (e) {
      log.warn('Unable to read from the Redis cache', { key, error: e })
    }
  }

  async setCache(key, value, ttl = TTL_DEFAULT) {
    if (!client?.isReady) return false

    try {
      const res = await bounded(client.set(key, JSON.stringify(value, this.#jsonReplacer), {
        EX: ttl, // seconds, eg 60 * 60 * 12 -> sec * min * hr
        NX: false, // true -> only set the key if it does not already exist.
      }))
      if (res !== 'OK') throw new Error(res)
      return true
    } catch (e) {
      log.error('Unable to write to the Redis cache', { key, error: e })
      return false
    }
  }

  #jsonReplacer(key, value) {
    if (value instanceof Map) {
      return {
        dataType: 'Map',
        value: Array.from(value.entries()), // or with spread: value: [...value]
      };
    } else {
      return value;
    }
  }

  #jsonReviver(key, value) {
    if (typeof value === 'object' && value !== null) {
      if (value.dataType === 'Map') {
        return new Map(value.value);
      }
    }
    return value;
  }
}

// An in-flight command cannot be cancelled — node-redis drops its abort listener once the command
// is on the wire — so bound the wait and let the caller's catch treat it as a miss.
async function bounded(command) {
  const result = await Promise.race([command, delay(COMMAND_TIMEOUT, TIMED_OUT, { ref: false })])
  if (result === TIMED_OUT) throw new Error(`Redis did not respond within ${COMMAND_TIMEOUT}ms`)
  return result
}

export default new RedisService()
