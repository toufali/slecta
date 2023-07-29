import { tmdbService } from '../services/tmdbService.js'
import { mainView } from '../views/mainView.js'
import { moviesList } from '../views/partials/moviesList.js'
import { moviesDetail } from '../views/partials/moviesDetail.js'

export async function getMovies(ctx) {
  // TODO: this logic is split between controller and service - probably not good practice?
  const movies = await tmdbService.getMovies({
    genres: ctx.query.genres ?? '',
    sort: ctx.query.sort ?? 'vote_average.desc',
    reviewScore: ctx.query.score ?? '',
    reviewCount: ctx.query.count ?? '',
    years: ctx.query.years ?? '',
  })

  return ctx.url.includes('/api/') ? ctx.body = movies : movies
}

export async function getMoviesDetail(ctx) {
  const movie = await tmdbService.getMoviesDetail(ctx.params.id)

  return ctx.url.includes('/api/') ? ctx.body = movie : movie
}

export async function getMoviesTrailer(ctx) {
  const trailer = await tmdbService.getMoviesTrailer(ctx.params.id)

  return ctx.url.includes('/api/') ? ctx.body = trailer : trailer
}

export async function showMoviesList(ctx) {
  // This is to populate initial form view. Actual movie results are triggered via client API call.
  // Initial form values are first pulled from url query, else we set a default.
  const currentYear = new Date().getFullYear()

  return ctx.body = mainView({
    partial: moviesList,
    partialStyle: true, // defaults to true, included here for posterity
    partialScript: true, // defaults to true, included here for posterity
    allGenres: tmdbService.genres,
    currentYear,
    genres: ctx.query.genres ?? '',
    sort: ctx.query.sort ?? 'vote_average.desc',
    reviewScore: ctx.query.score ?? 60,
    reviewCount: ctx.query.count ?? 50,
    years: ctx.query.years ?? `${currentYear - 1},${currentYear}`
  })
}

export async function showMoviesDetail(ctx) {
  const movie = await getMoviesDetail(ctx)

  return ctx.body = mainView({
    partial: moviesDetail,
    partialStyle: true, // defaults to true, included here for posterity
    partialScript: false, // defaults to true, included here for posterity
    movie
  })
}
