import tmdb from '../services/tmdbService.js'
import { mainView } from '../views/mainView.js'
import { searchList } from '../views/partials/searchList.js'

export async function showSearch(ctx) {
  return ctx.body = mainView({
    partial: searchList,
    section: 'search'
  })
}

export async function getTitles(ctx) {
  // A wrong param name would otherwise search TMDB for the string "undefined"
  if (typeof ctx.query.title !== 'string' || !ctx.query.title.trim()) ctx.throw(400, 'Missing search title')

  const data = await tmdb.getTitlesByString(ctx.query.title)

  ctx.set('Cache-Control', 'max-age=43200, stale-while-revalidate=43200')

  return ctx.body = data
}