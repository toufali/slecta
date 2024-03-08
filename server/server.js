import Koa from 'koa'
import serve from "koa-static"

import env from "./env.js"
import routes from './routes.js'
// import { redis } from './services/redis.js'
import tmdb from './services/tmdbService.js'
import scoreService from './services/scoreService.js'

const server = new Koa();
const { PORT, STATIC_DIR } = env

// await redis.init()
await tmdb.init()
await scoreService.init()

// STATIC_DIR set to 'src' if `npm run dev` called. Files are served direct from source without build/bundle
// Otherwise, STATIC_DIR defaults to 'dist' – client build required to serve files from bundle
const staticUrl = new URL(`../client/${STATIC_DIR}`, import.meta.url);
server.use(serve(staticUrl.pathname));
server.use(routes)

server.listen(PORT, function () {
  console.info(`Server listening at port ${this.address().port}`)
  console.info(`Static files are served from "${STATIC_DIR}" directory`)
});