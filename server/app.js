import env from "./env.js"
import Koa from 'koa'
import serve from "koa-static"
import routes from './routes.js'

const app = new Koa();
const { PORT, STATIC_DIR } = env

app.use(routes)

// STATIC_DIR set to 'dist' if `npm start` was run, which also triggers build/bundle via ESBuild
// STATIC_DIR set to 'src' otherwise for dev – files are served directly without build/bundle
app.use(serve(`../client/${STATIC_DIR}`));

app.listen(PORT, function () {
  console.info(`Server listening at port ${this.address().port}`)
  console.info(`Static files are served from "${STATIC_DIR}" directory`)
});