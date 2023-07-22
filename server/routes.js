import Router from '@koa/router';
import { getMovies, getMoviesDetail, showMoviesList, showMoviesDetail } from './controllers/moviesController.js'

const router = new Router();

router.get('/movies', showMoviesList);
router.get('/movies/:id', showMoviesDetail);

// API routes
router.get('/api/v1/movies', getMovies);
router.get('/api/v1/movies/:id', getMoviesDetail);

export default router.routes()