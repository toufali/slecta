// Cloud Run Job entrypoint, the batch counterpart to server.js. No HTTP surface to authenticate.
// The exit status is what the awaited `jobs execute` step in cloudbuild.yaml reports.
// Cloud Scheduler cannot see it, so a failed nightly run is caught by the log alert instead.

import redis from './services/redisService.js'
import tmdb from './services/tmdbService.js'
import scoreService from './services/scoreService.js'
import log from './utils/logger.js'
import { cacheScores } from './jobs/cacheScores.js'
import { checkRankedIndex, checkReferenceTitles } from './jobs/checks.js'

// ms between requests to one host, ≈2 a second. A run is ~730 each to RT and Metacritic, ~2,200 cold
const HOST_INTERVAL = 500

// Passed by the deploy: verifying scoring belongs in a build, warming the catalogue does not
const checksOnly = process.argv[2] === 'checks'

try {
  // The job exists to fill the cache. Without one it would still download the IMDb dataset and
  // spend thousands of third-party requests scoring titles, then throw all of it away.
  if (!await redis.init()) throw new Error('Redis unavailable, skipping the run')

  await tmdb.init()

  // Only the batch has the volume to be worth spacing
  scoreService.throttleMs = HOST_INTERVAL

  if (checksOnly) {
    // The ranked list too: a deploy that bumped the row shape leaves it unpublished, and the checks
    // are the only thing that runs before traffic arrives
    const [reference, ranked] = [await checkReferenceTitles(), await checkRankedIndex()]

    process.exitCode = reference.ok && ranked.ok ? 0 : 1
  } else {
    const { coverage, reference } = await cacheScores()

    // exitCode, not process.exit(): stdout is a pipe here and exiting discards buffered logs
    process.exitCode = coverage.ok && reference.ok ? 0 : 1
  }
} catch (e) {
  log.error(checksOnly ? 'score checks threw' : 'cacheScores job threw', { error: e })
  process.exitCode = 1
} finally {
  // Without this the open connection keeps the process alive until Cloud Run's task timeout
  await redis.close()
}
