/* Use this file to load global scripts. Partial scripts should be loaded directly from the partial using <script type='module'> */

import './resizeObserver.js'
import './scrollObserver.js'
import './mainView.js'
import './components/movieCard.js'
import './components/scoreBadge.js'

// A cross-document view transition skipped mid-nav rejects a promise the declarative form exposes
// only through this event; catch it so a fast navigation does not log an uncaught AbortError
addEventListener('pagereveal', e => {
  e.viewTransition?.ready.catch(() => {})
})

// dynamic import client script associated with partial if it exists
const { partial } = document.body.dataset
if (partial) await import(`./partials/${partial}.js`)
  .then(module => module.default())
  .catch(e => console.info(`Could not load client script for ${partial}:`, e))
