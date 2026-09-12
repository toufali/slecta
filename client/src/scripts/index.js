/* Use this file to load global scripts. Partial scripts should be loaded directly from the partial using <script type='module'> */

import './resizeObserver.js'
import './scrollObserver.js'
import './mainView.js'
import './components/movieCard.js'
import './components/scoreBadge.js'

// A cross-document view transition skipped mid-nav rejects promises the declarative form exposes
// only through these events; catch them so a fast navigation logs no uncaught AbortError. Both
// events, since the skip can surface on the page being left or the one arriving.
for (const type of ['pageswap', 'pagereveal']) {
  addEventListener(type, e => {
    e.viewTransition?.ready.catch(() => {})
    e.viewTransition?.finished.catch(() => {})
  })
}

// dynamic import client script associated with partial if it exists
const { partial } = document.body.dataset
if (partial) await import(`./partials/${partial}.js`)
  .then(module => module.default())
  .catch(e => console.info(`Could not load client script for ${partial}:`, e))
