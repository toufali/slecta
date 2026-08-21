// Checks known titles per source. Checking only the combined score would miss one source dying.

import tmdb from '../services/tmdbService.js'
import scoreService from '../services/scoreService.js'
import log from '../utils/logger.js'

// Points of drift allowed. A dead source returns nothing at all, not a near-miss.
const TOLERANCE = 3

// Settled titles covering movies and TV, so both path prefixes get exercised. Verified 2026-08-19.
const REFERENCE_TITLES = [
  { mediaType: 'movie', tmdbId: 693134, name: 'Dune: Part Two', expected: { imdb: 84, metacritic: 79, rtCritic: 92, rtAudience: 95 } },
  { mediaType: 'movie', tmdbId: 27205, name: 'Inception', expected: { imdb: 88, metacritic: 74, rtCritic: 86, rtAudience: 91 } },
  { mediaType: 'tv', tmdbId: 1396, name: 'Breaking Bad', expected: { imdb: 95, metacritic: 87, rtCritic: 96, rtAudience: 97 } }
]

export async function runSmokeTest() {
  const failures = []

  for (const { mediaType, tmdbId, name, expected } of REFERENCE_TITLES) {
    const detail = mediaType === 'movie'
      ? await tmdb.getMovieDetail(tmdbId)
      : await tmdb.getTvShowDetail(tmdbId)

    if (!detail) {
      failures.push({ title: name, source: 'tmdb', reason: 'no detail returned' })
      continue
    }

    const result = await scoreService.getScore(`smoke/${mediaType}/${tmdbId}`, { ...detail, mediaType }, false)

    for (const [source, want] of Object.entries(expected)) {
      const got = result?.scores?.[source]

      if (got === undefined) failures.push({ title: name, source, want, reason: 'absent' })
      else if (Math.abs(got - want) > TOLERANCE) failures.push({ title: name, source, want, got, reason: 'out of tolerance' })
    }

    // TMDB drifts too much to pin a value, but a dropped component should still fail
    if (result?.scores?.tmdb === undefined) failures.push({ title: name, source: 'tmdb', reason: 'absent' })
  }

  const passed = failures.length === 0

  if (passed) log.info('Score smoke test passed', { titles: REFERENCE_TITLES.length, tolerance: TOLERANCE })
  else log.error('Score smoke test FAILED', { titles: REFERENCE_TITLES.length, tolerance: TOLERANCE, failures })

  return { passed, failures }
}
