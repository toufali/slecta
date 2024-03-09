import { firefox } from 'playwright';
import { reviewModel } from '../models/reviewModel.js';
import { average } from '../../scripts/math.js';

class ScoreService {
    defaultTimeout = 500
    defaultNavigationTimeout = 5000
    blockedResources = ['stylesheet', 'image', 'images', 'media', 'font', 'script', 'texttrack', 'xhr', 'fetch', 'eventsource', 'websocket', 'manifest', 'other']
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
        });
        this.browserCtx.setDefaultTimeout(this.defaultTimeout);
        this.browserCtx.setDefaultNavigationTimeout(this.defaultNavigationTimeout);
        console.log('Browser connected:', this.browser.isConnected())
    }

    async getAvgScore(data) {
        console.log('getAvgScore...')
        const [imdbScores, rtScores] = await Promise.allSettled([
            this.getIMDBScores(data.imdbId),
            this.getRTScores(data.wikiId, data.title, data.releaseDate)
        ])
        const allScores = [data.tmdbScore, ...Object.values(imdbScores.value), ...Object.values(rtScores.value)]
        console.log('getting average:', allScores)
        return average(allScores)
    }

    async getIMDBScores(imdbId) {
        if (!imdbId) return // tt3915174

        try {
            var page = await this.browserCtx.newPage()
            await page.route('**/*', this.#filterResource.bind(this))
            await page.goto(this.imdbBaseUrl + imdbId, { waitUntil: 'domcontentloaded' })

            // TODO: use page.getByTestId(). Regex can be for validation? Or maybe with 'hasText'?
            var imdbScore = await page.getByText(/^\d\d?\.\d$/).first().textContent() // finds IMDB decimal score
            imdbScore = parseFloat(imdbScore) * 10 // adjusted to 100 scale

            var metaScore = await page.locator('.metacritic-score-box').first().textContent()
            metaScore = parseInt(metaScore)
        } catch (e) {
            console.log(e)
        }

        page.close()
        return { imdbScore, metaScore }
    }

    async getRTScores(wikiId, title, releaseDate) {
        // TODO: handle timeout error - locator.getAttribute: Timeout 30000ms exceeded.
        const rtPath = await this.#guessRTPath(wikiId, title, releaseDate)
        if (!rtPath) return

        try {
            var page = await this.browserCtx.newPage();
            await page.route('**/*', this.#filterResource.bind(this))
            await page.goto(this.rtBaseUrl + rtPath, { waitUntil: 'domcontentloaded' });

            const element = await page.locator('#scoreboard').first()
            var rtCriticScore = await element.getAttribute('tomatometerscore')
            rtCriticScore = parseInt(rtCriticScore)

            var rtAudienceScore = await element.getAttribute('audiencescore')
            rtAudienceScore = parseInt(rtAudienceScore)

            // const avgScore = average([parseInt(score1), parseInt(score2)]) / 10 || null // handles NaN
        } catch (e) {
            console.log(e)
        }

        page.close()

        return {
            rtCriticScore,
            rtAudienceScore,
        }
    }

    async #guessRTPath(wikiId, title, releaseDate) {
        // TODO: cache this return value

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
                if (pathWiki) return pathWiki
            }
            if (path1Res.ok) return path1
            if (path2Res.ok) return path2
        } catch (e) {
            console.error('Error guessing RTPath.', e)
        }
    }

    async #filterResource(route, req) {
        if (this.blockedResources.includes(req.resourceType())) {
            route.abort()
        } else {
            route.continue()
        }
    }

}

export default new ScoreService()

const defaults = {
    imdbBaseUrl: 'https://www.imdb.com/title/',
    rtBaseUrl: 'https://www.rottentomatoes.com/',
    wikiBaseUrl: 'https://www.wikidata.org/w/rest.php/wikibase/v0/entities/items/',
    wikiRTId: 'P1258',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' + ' AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36'
}

