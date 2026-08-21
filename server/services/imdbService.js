// IMDb ratings from the official bulk dataset.

import { createGunzip } from 'node:zlib'
import { Readable } from 'node:stream'
import { createInterface } from 'node:readline'
import redis from './redisService.js'

const DATASET_URL = 'https://datasets.imdbws.com/title.ratings.tsv.gz'
const KEY_PREFIX = 'imdb/ratings/'
const META_KEY = 'imdb/ratings/meta'
const TTL = 60 * 60 * 78 // 78 hours — outlives two missed nightly runs, which recover at 72h
const DOWNLOAD_TIMEOUT = 60000
const ID_PATTERN = /^tt\d+$/

// Fewer votes is noise, and the floor cuts the payload from ~25MB to ~9MB on a capped Redis
const MIN_VOTES = 100

// Bucketed by the last 3 characters of the id so a lookup reads one ~10KB string rather than
// a 400k-field hash, which Redis cannot store compactly
function bucketKey(imdbId) {
  return KEY_PREFIX + imdbId.slice(-3)
}

class ImdbService {
  async refresh() {
    const started = Date.now()
    const res = await fetch(DATASET_URL, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT) })

    if (!res.ok) throw new Error(`IMDb dataset fetch failed: ${res.status} ${res.statusText}`)

    const lines = createInterface({
      input: Readable.fromWeb(res.body).pipe(createGunzip()),
      crlfDelay: Infinity
    })
    const buckets = new Map()
    let kept = 0
    let total = 0

    for await (const line of lines) {
      const [imdbId, rating, votes] = line.split('\t')

      total++
      if (!ID_PATTERN.test(imdbId) || Number(votes) < MIN_VOTES) continue

      const key = bucketKey(imdbId)
      const bucket = buckets.get(key)

      if (bucket) bucket.push(line)
      else buckets.set(key, [line])
      kept++
    }

    if (kept === 0) throw new Error('IMDb dataset parsed to zero usable rows')

    // Chunked because node-redis pipelines concurrent commands. setCache hides Redis errors,
    // so unchecked writes would report a refresh that never landed.
    const entries = [...buckets]
    for (let i = 0; i < entries.length; i += 100) {
      const written = await Promise.all(entries.slice(i, i + 100).map(([key, rows]) => redis.setCache(key, rows.join('\n'), TTL)))
      if (!written.every(Boolean)) throw new Error('IMDb dataset write to Redis failed')
    }

    const meta = { titles: kept, buckets: buckets.size, lastModified: res.headers.get('last-modified') }
    if (!await redis.setCache(META_KEY, meta, TTL)) throw new Error('IMDb metadata write to Redis failed')

    console.info('IMDb ratings refreshed:', { ...meta, scanned: total, seconds: Math.round((Date.now() - started) / 1000) })
    return meta
  }

  async getRating(imdbId) {
    if (!imdbId || !ID_PATTERN.test(imdbId)) return

    const bucket = await redis.getCache(bucketKey(imdbId))
    if (!bucket) return

    // Match the one line rather than parsing the whole bucket on every lookup
    const row = bucket.match(new RegExp(`^${imdbId}\t([\\d.]+)\t(\\d+)$`, 'm'))
    if (!row) return

    return { rating: parseFloat(row[1]), votes: parseInt(row[2]) }
  }

  async getMeta() {
    return await redis.getCache(META_KEY)
  }
}

export default new ImdbService()
