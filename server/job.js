// Entrypoint for the Cloud Run Job. Starts what the job needs, runs it, exits.
//
// This replaced an authenticated HTTP endpoint on the public service. A job has no network
// surface, so there is nothing to authenticate, and no scheduler request deadline to fit in.
//
// Exits non-zero when verification fails, so a failed execution is visible both to Cloud
// Scheduler and to the post-deploy check in cloudbuild.yaml. The job is configured with no
// retries — a rerun would repeat every external call, and verification failures are rarely
// transient.

import redis from './services/redisService.js'
import tmdb from './services/tmdbService.js'
import log from './utils/logger.js'
import { cacheScores } from './jobs/cacheScores.js'

try {
  await redis.init()
  await tmdb.init()

  const { coverage, reference } = await cacheScores()

  process.exit(coverage.ok && reference.ok ? 0 : 1)
} catch (e) {
  log.error('cacheScores job threw', { error: e })
  process.exit(1)
}
