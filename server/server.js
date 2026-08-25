import Koa from 'koa'
import serve from "koa-static"

import env from "./env.js"
import routes from './routes.js'
import redis from './services/redisService.js'
import tmdb from './services/tmdbService.js'
import log from './utils/logger.js'

const server = new Koa();
const { PORT, STATIC_DIR } = env

await redis.init()
await tmdb.init()

// STATIC_DIR set to 'src' if `npm run dev` called. Files are served direct from source without build/bundle
// Otherwise, STATIC_DIR defaults to 'dist' – client build required to serve files from bundle
const staticUrl = new URL(`../client/${STATIC_DIR}`, import.meta.url);
server.use(serve(staticUrl.pathname));
server.use(routes)

// Koa's default handler writes a bare stack to stderr, which Cloud Logging stores without fields
server.on('error', (error, ctx) => log.error('Request failed', { method: ctx?.method, url: ctx?.url, status: ctx?.status, error }))

server.listen(PORT, function () {
  console.info('Static files dir:', staticUrl.pathname)
  console.info('Server listening at port:', this.address().port)
});