const reviewService = {
    async getAvgScore(tmdbId) {
        const res = await reviewModel.getScores(tmdbId)
        if (!res) return

        return average(Object.values(res))
    },
    async populateScores(data) {
        // TODO: get following dataset from new stored table
        // - migrate reviews table to new "movie" table
        // - store all movie details in table for future access, instead of storing in html
        let { title, releaseDate, wikiId, tmdbId, tmdbScore, imdbId } = data
        wikiId = wikiId === 'null' ? null : wikiId
        tmdbScore = parseFloat(tmdbScore)

        const browser = await firefox.launch();
        const browserCtx = await browser.newContext({
            userAgent: defaults.userAgent,
        });

        const [imdbScore, rtData] = await Promise.all([
            this.getIMDBScore(imdbId, browserCtx),
            this.getRTData(wikiId, title, releaseDate, browserCtx)
        ])

        await reviewModel.upsert({
            title,
            releaseDate,
            wikiId,
            tmdbId,
            tmdbScore,
            imdbId,
            imdbScore,
            rtPath: rtData?.path,
            rtScore: rtData?.avgScore
        })

        await browser.close();
        return average([imdbScore, rtData?.avgScore])
    },
    async getIMDBScore(imdbId, browserCtx) {
        // tt3915174
        console.log('getIMDB', imdbId)
        const page = await browserCtx.newPage();
        await page.goto(defaults.imdbBaseUrl + imdbId, { waitUntil: 'domcontentloaded' });

        // TODO: use page.getByTestId(). Regex can be for validation? Or maybe with 'hasText'?
        const element = page.getByText(/^\d\d?\.\d$/).first()
        let score = await element.textContent()
        score = parseFloat(score)
        console.log('getIMDBScore:', score);
        return score
    },
    async guessRTPath(wikiId, title, releaseDate) {
        // https://www.wikidata.org/w/rest.php/wikibase/v0/entities/items/Q192724/statements
        try {
            const res = await fetch(`${defaults.wikiBaseUrl}${wikiId}/statements`)
            if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
            const json = await res.json()
            const path = json[defaults.wikiRTId][0].value.content
            return path
        } catch (e) {
            console.error('Error fetching RTPath from WikiData.', e) // falls through
        }

        try {
            const rtPathPrefix = 'm/'
            const rtPathTitle = title.replace(/ /g, '_').replace(/<>"#%{}\|\\\^~\[\]`;\/\?:@=&/g, '').toLowerCase()
            const rtPathYear = '_' + new Date(releaseDate).getFullYear()

            let path = rtPathPrefix + rtPathTitle + rtPathYear
            let res = await fetch(defaults.rtBaseUrl + path, { method: 'HEAD' })
            if (res.ok) return path

            path = rtPathPrefix + rtPathTitle
            res = await fetch(defaults.rtBaseUrl + path, { method: 'HEAD' })
            if (res.ok) return path

            throw new Error(`${res.status} ${res.statusText}`)
        } catch (e) {
            console.error('Error guessing RTPath.', e)
        }
    },
    async getRTData(wikiId, title, releaseDate, browserCtx) {
        let path
        // TODO: handle timeout error - locator.getAttribute: Timeout 30000ms exceeded.
        if (wikiId) path = await reviewModel.getRTPath(wikiId)
        if (!path) path = await this.guessRTPath(wikiId, title, releaseDate)
        if (!path) return

        const page = await browserCtx.newPage();
        await page.goto(defaults.rtBaseUrl + path, { waitUntil: 'domcontentloaded' });

        // TODO: parallelize
        // TODO: handle TimeoutError waiting for locator('#scoreboard').first()
        const element = await page.locator('#scoreboard').first()
        const score1 = await element.getAttribute('tomatometerscore')
        const score2 = await element.getAttribute('audiencescore')
        const avgScore = average([parseInt(score1), parseInt(score2)]) / 10 || null // handles NaN

        return {
            avgScore,
            path
        }
    }
}