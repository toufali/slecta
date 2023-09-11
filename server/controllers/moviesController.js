import { tmdb } from '../services/tmdb.js'
import { mainView } from '../views/mainView.js'
import { moviesList } from '../views/partials/moviesList.js'
import { moviesDetail } from '../views/partials/moviesDetail.js'

export async function getMovies(ctx) {
  const movies = ctx.state.cacheData ?? await tmdb.getMovies(ctx.query)

  ctx.set('Cache-Control', 'max-age=43200, stale-while-revalidate=43200')
  return ctx.body = movies
}

export async function getMoviesDetail(ctx) {
  const movie = ctx.state.cacheData ?? await tmdb.getMoviesDetail(ctx.params.id)

  ctx.set('Cache-Control', 'max-age=43200, stale-while-revalidate=43200')
  return ctx.body = movie
}

export async function getMoviesTrailer(ctx) {
  const trailer = ctx.state.cacheData ?? await tmdb.getMoviesTrailer(ctx.params.id)

  ctx.set('Cache-Control', 'max-age=43200, stale-while-revalidate=43200')
  return ctx.body = trailer
}

export async function showMoviesList(ctx) {
  // This is to populate initial form view. Actual movie results are triggered via client API call.
  // Initial form values are first pulled from url query, else we set a default.
  const currentYear = new Date().getFullYear()

  return ctx.body = mainView({
    partial: moviesList,
    partialStyle: true, // defaults to true, included here for posterity
    partialScript: true, // defaults to true, included here for posterity
    allGenres: tmdb.genres,
    allRatings: tmdb.ratings,
    currentYear,
    withGenres: ctx.query.wg ?? '',
    withoutGenres: ctx.query.wog ?? '',
    withRatings: ctx.query.wr ?? '',
    sort: ctx.query.sort ?? 'vote_average.desc',
    reviewScore: ctx.query.score ?? 60,
    reviewCount: ctx.query.count ?? 100,
    years: ctx.query.years ?? `${currentYear - 1},${currentYear}`
  })
}

export async function showMoviesDetail(ctx) {
  let movie = ctx.state.cacheData ?? await tmdb.getMoviesDetail(ctx.params.id)

  ctx.set('Cache-Control', 'max-age=43200, stale-while-revalidate=43200')
  ctx.state.cacheData = movie // store JSON data for cache when response body is text/html

  return ctx.body = mainView({
    partial: moviesDetail,
    partialStyle: true, // defaults to true, included here for posterity
    partialScript: false,
    movie
  })
}
