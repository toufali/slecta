import tmdb from '../services/tmdbService.js'
import { mainView } from '../views/mainView.js'
import { searchList } from '../views/partials/searchList.js'

export async function showSearch(ctx) {
  return ctx.body = mainView({
    partial: searchList
  })
}

export async function getTitles(ctx) {
  const data = await tmdb.getTitlesByString(ctx.query.title)

  ctx.set('Cache-Control', 'max-age=43200, stale-while-revalidate=43200')

  return ctx.body = data
}