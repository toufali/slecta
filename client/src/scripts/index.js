/* Use this file to load global scripts. Partial scripts should be loaded directly from the partial using <script type='module'> */

// import '../../../components/rangeSlider.js'
import './app.js'
import './matchMedia.js'
import './resizeObserver.js'
import './components/movieCard.js'
import './components/scoreBadge.js'

// dynamic import client script associated with partial if it exists
const { partial } = document.body.dataset
if (partial) await import(`./partials/${partial}.js`)
  .then(module => module.default())
  .catch(e => console.info(`Could not load client script for ${partial}:`, e))
