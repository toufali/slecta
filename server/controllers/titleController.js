import tmdb from '../services/tmdbService.js'
import scoreService, { scoreKey } from '../services/scoreService.js'
import reviewService from '../services/reviewService.js'
import { attachScores } from './attachScores.js'
import { mainView } from '../views/mainView.js'
import { movieList } from '../views/partials/movieList.js'
import { movieDetail } from '../views/partials/movieDetail.js'
import { tvShowList } from '../views/partials/tvShowList.js'
import { tvShowDetail } from '../views/partials/tvShowDetail.js'

// Everything the two media types disagree about, so a handler holds none of it. `segment` covers
// both the cache-key prefix and the name TMDB's list response uses — they are already the same
// string, which is why no property rename was needed to make these converge.
const MEDIA = {
  movie: {
    segment: 'movies',
    list: query => tmdb.getMovies(query),
    detail: id => tmdb.getMovieDetail(id),
    listView: movieList,
    detailView: movieDetail
  },
  tv: {
    segment: 'shows',
    list: query => tmdb.getTvShows(query),
    detail: id => tmdb.getTvShowDetail(id),
    listView: tvShowList,
    detailView: tvShowDetail
  }
}

const CACHE_CONTROL = 'max-age=43200, stale-while-revalidate=43200'

// Shared by the page and the API: both need the same rows, the same badges and the same cache-hit
// header, and differ only in how they serialise the result
async function list(ctx, media) {
  const data = await media.list(ctx.query)

  await attachScores(data[media.segment], media.segment)

  if (data.cacheHit) ctx.set('x-server-cache-hit', 'true')

  return data
}

// Each handler is built for one media type at the route, next to the `validateFilters` that already
// names it, so nothing downstream has to work out which catalogue it is serving.
export const showList = mediaType => async ctx => {
  const media = MEDIA[mediaType]

  return ctx.body = mainView({
    partial: media.listView,
    content: await list(ctx, media)
  })
}

export const showDetail = mediaType => async ctx => {
  const media = MEDIA[mediaType]
  const data = await media.detail(ctx.params.id)

  if (!data) return ctx.throw(404)

  const score = await scoreService.getScoreFromCache(scoreKey(media.segment, ctx.params.id))
  const quotes = await reviewService.getQuotesFromCache(ctx.params.id, mediaType)

  data.score = score?.avgScore
  data.quotes = quotes

  if (data.cacheHit) ctx.set('x-server-cache-hit', 'true')

  ctx.set('Cache-Control', CACHE_CONTROL)

  return ctx.body = mainView({
    partial: media.detailView,
    content: data
  })
}

// API
export const getList = mediaType => async ctx => {
  const data = await list(ctx, MEDIA[mediaType])

  data.allGenres = Array.from(data.allGenres.entries()) // can't send type Map via JSON :(

  ctx.set('Cache-Control', CACHE_CONTROL)

  return ctx.body = data
}

export const getDetail = mediaType => async ctx => {
  const data = await MEDIA[mediaType].detail(ctx.params.id)

  if (!data) return ctx.throw(404)

  if (data.cacheHit) ctx.set('x-server-cache-hit', 'true')

  return ctx.body = data
}

// The one endpoint that fetches live on a miss, which is the only way a title outside the nightly
// window ever gets scored
export const getScore = mediaType => async ctx => {
  const { segment, detail } = MEDIA[mediaType]
  const key = scoreKey(segment, ctx.params.id)

  let data = await scoreService.getScoreFromCache(key)

  if (data) {
    ctx.set('x-server-cache-hit', 'true')
    return ctx.body = data
  }

  const found = await detail(ctx.params.id)

  if (!found) return ctx.throw(404)

  const { imdbId, wikiId, title, releaseDate } = found

  // Already missed above, so do not read the cache a second time
  data = await scoreService.getScore(key, { imdbId, wikiId, title, releaseDate, mediaType }, false)

  return ctx.body = data
}

export const getQuotes = mediaType => async ctx => {
  const data = await reviewService.getQuotes(ctx.params.id, ctx.query.title, ctx.query.releaseDate, mediaType)

  if (data.cacheHit) ctx.set('x-server-cache-hit', 'true')

  ctx.set('Cache-Control', CACHE_CONTROL)

  return ctx.body = data
}
