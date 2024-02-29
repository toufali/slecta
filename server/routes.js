import Router from '@koa/router';
// import { redis } from './services/redis.js'
import { getMovies, getMovieDetail, getMovieScore, showMovieList, showMovieDetail } from './controllers/movieController.js'

const router = new Router();

router.get('/', showMovieList);
router.get('/movies', showMovieList);
router.get('/movies/:id', showMovieDetail);

// API routes
// router.get('/api/v1/movies', redis.cache, getMovies);
// router.get('/api/v1/movies/:id', redis.cache, getMovieDetail);
router.get('/api/v1/movies/:id/score', getMovieScore);

export default router.routes()