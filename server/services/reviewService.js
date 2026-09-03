import env from '../env.js'
import redis from "./redisService.js"

const { GCP_API_URL, GCP_API_KEY, GCP_SEARCH_ENGINE, PPLX_TOKEN, PPLX_API_URL, PPLX_MODEL, PPLX_SOURCES } = env

const day = date => date.toISOString().substring(0, 10)

class ReviewService {
  async getReviewFromCache(id) {
    return await redis.getCache(`movies/${id}/review`)
  }

  async getReview(id, name, date) {
    if (date > new Date()) return console.log('getReview: release date is after current date')

    let data = await this.getReviewFromCache(id)
    if (data) return data

    const res = await fetch(PPLX_API_URL, {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${PPLX_TOKEN}`,
        'content-type': 'application/json'
      },
      method: 'post',
      body: JSON.stringify({
        model: PPLX_MODEL || 'sonar-small-online',
        messages: [
          {
            role: 'system',
            content: `You are a machine that outputs critical sentiment of movies. I will input a movie title and release year. You must output critic sentiment of that movie using data from the following array of sources: ${PPLX_SOURCES.split(',')} If data from those sources is not available, you must respond "Not found". Your output must be less than 100 words.`
          },
          {
            role: 'user',
            content: `"${name}" released in ${new Date(date).getFullYear()}`
          }
        ],
        temperature: 0
      })
    })

    if (!res.ok) return console.error('Error response from PPLX:', res.message)

    const json = await res.json()

    data = {
      summary: json.choices[0].message.content
    }

    if (data.summary.startsWith("Not found")) {
      data.summary = "Not available."
      redis.setCache(`movies/${id}/review`, data, 60 * 60 * 24)
    } else {
      redis.setCache(`movies/${id}/review`, data, 60 * 60 * 24 * 7)
    }

    return data
  }

  async getQuotesFromCache(id, mediaType = 'movie') {
    // Namespaced by type: TMDB ids are per-type, so movie 1396 and show 1396 differ
    const quotes = await redis.getCache(`${mediaType}s/${id}/quotes`)
    return quotes ?? []
  }

  async getQuotes(id, name, date, mediaType = 'movie') {
    // Koa yields an array for a repeated query param, which would make `name.length` below an
    // element count rather than a string length, and stringify commas into the search query
    name = first(name)
    date = first(date)

    let quotes = await this.getQuotesFromCache(id, mediaType)
    if (quotes?.length) return quotes

    // Clients can send anything, and TV details cached before the first_air_date fix still
    // stringify to 'undefined'. Unvalidated, the arithmetic below throws RangeError -> 500.
    const released = new Date(date)

    if (isNaN(released)) return []

    // UTC accessors to match the UTC formatting: read through the local calendar, a span crossing a
    // DST transition lands a day out
    const from = new Date(released)
    const to = new Date(released)

    from.setUTCDate(from.getUTCDate() - 7)
    to.setUTCMonth(to.getUTCMonth() + 1)

    // Nothing reviews a title a week before it is out, so there is nothing to search for. Compared
    // as dates: against the formatted string the comparison was NaN, so this never returned.
    if (new Date() < from) return []

    const dateMinusOneWeek = day(from)
    const datePlusOneMonth = day(to)

    const params = {
      q: `intitle:"${name}" intitle:review`,
      cx: GCP_SEARCH_ENGINE,
      sort: `date:r:${dateMinusOneWeek.replaceAll('-', '')}:${datePlusOneMonth.replaceAll('-', '')}`,
      key: GCP_API_KEY
    }

    const urlParams = new URLSearchParams(params)
    const url = `${GCP_API_URL}?${urlParams}`

    const res = await fetch(url)

    if (!res.ok) {
      console.warn('Error response from GCP API:', res.message)
      return []
    }

    const json = await res.json()

    const map = json.items?.reduce((acc, cur) => {
      if (acc.size >= 3) return acc // limit top 3 quotes

      const sourceLink = cur.link

      let quote = cur.pagemap.metatags[0]?.['og:description'] || cur.pagemap.metatags[0]?.['description']
      if (quote && quote.length < name.length + 20) quote = null // invalidate quotes that are not long enough, e.g. "Dune: Part Two Movie Review"

      let sourceName = cur.pagemap.metatags[0]?.['og:site_name'] || cur.displayLink
      let i = sourceName.indexOf('www.')
      if (i >= 0) sourceName = sourceName.substring(i + 4) // strip www subdomain and any protocol text
      i = sourceName.indexOf('/')
      if (i >= 0) sourceName = sourceName.substring(0, i) // strip text after slash if present

      if (sourceLink && quote && sourceName && !acc.has(sourceName)) acc.set(sourceName, { quote, sourceLink, sourceName }) // add only if values exist and we don't already have that source

      return acc
    }, new Map())

    if (map?.size) {
      var cacheExp = 60 * 60 * 24 * 7 // valid quotes available, cache for 7 days
      quotes = Array.from(map.values()) // Map used above to store reviews from unique sources. Here it's converted to array for JSON API consumption
    } else {
      var cacheExp = 60 * 60 * 24 // no quotes, cache for 1 day
      quotes = []
    }

    redis.setCache(`${mediaType}s/${id}/quotes`, quotes, cacheExp)
    return quotes
  }
}

export default new ReviewService()

function first(value) {
  return Array.isArray(value) ? value[0] : value
}
