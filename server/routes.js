import Router from '@koa/router';
// import { upsertReview } from './services/reviews.js'
import { redis } from './services/redis.js'
import { getMovies, getMovieDetail, getMovieTrailer, getMovieScore, showMovieList, showMovieDetail } from './controllers/movieController.js'

const router = new Router();

router.get('/', showMovieList);
router.get('/movies', showMovieList);
router.get('/movies/:id', redis.cache, showMovieDetail);
// router.get('/movies/:id', redis.cache, upsertReview, showMoviesDetail);

// API routes
router.get('/api/v1/movies', redis.cache, getMovies);
router.get('/api/v1/movies/:id', redis.cache, getMovieDetail);
router.get('/api/v1/movies/:id/score', redis.cache, getMovieScore);
router.get('/api/v1/movies/:id/trailer', redis.cache, getMovieTrailer);

export default router.routes()