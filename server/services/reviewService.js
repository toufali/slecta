import { chromium } from 'playwright';
import { reviewModel } from '../models/reviewModel.js';
import { average } from '../../scripts/math.js';

const defaults = {
    imdbBaseUrl: 'https://www.imdb.com/title/',
    rtBaseUrl: 'https://www.rottentomatoes.com/',
    wikiBaseUrl: 'https://www.wikidata.org/w/rest.php/wikibase/v0/entities/items/',
    wikiRTId: 'P1258',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' + ' AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36'
}

export const reviewService = {
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

        const browser = await chromium.launch();
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