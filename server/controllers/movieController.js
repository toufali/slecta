import tmdb from '../services/tmdbService.js'
import scoreService from '../services/scoreService.js'
import reviewService from '../services/reviewService.js'
import { mainView } from '../views/mainView.js'
import { movieList } from '../views/partials/movieList.js'
import { movieDetail } from '../views/partials/movieDetail.js'

export async function showMovies(ctx) {
  const data = await tmdb.getMovies(ctx.query)

  const scores = await Promise.allSettled(data.movies.map(movie => {
    const key = `movies/${movie.id}/score`
    return scoreService.getScoreFromCache(key)
  }))

  scores.forEach((score, i) => {
    if (score.value) data.movies[i].score = score.value.avgScore
  })

  if (data.cacheHit) ctx.set('x-server-cache-hit', 'true')

  return ctx.body = mainView({
    partial: movieList,
    content: data
  })
}

export async function showMovieDetail(ctx) {
  const data = await tmdb.getMovieDetail(ctx.params.id)
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
  const data = await tmdb.getMovies(ctx.query)

  const scores = await Promise.allSettled(data.movies.map(movie => {
    const key = `movies/${movie.id}/score`
    return scoreService.getScoreFromCache(key)
  }))

  scores.forEach((score, i) => {
    if (score.value) data.movies[i].score = score.value.avgScore
  })

  if (data.cacheHit) ctx.set('x-server-cache-hit', 'true')

  ctx.set('Cache-Control', 'max-age=43200, stale-while-revalidate=43200')

  return ctx.body = data
}

export async function getMovieDetail(ctx) {
  const data = await tmdb.getMovieDetail(ctx.params.id)

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
  const { tmdbScore, imdbId, wikiId, title, releaseDate } = movie

  data = await scoreService.getScore(key, {
    tmdbScore,
    imdbId,
    wikiId,
    title,
    releaseDate
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