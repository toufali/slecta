import { firefox } from 'playwright';
import { average } from '../../scripts/math.js';
import redis from "./redisService.js"

class ScoreService {
  defaultTimeout = 2000
  defaultNavigationTimeout = 7000
  blockedBrowserResources = ['stylesheet', 'image', 'images', 'media', 'font', 'script', 'texttrack', 'xhr', 'fetch', 'eventsource', 'websocket', 'manifest', 'other']
  imdbBaseUrl = 'https://www.imdb.com/title/'
  rtBaseUrl = 'https://www.rottentomatoes.com/'
  wikiBaseUrl = 'https://www.wikidata.org/w/rest.php/wikibase/v0/entities/items/'
  wikiRTId = 'P1258'
  userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' + ' AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36'
  browser
  browserCtx

  async init() {
    this.browser = await firefox.launch()
    this.browserCtx = await this.browser.newContext({
      userAgent: this.userAgent
    })
    this.browserCtx.setDefaultTimeout(this.defaultTimeout)
    this.browserCtx.setDefaultNavigationTimeout(this.defaultNavigationTimeout)
    console.info('Browser connected:', this.browser.isConnected())
  }

  async getScoreFromCache(key) {
    return await redis.getCache(key)
  }

  async getScore(key, data) {
    let score = await this.getScoreFromCache(key)

    if (score) return score
    if (!data) return console.warn('Score not cached and lookup data undefined')

    try {
      const [imdbScores, rtScores] = await Promise.allSettled([
        this.getIMDBScores(data.imdbId),
        this.getRTScores(data.wikiId, data.title, data.releaseDate)
      ])
      const allScores = [data.tmdbScore, ...Object.values(imdbScores.value), ...Object.values(rtScores.value)]
      score = { avgScore: average(allScores) }
      redis.setCache(key, score, 43200) // 12 hours (60 * 60 * 12)
      return score
    } catch (e) {
      console.error('Error getting average score:', e)
    }
  }

  async getIMDBScores(imdbId) {
    if (!imdbId) return // tt3915174

    try {
      var page = await this.browserCtx.newPage()
      await page.route('**/*', this.#filterBrowserResource.bind(this))
      await page.goto(this.imdbBaseUrl + imdbId, { waitUntil: 'domcontentloaded' })

      var imdbScore = await page.getByTestId('hero-rating-bar__aggregate-rating__score').getByText(/^\d\d?\.\d$/).first().textContent() // finds IMDB decimal score
      imdbScore = parseFloat(imdbScore) * 10 // adjusted to 100 scale

      var metaScore = await page.locator('.metacritic-score-box').first().textContent()
      metaScore = parseInt(metaScore)
    } catch (e) {
      console.warn(e)
    }

    page.close()
    return { imdbScore, metaScore }
  }

  async getRTScores(wikiId, title, releaseDate) {
    const rtPath = await this.#guessRTPath(wikiId, title, releaseDate)
    if (!rtPath) return

    try {
      var page = await this.browserCtx.newPage();
      await page.route('**/*', this.#filterBrowserResource.bind(this))
      await page.goto(this.rtBaseUrl + rtPath, { waitUntil: 'domcontentloaded' });

      const element = await page.locator('#scoreboard').first()
      var rtCriticScore = await element.getAttribute('tomatometerscore')
      rtCriticScore = parseInt(rtCriticScore)

      var rtAudienceScore = await element.getAttribute('audiencescore')
      rtAudienceScore = parseInt(rtAudienceScore)
    } catch (e) {
      console.warn(e)
    }

    page.close()

    return {
      rtCriticScore,
      rtAudienceScore,
    }
  }

  async #guessRTPath(wikiId, title, releaseDate) {
    const key = `rtpath/${wikiId}/${title}/${releaseDate}`
    const ttl = 2592000 // 30 days (60 * 60 * 24 * 30)
    const pathCached = await redis.getCache(key)

    if (pathCached) return pathCached

    try {
      const rtPathPrefix = 'm/'
      const rtPathTitle = title.toLowerCase().replace(/ /g, '_').replace(/[^a-z0-9_]/g, '')
      const rtPathYear = '_' + new Date(releaseDate).getFullYear()

      const path1 = rtPathPrefix + rtPathTitle
      const path2 = rtPathPrefix + rtPathTitle + rtPathYear
      const [wikiRes, path1Res, path2Res] = await Promise.all([
        fetch(`${this.wikiBaseUrl}${wikiId}/statements`),
        fetch(this.rtBaseUrl + path1, { method: 'HEAD' }),
        fetch(this.rtBaseUrl + path2, { method: 'HEAD' })
      ])

      if (wikiRes.ok) {
        const json = await wikiRes.json()
        const pathWiki = json[this.wikiRTId]?.[0]?.value?.content
        if (pathWiki) {
          redis.setCache(key, pathWiki, ttl)
          return pathWiki
        }
      }

      if (path1Res.ok) {
        redis.setCache(key, path1, ttl)
        return path1
      }

      if (path2Res.ok) {
        redis.setCache(key, path2, ttl)
        return path2
      }
    } catch (e) {
      console.warn('Error guessing RTPath.', e)
    }
  }

  async #filterBrowserResource(route, req) {
    if (this.blockedBrowserResources.includes(req.resourceType())) {
      route.abort()
    } else {
      route.continue()
    }
  }
}

export default new ScoreService()