import tmdb from '../services/tmdbService.js'
import scoreService from '../services/scoreService.js'
import reviewService from '../services/reviewService.js'
import { attachScores } from './attachScores.js'
import { mainView } from '../views/mainView.js'
import { tvShowList } from '../views/partials/tvShowList.js'
import { tvShowDetail } from '../views/partials/tvShowDetail.js'

// Shared by the page and the API: both need the same rows, the same badges and the same cache-hit
// header, and differ only in how they serialise the result
async function list(ctx) {
  const data = await tmdb.getTvShows(ctx.query)

  await attachScores(data.shows, 'shows')

  if (data.cacheHit) ctx.set('x-server-cache-hit', 'true')

  return data
}

export async function showTvShows(ctx) {
  return ctx.body = mainView({
    partial: tvShowList,
    content: await list(ctx)
  })
}

export async function showTvShowDetail(ctx) {
  const data = await tmdb.getTvShowDetail(ctx.params.id)

  if (!data) return ctx.throw(404)

  const score = await scoreService.getScoreFromCache(`shows/${ctx.params.id}/score`)
  const quotes = await reviewService.getQuotesFromCache(ctx.params.id, 'tv')

  data.score = score?.avgScore
  data.quotes = quotes

  if (data.cacheHit) ctx.set('x-server-cache-hit', 'true')

  ctx.set('Cache-Control', 'max-age=43200, stale-while-revalidate=43200')

  return ctx.body = mainView({
    partial: tvShowDetail,
    content: data
  })
}

// API
export async function getTvShows(ctx) {
  const data = await list(ctx)

  data.allGenres = Array.from(data.allGenres.entries()) // can't send type Map via JSON :(

  ctx.set('Cache-Control', 'max-age=43200, stale-while-revalidate=43200')

  return ctx.body = data
}

export async function getTvShowDetail(ctx) {
  const data = await tmdb.getTvShowDetail(ctx.params.id)

  if (!data) return ctx.throw(404)

  if (data.cacheHit) ctx.set('x-server-cache-hit', 'true')

  return ctx.body = data
}

export async function getTvShowScore(ctx) {
  const key = `shows/${ctx.params.id}/score`

  let data = await scoreService.getScoreFromCache(key)

  if (data) {
    ctx.set('x-server-cache-hit', 'true')
    return ctx.body = data
  }

  const show = await tmdb.getTvShowDetail(ctx.params.id)

  if (!show) return ctx.throw(404)

  const { tmdbScore, imdbId, wikiId, title, releaseDate } = show

  data = await scoreService.getScore(key, {
    tmdbScore,
    imdbId,
    wikiId,
    title,
    releaseDate,
    mediaType: 'tv'
  })

  return ctx.body = data
}

export async function getTvShowQuotes(ctx) {
  const data = await reviewService.getQuotes(ctx.params.id, ctx.query.title, ctx.query.releaseDate, 'tv')

  if (data.cacheHit) {
    ctx.set('x-server-cache-hit', 'true')
  }

  ctx.set('Cache-Control', 'max-age=43200, stale-while-revalidate=43200')
  return ctx.body = data
}