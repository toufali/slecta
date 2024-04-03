import Router from '@koa/router';
import { getMovies, getMovieDetail, getMovieScore, showMovies, showMovieDetail } from './controllers/movieController.js'
import { cacheMovieScores } from './jobs/cacheScores.js'

const router = new Router();

router.get('/', showMovies);
router.get('/movies', showMovies);
router.get('/movies/:id', showMovieDetail);
router.post('/movies/cache-scores', setDefaultResponse, cacheMovieScores);

// API routes
router.get('/api/v1/movies', getMovies);
router.get('/api/v1/movies/:id', getMovieDetail);
router.get('/api/v1/movies/:id/score', getMovieScore);

async function setDefaultResponse(ctx, next) {
  await next();

  if (!ctx.body) ctx.status = 204; // overwrites the default 404 response
}

export default router.routes()