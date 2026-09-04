// One copy of every score record per night, so a component's movement can be measured over weeks
// rather than inferred from comparing titles. Nothing in the app reads these; the analysis that
// re-derives the weighting constants does, offline.

import redis, { WRITTEN } from '../services/redisService.js'
import log from '../utils/logger.js'

// Long enough for a score to be seen settling, and no longer: a nightly copy of the catalogue must
// not crowd out the records it describes
const SNAPSHOT_TTL = 60 * 60 * 24 * 30

// No cache version, deliberately. A record-shape bump orphans nothing here, because this is the one
// thing the job cannot rebuild by running again.
export const snapshotKey = (segment, date) => `snapshot/${segment}/${date}`

/**
 * Store one catalogue's records for one night.
 * @param {string} date the run's own date, so both catalogues in a run file under one night
 * @return {boolean} whether the night was stored; the reason it was not is logged here
 */
export async function writeSnapshot(segment, date, records) {
  if (!records.length) {
    log.error('No score records to snapshot', { segment, date })

    return false
  }

  if (await redis.setCache(snapshotKey(segment, date), records, SNAPSHOT_TTL) === WRITTEN) return true

  log.error('Score snapshot write failed', { segment, date, records: records.length })

  return false
}
