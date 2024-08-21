import env from '../env.js'
import redis from "./redisService.js"

const { GCP_API_URL, GCP_API_KEY, GCP_SEARCH_ENGINE, PPLX_TOKEN, PPLX_API_URL, PPLX_MODEL, PPLX_SOURCES } = env

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

  async getQuotesFromCache(id) {
    const quotes = await redis.getCache(`movies/${id}/quotes`)
    return quotes ?? []
  }

  async getQuotes(id, name, date) {
    let quotes = await this.getQuotesFromCache(id)
    if (quotes?.length) return quotes

    if (!date || date === 'undefined') return [] // TODO: why is this undefined for TV? Clean this up on the client
    let dateMinusOneWeek = new Date(date)
    dateMinusOneWeek.setDate(dateMinusOneWeek.getDate() - 7)
    dateMinusOneWeek = dateMinusOneWeek.toISOString().substring(0, 10) // yyyy-mm-dd

    if (new Date() < dateMinusOneWeek) return [] // current date is at least a week before release date

    let datePlusOneMonth = new Date(date)
    datePlusOneMonth.setMonth(datePlusOneMonth.getMonth() + 1)
    datePlusOneMonth = datePlusOneMonth.toISOString().substring(0, 10) // yyyy-mm-dd

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

    redis.setCache(`movies/${id}/quotes`, quotes, cacheExp)
    return quotes
  }
}

export default new ReviewService()