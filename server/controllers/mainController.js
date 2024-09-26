import { mainView } from '../views/mainView.js'
import { about } from '../views/partials/about.js'

// TODO: make this generic to switch between other static partials
export async function showAbout(ctx) {
  return ctx.body = mainView({
    partial: about
  })
}