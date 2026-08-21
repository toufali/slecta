// Cloud Run Job entrypoint, the batch counterpart to server.js. No HTTP surface to authenticate.
// The exit status gates the awaited `jobs execute` step in cloudbuild.yaml.
// Cloud Scheduler cannot see it, so a failed nightly run is caught by the log alert instead.

import redis from './services/redisService.js'
import tmdb from './services/tmdbService.js'
import log from './utils/logger.js'
import { cacheScores } from './jobs/cacheScores.js'

try {
  await redis.init()
  await tmdb.init()

  const { coverage, reference } = await cacheScores()

  // exitCode, not process.exit(): stdout is a pipe here and exiting discards buffered logs
  process.exitCode = coverage.ok && reference.ok ? 0 : 1
} catch (e) {
  log.error('cacheScores job threw', { error: e })
  process.exitCode = 1
} finally {
  // Without this the open connection keeps the process alive until Cloud Run's task timeout
  await redis.quit()
}
