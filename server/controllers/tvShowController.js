import tmdb from '../services/tmdbService.js'
import scoreService from '../services/scoreService.js'
import reviewService from '../services/reviewService.js'
import { mainView } from '../views/mainView.js'
import { tvShowList } from '../views/partials/tvShowList.js'
import { tvShowDetail } from '../views/partials/tvShowDetail.js'

export async function showTvShows(ctx) {
  const data = await tmdb.getTvShows(ctx.query)

  const scores = await Promise.allSettled(data.shows.map(show => {
    const key = `shows/${show.id}/score`
    return scoreService.getScoreFromCache(key)
  }))

  scores.forEach((score, i) => {
    if (score.value) data.shows[i].score = score.value.avgScore
  })

  if (data.cacheHit) ctx.set('x-server-cache-hit', 'true')

  return ctx.body = mainView({
    partial: tvShowList,
    content: data
  })
}

export async function showTvShowDetail(ctx) {
  const data = await tmdb.getTvShowDetail(ctx.params.id)
  const score = await scoreService.getScoreFromCache(`shows/${ctx.params.id}/score`)
  const quotes = await reviewService.getQuotesFromCache(ctx.params.id)

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
  const data = await tmdb.getTvShows(ctx.query)

  data.allGenres = Array.from(data.allGenres.entries()) // can't send type Map via JSON :(

  const scores = await Promise.allSettled(data.shows.map(show => {
    const key = `shows/${show.id}/score`
    return scoreService.getScoreFromCache(key)
  }))

  scores.forEach((score, i) => {
    if (score.value) data.shows[i].score = score.value.avgScore
  })

  if (data.cacheHit) ctx.set('x-server-cache-hit', 'true')

  ctx.set('Cache-Control', 'max-age=43200, stale-while-revalidate=43200')

  return ctx.body = data
}

export async function getTvShowDetail(ctx) {
  const data = await tmdb.getTvShowDetail(ctx.params.id)

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
  const { tmdbScore, imdbId, wikiId, title, releaseDate } = show

  data = await scoreService.getScore(key, {
    tmdbScore,
    imdbId,
    wikiId,
    title,
    releaseDate
  })

  return ctx.body = data
}

export async function getTvShowQuotes(ctx) {
  console.log(ctx.query.releaseDate)
  const data = await reviewService.getQuotes(ctx.params.id, ctx.query.title, ctx.query.releaseDate)

  if (data.cacheHit) {
    ctx.set('x-server-cache-hit', 'true')
  }

  ctx.set('Cache-Control', 'max-age=43200, stale-while-revalidate=43200')
  return ctx.body = data
}