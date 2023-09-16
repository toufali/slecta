import { createClient } from 'redis';
import env from "../env.js"

let client

export const redis = {
  async init() {
    if (client) return console.info('Redis client already connected.')

    client = createClient({
      url: `redis://${env.REDISHOST}:${env.REDISPORT}`
    })
    client.on('error', err => console.log('Redis Client Error', err))
    await client.connect()
    console.info('Redis client connected.')
  },

  async cache(ctx, next) {
    const key = JSON.stringify(ctx.path + ctx.search)
    let value

    try {
      value = await client.get(key)

      if (value) {
        ctx.set('x-server-cache-hit', 'true')
        ctx.state.cacheData = JSON.parse(value)
        console.log('---Cache hit!')
        return next()
      }

      console.log('---Cache miss. Awaiting new response data.')
      await next()
      console.log('---Response data received:', ctx.type)
      value = ctx.type === 'application/json' ? ctx.body : ctx.state.cacheData 

      if (!value) throw new Error('Cannot store invalid value in cache')

      await client.set(key, JSON.stringify(value), {
        // EX: 60 * 60 * 12, // sec * min * hr
        EX: 60 * 5,
        // EX: 10,
        NX: false, // NX = Only set the key if it does not already exist.
      })
      console.log('Redis set new cache data.')

    } catch (e) {
      console.error(e)
      next()
    }
  }
}
