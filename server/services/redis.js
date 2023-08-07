import { createClient } from 'redis';

let client

export const redis = {
  async init() {
    if (client) return console.info('Redis client already connected.')

    client = createClient()
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
        ctx.set('x-server-cache-hit', 'true');
        ctx.state.cacheData = JSON.parse(value)
        return next()
      }

      await next()

      value = ctx.type === 'application/json' ? ctx.body : ctx.state.data

      await client.set(key, JSON.stringify(value), {
        EX: 60 * 60 * 12, // sec * min * hr
        NX: true,
      });
    } catch (e) {
      console.error(e);
      ctx.status = 404
      ctx.body = { msg: `Error with Redis service: ${e}` };
    }
  }
}
