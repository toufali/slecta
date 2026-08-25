import Router from '@koa/router';
import tmdb from './services/tmdbService.js'
import { invalidFilters, isCount } from './utils/filters.js'
import { showSearch, getTitles } from './controllers/searchController.js'
import { getMovies, getMovieDetail, getMovieScore, showMovies, showMovieDetail, getMovieQuotes } from './controllers/movieController.js'
import { getTvShows, getTvShowDetail, showTvShows, showTvShowDetail, getTvShowScore, getTvShowQuotes } from './controllers/tvShowController.js'
import { showAbout } from './controllers/mainController.js'

const router = new Router();

// Coerce to one canonical id, so `0550` and `550` share a cache key and one TMDB call, and
// `..%2F` can't rewrite the upstream path.
router.param('id', (value, ctx, next) => {
  const id = Number(value)
  if (!isCount(value) || !Number.isSafeInteger(id) || id < 1) ctx.throw(400)
  ctx.params.id = id
  return next()
})

// Turn a filter the route cannot honour into a 400 that names it, instead of a downstream 500.
function validateFilters(mediaType) {
  return (ctx, next) => {
    const invalid = invalidFilters(ctx.query, tmdb.filterRules(mediaType))

    if (invalid.length) ctx.throw(400, `Unsupported filter value: ${invalid.join(', ')}`)

    // Canonical for the same reason as `id`: `?page=01` would otherwise mint its own cache key
    for (const name of ['page', 'count']) if (ctx.query[name]) ctx.query[name] = String(+ctx.query[name])

    return next()
  }
}

router.get('/', validateFilters('movie'), showMovies);
router.get('/about', showAbout);
router.get('/search', showSearch);
router.get('/movies', validateFilters('movie'), showMovies);
router.get('/movies/:id', showMovieDetail);
router.get('/shows', validateFilters('tv'), showTvShows);
router.get('/shows/:id', showTvShowDetail);

// API routes
router.get('/api/v1/search', getTitles);
router.get('/api/v1/movies', validateFilters('movie'), getMovies);
router.get('/api/v1/movies/:id', getMovieDetail);
router.get('/api/v1/movies/:id/score', getMovieScore);
router.get('/api/v1/movies/:id/quotes', getMovieQuotes);
router.get('/api/v1/shows', validateFilters('tv'), getTvShows);
router.get('/api/v1/shows/:id', getTvShowDetail);
router.get('/api/v1/shows/:id/score', getTvShowScore);
router.get('/api/v1/shows/:id/quotes', getTvShowQuotes);

export default router.routes()
