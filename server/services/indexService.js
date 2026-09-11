// The ranked list the nightly job publishes, read back as a catalogue page. TMDB cannot sort on a
// score it does not hold, so "Top Rated" is served from here instead of from discover.

import redis, { CONFLICT } from './redisService.js'
import tmdb, { ENGLISH } from './tmdbService.js'
import { aggregate, scoreKey } from './scoreService.js'
import log from '../utils/logger.js'

// Bump when the row shape changes, then run the job by hand: the deploy runs the checks only, so
// until the nightly run this key is absent and the ranked list fails outright.
export const INDEX_VERSION = 2

export const indexKey = segment => `index/${segment}/v${INDEX_VERSION}`

// Votes then id break the ties an integer score produces, so the order does not reshuffle between runs
export const byRank = (a, b) => b.score - a.score || b.votes - a.votes || a.id - b.id

// Discover's own page size: switching sort should not change how long a page is
const PAGE_SIZE = 20

// The panel sends one value, several, or an empty one meaning no filter — which the discover path
// prunes, so an empty here has to read as absent rather than as a value nothing matches
const asList = value => {
  const list = [].concat(value ?? []).filter(each => each !== '')

  return list.length ? list : undefined
}

// Every filter discover is sent has to hold here too, and none that it does not: TV has no
// certification filter there, so applying one here empties the list on a change of sort alone
function matches(row, query, { window, certifications }) {
  const genres = asList(query.wg)?.map(Number)
  const without = asList(query.wog)?.map(Number)
  const ratings = certifications ? asList(query.wr) : undefined
  const minVotes = Number(query.minVotes)

  if (genres && !row.genreIds?.some(id => genres.includes(id))) return false
  if (without?.some(id => row.genreIds?.includes(id))) return false
  if (ratings && !ratings.includes(row.certification)) return false

  // The index is built at the catalogue's own vote floor, so an override can only narrow from there
  if (minVotes && !(row.votes >= minVotes)) return false

  // Agrees with discover title for title, now that both catalogues count ad-supported as available
  if (query.streaming && !row.providers?.length) return false

  // Discover is asked for the code; here the same filter reads off the row
  if (query.english && row.originalLanguage !== ENGLISH) return false

  // An incomplete walk keeps rows it could not confirm, so one can outlast the window it was listed
  // from. Discover applies this bound on its own; here it has to be applied on the way out.
  return row.releaseDate >= window.from && row.releaseDate <= window.to
}

class IndexService {
  /**
   * One page of the ranked list, shaped like a discover page so the view cannot tell them apart.
   * @return {(object|undefined)} undefined when the index cannot be read, which the caller must
   *   tell from an empty page: the first is our failure, the second is the filter's answer.
   */
  async getList(mediaType, query) {
    const { segment, genreKey, certifications } = tmdb.catalogue(mediaType)
    const rows = await redis.getCache(indexKey(segment))

    if (!rows) {
      log.warn('Ranked list unavailable', { segment, read: rows === undefined ? 'failed' : 'missing' })
      return
    }

    // No rankability floor: a title disappearing when the sort changes reads as broken, and thin
    // scores sink on their own — an IMDb-only row tops out well below the head of the list.
    // Once, not per row: the bound is the request's, and a scan crossing midnight would otherwise
    // filter the head of one response against a different day than its tail
    const rules = { window: tmdb.dateWindow(query.months), certifications }
    const found = rows.filter(row => matches(row, query, rules))
    const page = Number(query.page) || 1
    const start = (page - 1) * PAGE_SIZE

    const data = {
      // Already ranked at write time, so a request only filters and slices
      [segment]: found.slice(start, start + PAGE_SIZE).map(row => this.#card(segment, genreKey, row)),
      ...tmdb.listShape(mediaType, query),
      totalPages: Math.ceil(found.length / PAGE_SIZE),
      totalResults: found.length
    }

    // Carried on, and non-enumerable as `getCache` sets it, so the header still reports the truth
    // without the marker reaching the API body
    if (rows.cacheHit) Object.defineProperty(data, 'cacheHit', { value: true })

    return data
  }

  /**
   * Re-rank one title after its record was written: a record refreshed between nightly runs
   * otherwise ranks by the number it replaced. Read back from storage rather than trusting the
   * caller's copy, so the rank can never carry a number Redis does not hold.
   */
  async rerank(mediaType, id) {
    const { segment } = tmdb.catalogue(mediaType)

    // Two live writes can race on the index; the loser re-reads and tries once more
    for (let attempt = 0; attempt < 2; attempt++) {
      const score = aggregate(await redis.getCache(scoreKey(segment, id)))

      if (score === undefined) return

      const outcome = await redis.updateCache(indexKey(segment), rows => {
        const row = rows.find(row => row.id === id)

        // Absent for a title outside the window; unchanged when the rewrite kept the same number
        if (!row || row.score === score) return

        row.score = score

        return rows.sort(byRank)
      })

      if (outcome !== CONFLICT) return
    }

    log.warn('Re-rank lost twice, leaving the rank to the next write or run', { segment, id })
  }

  // Deliberately without `score`: the row's is a sort key, and `attachScores` fills the rendered one
  // from the score record. Passing it through would let a stale row serve a number Redis has dropped.
  #card(segment, genreKey, row) {
    const genres = tmdb.genres[genreKey]

    return {
      id: row.id,
      title: row.title,
      genres: row.genreIds?.map(id => genres.get(id)) ?? [],
      genreIds: row.genreIds,
      releaseDate: row.releaseDate,
      posterThumb: `${tmdb.imgConfig.secure_base_url}${tmdb.imgConfig.poster_sizes[0]}${row.posterPath}`,
      posterPath: row.posterPath,
      tmdbScoreCount: row.votes,
      detailPath: `/${segment}/${row.id}`
    }
  }
}

export default new IndexService()
