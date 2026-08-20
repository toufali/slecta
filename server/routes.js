import Router from '@koa/router';
import { showSearch, getTitles } from './controllers/searchController.js'
import { getMovies, getMovieDetail, getMovieScore, showMovies, showMovieDetail, getMovieQuotes } from './controllers/movieController.js'
import { getTvShows, getTvShowDetail, showTvShows, showTvShowDetail, getTvShowScore, getTvShowQuotes } from './controllers/tvShowController.js'
import { cacheScores } from './jobs/cacheScores.js'
import { verifyScheduler } from './middleware/verifyScheduler.js'
import { showAbout } from './controllers/mainController.js'

const router = new Router();

router.get('/', showMovies);
router.get('/about', showAbout);
router.get('/search', showSearch);
router.get('/movies', showMovies);
router.get('/movies/:id', showMovieDetail);
// The job covers both media types, so `/movies/...` is a misnomer. Both are served for one
// release so the scheduler URI can move without a gap; the old one goes in Phase 2.
router.post('/cache-scores', verifyScheduler, setDefaultResponse, cacheScores);
router.post('/movies/cache-scores', verifyScheduler, setDefaultResponse, cacheScores);
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

async function setDefaultResponse(ctx, next) {
  await next();

  if (!ctx.body) ctx.status = 204; // overwrites the default 404 response
}

export default router.routes()