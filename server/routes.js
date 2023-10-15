import Router from '@koa/router';
// import { upsertReview } from './services/reviews.js'
import { redis } from './services/redis.js'
import { getMovies, getMoviesDetail, getMoviesTrailer, showMoviesList, showMoviesDetail } from './controllers/moviesController.js'

const router = new Router();

router.get('/', showMoviesList);
router.get('/movies', showMoviesList);
router.get('/movies/:id', redis.cache, showMoviesDetail);
// router.get('/movies/:id', redis.cache, upsertReview, showMoviesDetail);

// API routes
router.get('/api/v1/movies', redis.cache, getMovies);
router.get('/api/v1/movies/:id', redis.cache, getMoviesDetail);
router.get('/api/v1/movies/:id/trailer', redis.cache, getMoviesTrailer);

export default router.routes()