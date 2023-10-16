import { tmdb } from '../services/tmdb.js'
import { mainView } from '../views/mainView.js'
import { movieList } from '../views/partials/movieList.js'
import { movieDetail } from '../views/partials/movieDetail.js'
import { reviewService } from '../services/reviewService.js'

export async function showMovieList(ctx) {
  // This is to populate initial form view. Actual movie results are triggered via client API call.
  // Initial form values are first pulled from url query, else we set a default.
  const currentYear = new Date().getFullYear()

  return ctx.body = mainView({
    partial: movieList,
    allGenres: tmdb.defaults.genres,
    allRatings: tmdb.defaults.ratings,
    currentYear,
    withGenres: ctx.query.wg ?? '',
    withoutGenres: ctx.query.wog ?? '',
    withRatings: ctx.query.wr ?? '',
    sort: ctx.query.sort ?? 'vote_average.desc',
    tmdbScore: ctx.query.score ?? 60,
    reviewCount: ctx.query.count ?? 100,
    streaming: ctx.query.streaming,
    years: ctx.query.years ?? `${currentYear - 1},${currentYear}`
  })
}

export async function showMovieDetail(ctx) {
  if (ctx.state.cacheData) {
    var movie = ctx.state.cacheData
    movie.avgScore = movie.avgScore ?? await reviewService.getAvgScore(ctx.params.id)
  } else {
    var [movie, avgScore] = await Promise.all([tmdb.getMovieDetail(ctx.params.id), reviewService.getAvgScore(ctx.params.id)])
    movie.avgScore = avgScore
  }

  if (!movie.avgScore) {
    // console.log('DB data not available for avgScore. Set event-stream')
    // ctx.set({
    //   "Content-Type": "text/event-stream",
    //   "Cache-Control": "no-cache",
    //   "Connection": "keep-alive",
    // });

    // console.log('about to write some data')

    // ctx.res.write(`data: CONNECTION ESTABLISHED)}\n\n`);

    // setTimeout(() => ctx.res.write(`data: INTERVAL CALLED)}\n\n`), 3000)

    console.log('Scores not ready. Populate in background.')
    const scores = reviewService.populateScores(movie) // run async function without blocking response
    // add server event here
  }

  ctx.set('Cache-Control', 'max-age=43200, stale-while-revalidate=43200')
  ctx.state.cacheData = movie // store JSON data for cache when response body is text/html

  return ctx.body = mainView({
    partial: movieDetail,
    movie
  })
}

// API
export async function getMovies(ctx) {
  const movies = ctx.state.cacheData ?? await tmdb.getMovies(ctx.query)

  ctx.set('Cache-Control', 'max-age=43200, stale-while-revalidate=43200')
  return ctx.body = movies
}

export async function getMovieDetail(ctx) {
  const movie = ctx.state.cacheData ?? await tmdb.getMovieDetail(ctx.params.id)

  ctx.set('Cache-Control', 'max-age=43200, stale-while-revalidate=43200')
  return ctx.body = movie
}

export async function getMovieTrailer(ctx) {
  const trailer = ctx.state.cacheData ?? await tmdb.getMovieTrailer(ctx.params.id)

  ctx.set('Cache-Control', 'max-age=43200, stale-while-revalidate=43200')
  return ctx.body = trailer
}