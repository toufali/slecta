import { firefox } from 'playwright';
import { reviews } from '../models/reviewModel.js';
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
        const res = await reviews.getScores(tmdbId)
        if (!res) return

        return average(Object.values(res))
    },
    async populateScores(movie) {
        const { title, releaseDate, wikiId, tmdbId, tmdbScore, imdbId } = movie
        const browser = await firefox.launch();
        const browserCtx = await browser.newContext({
            userAgent: defaults.userAgent,
        });

        const [imdbScore, rtData] = await Promise.all([
            this.getIMDBScore(imdbId, browserCtx),
            this.getRTData(wikiId, title, releaseDate, browserCtx)
        ])
        console.log('about to upsert stuff, including imdbScore:', imdbScore, 'rtData:', rtData)

        const res = await reviews.upsert({
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
        return res
    },
    async getIMDBScore(imdbId, browserCtx) {
        // tt3915174
        console.log('getIMDB', imdbId)
        const page = await browserCtx.newPage();
        await page.goto(defaults.imdbBaseUrl + imdbId, { waitUntil: 'domcontentloaded' });

        // TODO: use page.getByTestId(). Regex can be for validation? Or maybe with 'hasText'?
        const element = page.getByText(/^\d\d?\.\d$/).first()
        const score = await element.textContent()

        console.log('getIMDBScore:', score);
        return score
    },
    async fetchRTPath(wikiId, title, releaseDate) {
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
        if (wikiId) path = await reviews.getRTPath(wikiId)
        if (!path) path = await this.fetchRTPath(wikiId, title, releaseDate)
        if (!path) return

        const page = await browserCtx.newPage();
        await page.goto(defaults.rtBaseUrl + path, { waitUntil: 'domcontentloaded' });

        // TODO: parallelize
        // TODO: handle TimeoutError waiting for locator('#scoreboard').first()
        const element = await page.locator('#scoreboard').first()
        const score1 = await element.getAttribute('tomatometerscore')
        const score2 = await element.getAttribute('audiencescore')
        const avgScore = average([parseInt(score1), parseInt(score2)])
        console.log('getRTScore:', avgScore);
        return {
            avgScore: avgScore / 10, // reduce percentage to score out of 10
            path
        }
    }
}

// export async function getScore(ctx) {
//     if (!ctx.state.cacheData) await next()

//     const data = ctx.state.cacheData

//     const res = await db.upsertReview({
//         title: data.title,
//         tmdbId: data.tmdbId,
//         tmdbScore: data.tmdbScore,
//         imdbId: obj.imdbId,
//         imdbScore: text,
//     })
//     return res


//     ctx.set('Cache-Control', 'max-age=43200, stale-while-revalidate=43200')
//     return ctx.body = movies
// }



// export async function upsertReview(ctx) {
//     if (!ctx.state.cacheData) await next()

//     const data = ctx.state.cacheData

//     const res = await db.upsertReview({
//         title: data.title,
//         tmdbId: data.tmdbId,
//         tmdbScore: data.tmdbScore,
//         imdbId: obj.imdbId,
//         imdbScore: text,
//     })
//     return res


//     ctx.set('Cache-Control', 'max-age=43200, stale-while-revalidate=43200')
//     return ctx.body = movies
// }



// export const reviews = {
//     async getReview(tmdbId) {
//         const res = await db.getReview(tmdbId)
//         console.log('getReview response:', res)
//         return res
//         if (!res) this.getIMDB('tt3915174')
//     },
//     async getIMDB(obj) {
//         // tt3915174
//         console.log('getIMDB', obj)
//         const browser = await firefox.launch();
//         const context = await browser.newContext({
//             userAgent: defaults.userAgent,
//         });
//         const page = await context.newPage();

//         await page.goto(`https://www.imdb.com/title/${obj.imdbId}`, { waitUntil: 'domcontentloaded' });
//         const element = page.getByText(/^\d\d?\.\d$/).first()
//         const text = await element.textContent()
//         console.log(text);
//         await browser.close();
//         const res = await db.upsertReview({
//             title: obj.title,
//             tmdbId: obj.tmdbId,
//             tmdbScore: obj.tmdbScore,
//             imdbId: obj.imdbId,
//             imdbScore: text,
//         })
//         return res
//     }
// }