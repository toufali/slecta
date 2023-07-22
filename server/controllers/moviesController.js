import { tmdbService } from '../services/tmdbService.js'
import { mainView } from '../views/mainView.js'
import { moviesList } from '../views/partials/moviesList.js'
import { moviesDetail } from '../views/partials/moviesDetail.js'

export async function getMovies(ctx) {
  const selectedGenres = ctx.query.genres ?? ''
  const selectedSort = ctx.query.sort ?? 'popularity.desc'
  const selectedScore = ctx.query.score ?? 60
  const movies = await tmdbService.getMovies(selectedGenres, selectedSort, selectedScore)

  return ctx.url.includes('/api/') ? ctx.body = movies : movies
}

export async function getMoviesDetail(ctx) {
  const movie = await tmdbService.getMoviesDetail(ctx.params.id)

  return ctx.url.includes('/api/') ? ctx.body = movie : movie
}

export async function showMoviesList(ctx) {
  // I think this is unused.  TODO: SSR initial movies list
  const genres = await tmdbService.getGenres()
  const selectedGenres = ctx.query.genres ?? '' // string for single genre or array for multiple
  const selectedSort = ctx.query.sort ?? 'popularity.desc'
  const selectedScore = ctx.query.score ?? 60

  return ctx.body = mainView({
    partial: moviesList,
    partialStyle: true, // defaults to true, included here for posterity
    partialScript: true, // defaults to true, included here for posterity
    genres,
    selectedGenres,
    selectedSort,
    selectedScore
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

