import tmdb from '../services/tmdbService.js'
import scoreService from '../services/scoreService.js'

export async function cacheMovieScores() {
  console.info('running cacheMovieScores job...')
  const movies = await tmdb.getMovies()
  let i = 0

  for (const movie of movies) {
    // get scores in sequence to avoid OOM issues
    const key = `movies/${movie.id}/score`
    const movieDetail = await tmdb.getMovieDetail(movie.id)
    const { tmdbScore, imdbId, wikiId, title, releaseDate } = movieDetail

    await scoreService.getScore(key, {
      tmdbScore,
      imdbId,
      wikiId,
      title,
      releaseDate
    })
    console.info(`...finished score ${++i} of ${movies.length}...`)
  }
  console.info('...cacheMovieScores job complete.')
}
