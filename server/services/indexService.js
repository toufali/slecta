// The ranked list the nightly job publishes, read back as a catalogue page. TMDB cannot sort on a
// score it does not hold, so "Top Rated" is served from here instead of from discover.

import redis from './redisService.js'
import tmdb from './tmdbService.js'
import log from '../utils/logger.js'

// Bump when the row shape changes. The deploy runs the checks only, so a shape change is not
// rewritten until the nightly run — without this the first serving deploy reads the old generation.
export const INDEX_VERSION = 1

export const indexKey = segment => `index/${segment}/v${INDEX_VERSION}`

// Discover's own page size: switching sort should not change how long a page is
const PAGE_SIZE = 20

// The panel sends one value or several, and a genre matches if any of them does
const asList = value => value === undefined ? undefined : [].concat(value)

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

  // Not quite discover's filter: it asks TMDB for named monetization buckets, and the row flattens
  // them. Costs five movies TMDB counts as unavailable because ads-only; measured in `decisions.md`.
  if (query.streaming && !row.providers?.length) return false

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
    const rules = { window: tmdb.dateWindow(), certifications }
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
