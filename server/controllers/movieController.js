import tmdb from '../services/tmdbService.js'
import scoreService from '../services/scoreService.js'
import { mainView } from '../views/mainView.js'
import { movieList } from '../views/partials/movieList.js'
import { movieDetail } from '../views/partials/movieDetail.js'

export async function showMovieList(ctx) {
  const movies = await tmdb.getMovies(ctx.query)

  return ctx.body = mainView({
    partial: movieList,
    movies
  })
}

export async function showMovieDetail(ctx) {
  console.log('showMovieDetail cacheData:', ctx.state.cacheData)
  const movie = ctx.state.cacheData ?? await tmdb.getMovieDetail(ctx.params.id)

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
  // const movie = ctx.state.cacheData ?? await tmdb.getMovieDetail(ctx.params.id)
  const movie = await tmdb.getMovieDetail(ctx.params.id)
  const score = await scoreService.getAvgScore()

  // ctx.set('Cache-Control', 'max-age=43200, stale-while-revalidate=43200')
  return ctx.body = movie
}

export async function getMovieScore(ctx) {
  console.log('getMovieScore cacheData:', ctx.state.cacheData)
  const { wikiId, imdbId, tmdbScore, title, releaseDate } = ctx.query
  const avgScore = ctx.state.cacheData ?? await scoreService.getAvgScore({ title, releaseDate, wikiId, tmdbScore: parseInt(tmdbScore), imdbId })

  // const tmdbId = ctx.params.id

  // if (!avgScore) {
  //   // TODO: consider a "resource registry" to return active promise that is populating the scores, instead of each request crawling for the resource
  //   // https://medium.com/pipedrive-engineering/resource-optimization-in-node-js-c90c731f9df4
  //   avgScore = await reviewService.populateScores({ title, releaseDate, wikiId, tmdbId, tmdbScore, imdbId })
  // }

  ctx.set('Cache-Control', 'max-age=43200, stale-while-revalidate=43200')
  return ctx.body = avgScore
}


// export async function showMovieList_old(ctx) {
//   // This is to populate initial form view. Actual movie results are triggered via client API call.
//   // Initial form values are first pulled from url query, else we set a default.
//   const currentYear = new Date().getFullYear()

//   return ctx.body = mainView({
//     partial: movieList,
//     allGenres: tmdb.defaults.genres,
//     allRatings: tmdb.defaults.ratings,
//     currentYear,
//     withGenres: ctx.query.wg ?? '',
//     withoutGenres: ctx.query.wog ?? '',
//     withRatings: ctx.query.wr ?? '',
//     sort: ctx.query.sort ?? 'vote_average.desc',
//     tmdbScore: ctx.query.score ?? 60,
//     reviewCount: ctx.query.count ?? 100,
//     streaming: ctx.query.streaming,
//     years: ctx.query.years ?? `${currentYear - 1},${currentYear}`
//   })
// }

// export async function showMovieDetail_old(ctx) {
//   if (ctx.state.cacheData) {
//     var movie = ctx.state.cacheData
//   } else {
//     var [movie, avgScore] = await Promise.all([tmdb.getMovieDetail(ctx.params.id), reviewService.getAvgScore(ctx.params.id)])
//     movie.avgScore = avgScore
//   }

//   if (!avgScore) {
//     // movie score not available, set low TTL cache
//     ctx.state.cacheTTL = 60 // seconds – after testing, increase this to 1+ hr!
//     ctx.set('Cache-Control', 'max-age=1200')
//   } else {
//     ctx.set('Cache-Control', 'max-age=43200, stale-while-revalidate=43200')
//   }

//   ctx.state.cacheData = movie // store JSON data for cache when response body is text/html

//   return ctx.body = mainView({
//     partial: movieDetail,
//     movie
//   })
// }
