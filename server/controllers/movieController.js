import tmdb from '../services/tmdbService.js'
import scoreService from '../services/scoreService.js'
import reviewService from '../services/reviewService.js'
import { attachScores } from './attachScores.js'
import { mainView } from '../views/mainView.js'
import { movieList } from '../views/partials/movieList.js'
import { movieDetail } from '../views/partials/movieDetail.js'

// Shared by the page and the API: both need the same rows, the same badges and the same cache-hit
// header, and differ only in how they serialise the result
async function list(ctx) {
  const data = await tmdb.getMovies(ctx.query)

  await attachScores(data.movies, 'movies')

  if (data.cacheHit) ctx.set('x-server-cache-hit', 'true')

  return data
}

export async function showMovies(ctx) {
  return ctx.body = mainView({
    partial: movieList,
    content: await list(ctx)
  })
}

export async function showMovieDetail(ctx) {
  const data = await tmdb.getMovieDetail(ctx.params.id)

  if (!data) return ctx.throw(404)

  const score = await scoreService.getScoreFromCache(`movies/${ctx.params.id}/score`)
  const quotes = await reviewService.getQuotesFromCache(ctx.params.id)

  data.score = score?.avgScore
  data.quotes = quotes

  if (data.cacheHit) ctx.set('x-server-cache-hit', 'true')

  ctx.set('Cache-Control', 'max-age=43200, stale-while-revalidate=43200')

  return ctx.body = mainView({
    partial: movieDetail,
    content: data
  })
}

// API
export async function getMovies(ctx) {
  const data = await list(ctx)

  data.allGenres = Array.from(data.allGenres.entries()) // can't send type Map via JSON :(

  ctx.set('Cache-Control', 'max-age=43200, stale-while-revalidate=43200')

  return ctx.body = data
}

export async function getMovieDetail(ctx) {
  const data = await tmdb.getMovieDetail(ctx.params.id)

  if (!data) return ctx.throw(404)

  if (data.cacheHit) ctx.set('x-server-cache-hit', 'true')

  return ctx.body = data
}

export async function getMovieScore(ctx) {
  const key = `movies/${ctx.params.id}/score`

  let data = await scoreService.getScoreFromCache(key)

  if (data) {
    ctx.set('x-server-cache-hit', 'true')
    return ctx.body = data
  }

  const movie = await tmdb.getMovieDetail(ctx.params.id)

  if (!movie) return ctx.throw(404)

  const { tmdbScore, imdbId, wikiId, title, releaseDate } = movie

  data = await scoreService.getScore(key, {
    tmdbScore,
    imdbId,
    wikiId,
    title,
    releaseDate,
    mediaType: 'movie'
  })

  return ctx.body = data
}

export async function getMovieQuotes(ctx) {
  const data = await reviewService.getQuotes(ctx.params.id, ctx.query.title, ctx.query.releaseDate)

  if (data.cacheHit) {
    ctx.set('x-server-cache-hit', 'true')
  }

  ctx.set('Cache-Control', 'max-age=43200, stale-while-revalidate=43200')
  return ctx.body = data
}