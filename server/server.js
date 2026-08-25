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
server.on('error', (error, ctx) => {
  // Koa assigns the response status after this event, so derive it from the error as Koa does
  const status = error.status ?? 500

  // A rejected request is already in Cloud Run's request log; this is for faults we caused
  if (status < 500) return

  log.error('Request failed', { method: ctx?.method, url: ctx?.url, status, error })
})

server.listen(PORT, function () {
  console.info('Static files dir:', staticUrl.pathname)
  console.info('Server listening at port:', this.address().port)
});