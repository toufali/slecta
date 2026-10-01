/* Use this file to load global scripts. Partial scripts should be loaded directly from the partial using <script type='module'> */

import './resizeObserver.js'
import './scrollObserver.js'
import './mainView.js'
import './components/titleCard.js'
import './components/scoreBadge.js'
import { sendEvent } from './utils/events.js'

// Sent from script, so a request for the HTML alone never counts as a page view
const sendPageview = () => sendEvent('pageview', { referrer: document.referrer && new URL(document.referrer).hostname })

// A prerendered page counts once it is shown, if ever
if (document.prerendering) document.addEventListener('prerenderingchange', sendPageview, { once: true })
else sendPageview()

// dynamic import client script associated with partial if it exists
const { partial } = document.body.dataset
if (partial) await import(`./partials/${partial}.js`)
  .then(module => module.default())
  .catch(e => console.info(`Could not load client script for ${partial}:`, e))
