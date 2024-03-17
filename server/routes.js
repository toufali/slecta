import Router from '@koa/router';
import { getMovies, getMovieDetail, getMovieScore, showMovies, showMovieDetail } from './controllers/movieController.js'

const router = new Router();

router.get('/', showMovies);
router.get('/movies', showMovies);
router.get('/movies/:id', showMovieDetail);

// API routes
router.get('/api/v1/movies', getMovies);
router.get('/api/v1/movies/:id', getMovieDetail);
router.get('/api/v1/movies/:id/score', getMovieScore);

export default router.routes()