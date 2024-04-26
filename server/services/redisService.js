import { createClient } from 'redis';
import env from "../env.js"

const TTL_DEFAULT = 60 * 60 * 24 // seconds
let client

class RedisService {
  init = async () => {
    if (client) return console.info('Redis client was already connected.')

    try {
      client = createClient({
        url: env.REDIS_URL
      })
      client.on('error', e => { throw new Error(e) })
      await client.connect()
      console.info('Redis client connected.')
    } catch (e) {
      client = null
      console.error('Unable to initialize Redis:', e)
    }
  }

  async getCache(key) {
    try {
      let value = await client?.get(key)
      if (!value) return null
      value = JSON.parse(value, this.#jsonReviver)
      // add non-enumerable/non-writable property `cacheHit` to all Objects including Arrays, Maps, etc
      if (typeof value === 'object') Object.defineProperty(value, 'cacheHit', { value: true })
      return value
    } catch (e) {
      console.warn('Error getting cache value:', e)
    }
  }

  async setCache(key, value, ttl = TTL_DEFAULT) {
    try {
      const res = await client?.set(key, JSON.stringify(value, this.#jsonReplacer), {
        EX: ttl, // seconds, eg 60 * 60 * 12 -> sec * min * hr
        NX: false, // true -> only set the key if it does not already exist.
      })
      if (res !== 'OK') throw new Error(res)
      return true
    } catch (e) {
      console.error('Unable to set Redis cache:', e)
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

export default new RedisService()