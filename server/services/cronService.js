import cron from 'node-cron';
import tmdb from '../services/tmdbService.js'
import scoreService from '../services/scoreService.js'

// ┌────────────── second (optional)
// │ ┌──────────── minute
// │ │ ┌────────── hour
// │ │ │ ┌──────── day of month
// │ │ │ │ ┌────── month
// │ │ │ │ │ ┌──── day of week
// │ │ │ │ │ │
// │ │ │ │ │ │
// * * * * * *

const SCHEDULE = '* * 0 * * *'

class CronService {
  init() {
    if (!cron.validate(SCHEDULE)) return console.info('Cron service initialized:', false)

    cron.schedule(SCHEDULE, () => {
      console.info('Cron service: run `cacheScoresTask`');
      cacheScoresTask()
    });
    console.info('Cron service initialized:', true)
  }
}

async function cacheScoresTask() {
  console.info('running cacheScoresTask')
  const data = await tmdb.getMovies()

  Promise.allSettled(data.map(async movie => {
    const key = `movies/${movie.id}/score`
    const movieDetail = await tmdb.getMovieDetail(movie.id)
    const { tmdbScore, imdbId, wikiId, title, releaseDate } = movieDetail

    return scoreService.getScore(key, {
      tmdbScore,
      imdbId,
      wikiId,
      title,
      releaseDate
    })
  }))
}

export default new CronService()