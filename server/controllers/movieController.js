import tmdb from '../services/tmdbService.js'
import scoreService from '../services/scoreService.js'
import redis from '../services/redisService.js'
import { mainView } from '../views/mainView.js'
import { movieList } from '../views/partials/movieList.js'
import { movieDetail } from '../views/partials/movieDetail.js'

export async function showMovies(ctx) {
  const data = await tmdb.getMovies(ctx.query)

  if (data.cacheHit) ctx.set('x-server-cache-hit', 'true')

  return ctx.body = mainView({
    partial: movieList,
    content: data
  })
}

export async function showMovieDetail(ctx) {
  const data = await tmdb.getMovieDetail(ctx.params.id)

  if (data.cacheHit) ctx.set('x-server-cache-hit', 'true')

  return ctx.body = mainView({
    partial: movieDetail,
    content: data
  })
}

// API
export async function getMovies(ctx) {
  const data = await tmdb.getMovies(ctx.query)

  if (data.cacheHit) ctx.set('x-server-cache-hit', 'true')

  ctx.set('Cache-Control', 'max-age=43200, stale-while-revalidate=43200')

  return ctx.body = data
}

export async function getMovieDetail(ctx) {
  const data = await tmdb.getMovieDetail(ctx.params.id)

  if (data.cacheHit) ctx.set('x-server-cache-hit', 'true')

  return ctx.body = movie
}

export async function getMovieScore(ctx) {
  const key = `movies/${ctx.params.id}/score`

  let data = await scoreService.getAvgScore(key) // cache hit if response OK with key alone

  if (data) {
    ctx.set('x-server-cache-hit', 'true')
    return ctx.body = data
  }

  const movie = await tmdb.getMovieDetail(ctx.params.id)
  const { tmdbScore, imdbId, wikiId, title, releaseDate } = movie

  data = await scoreService.getAvgScore(key, {
    tmdbScore,
    imdbId,
    wikiId,
    title,
    releaseDate
  })

  return ctx.body = data
}