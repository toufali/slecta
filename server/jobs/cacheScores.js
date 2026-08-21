/**
 * Cronjob to refresh the IMDb ratings dataset and cache scores for the default
 * (landing page) list of movies. Triggered via GCP Cloud Scheduler, daily at midnight.
 */

import tmdb from '../services/tmdbService.js'
import scoreService from '../services/scoreService.js'
import imdb from '../services/imdbService.js'

export async function cacheMovieScores() {
  console.info('running cacheMovieScores job...')

  // Must precede scoring — every title's IMDb component reads from this
  try {
    await imdb.refresh()
  } catch (e) {
    console.error('IMDb ratings refresh failed, continuing with the previous dataset:', e)
  }

  const { movies } = await tmdb.getMovies()
  let i = 0
  let notCached = 0

  for (const movie of movies) {
    // get scores in sequence to avoid OOM issues
    const key = `movies/${movie.id}/score`
    const movieDetail = await tmdb.getMovieDetail(movie.id)
    const { tmdbScore, imdbId, wikiId, title, releaseDate } = movieDetail

    const score = await scoreService.getScore(key, {
      tmdbScore,
      imdbId,
      wikiId,
      title,
      releaseDate,
      mediaType: 'movie'
    }, false)

    // Scoring can succeed while the Redis write fails, leaving the cache cold
    if (score && !score.cached) notCached++
    i++
  }

  if (notCached) console.error('cacheMovieScores: scores not persisted:', `${notCached} of ${i}`)

  console.info('...cacheMovieScores job complete:', `${i} of ${movies.length} processed.`)
}
