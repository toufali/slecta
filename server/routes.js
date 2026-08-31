import Router from '@koa/router';
import tmdb from './services/tmdbService.js'
import { invalidFilters } from './utils/filters.js'
import { showSearch, getTitles } from './controllers/searchController.js'
import { showList, showDetail, getList, getDetail, getScore, getQuotes } from './controllers/titleController.js'
import { showAbout } from './controllers/mainController.js'

const router = new Router();

// Coerce to one canonical id, so `0550` and `550` share a cache key and one TMDB call, and
// `..%2F` can't rewrite the upstream path. Digits only: `Number()` also takes `1e2` and `0x10`.
router.param('id', (value, ctx, next) => {
  const id = Number(value)
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(id) || id < 1) ctx.throw(400)
  ctx.params.id = id
  return next()
})

// Turn a filter the route cannot honour into a 400 that names it, instead of a downstream 500.
function validateFilters(mediaType) {
  return (ctx, next) => {
    const invalid = invalidFilters(ctx.query, tmdb.filterRules(mediaType))

    if (invalid.length) ctx.throw(400, `Unsupported filter value: ${invalid.join(', ')}`)

    return next()
  }
}

router.get('/', validateFilters('movie'), showList('movie'));
router.get('/about', showAbout);
router.get('/search', showSearch);
router.get('/movies', validateFilters('movie'), showList('movie'));
router.get('/movies/:id', showDetail('movie'));
router.get('/shows', validateFilters('tv'), showList('tv'));
router.get('/shows/:id', showDetail('tv'));

// API routes
router.get('/api/v1/search', getTitles);
router.get('/api/v1/movies', validateFilters('movie'), getList('movie'));
router.get('/api/v1/movies/:id', getDetail('movie'));
router.get('/api/v1/movies/:id/score', getScore('movie'));
router.get('/api/v1/movies/:id/quotes', getQuotes('movie'));
router.get('/api/v1/shows', validateFilters('tv'), getList('tv'));
router.get('/api/v1/shows/:id', getDetail('tv'));
router.get('/api/v1/shows/:id/score', getScore('tv'));
router.get('/api/v1/shows/:id/quotes', getQuotes('tv'));

export default router.routes()
