import Router from '@koa/router';
import { showSearch, getTitles } from './controllers/searchController.js'
import { getMovies, getMovieDetail, getMovieScore, showMovies, showMovieDetail, getMovieQuotes } from './controllers/movieController.js'
import { getTvShows, getTvShowDetail, showTvShows, showTvShowDetail, getTvShowScore, getTvShowQuotes } from './controllers/tvShowController.js'
import { showAbout } from './controllers/mainController.js'

const router = new Router();

router.get('/', showMovies);
router.get('/about', showAbout);
router.get('/search', showSearch);
router.get('/movies', showMovies);
router.get('/movies/:id', showMovieDetail);
router.get('/shows', showTvShows);
router.get('/shows/:id', showTvShowDetail);

// API routes
router.get('/api/v1/search', getTitles);
router.get('/api/v1/movies', getMovies);
router.get('/api/v1/movies/:id', getMovieDetail);
router.get('/api/v1/movies/:id/score', getMovieScore);
router.get('/api/v1/movies/:id/quotes', getMovieQuotes);
router.get('/api/v1/shows', getTvShows);
router.get('/api/v1/shows/:id', getTvShowDetail);
router.get('/api/v1/shows/:id/score', getTvShowScore);
router.get('/api/v1/shows/:id/quotes', getTvShowQuotes);

export default router.routes()