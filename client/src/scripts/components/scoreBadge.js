// Keep green scarce: it marks a shortlist
const GREEN_FLOOR = 80
const YELLOW_FLOOR = 65

const TURN_MS = 1000

// Grow the score as fast as the bar moved: the ease starts at twice its average speed, and a point
// of score is 2.7deg of the gauge
const EASE_OUT = 'cubic-bezier(.5, 1, .89, 1)'
const GROW_MS_PER_POINT = 2 * TURN_MS * 2.7 / 360

// Short enough to hide in the gap between the track's rounded ends, where each turn starts
const BAR = 16

const band = score => score >= GREEN_FLOOR ? 'var(--green-70)' : score >= YELLOW_FLOOR ? 'var(--yellow-70)' : 'var(--red-70)'
const label = score => Number.isFinite(score) ? Math.round(score) : '—'
const describe = (score, lowConfidence, loading) => {
  if (Number.isFinite(score)) return `Score ${Math.round(score)}${lowConfidence ? ', few ratings so far' : ''}`
  return loading ? 'Loading score' : 'Score unavailable'
}

// 270deg, open at the bottom
const GAUGE = 'd="M 20.302 79.698 A 42 42 0 1 1 79.698 79.698"'
// A full circle from the middle of the gap, so the bar's loop joins where the gauge hides it
const CIRCLE = 'd="M 50 92 A 42 42 0 1 1 50 8 A 42 42 0 1 1 50 92"'

const html = (score, lowConfidence, loading) => `
<style>
  :host{
    display: block;
    width: 50px;
    --wait: 0s;
    --turns: 0;
  }

  /* Keep the score the only box in flow, even while loading: it sets the badge's baseline */
  figure{
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    aspect-ratio: 1;
    margin: 0;
  }

  svg{
    position: absolute;
    inset: 0;
    contain: content;
  }

  path{
    fill: none;
    stroke-width: 10;
    stroke-linecap: round;
  }

  .track{
    stroke: var(--blue-10);
  }

  .arc{
    stroke: var(--band);
    stroke-dasharray: calc(var(--score) * 1px) 200px;
  }

  :host([low-confidence]) .arc{
    stroke: var(--gray-50);
  }

  /* Hide the empty arc: its round cap would still draw a dot */
  :host([score="undefined"]) .arc{
    display: none;
  }

  .bar{
    display: none;
    stroke: var(--gray-30);
    stroke-dasharray: ${BAR}px ${100 - BAR}px;
  }

  .score{
    position: relative;
    font-size: var(--score-size, 19px);
    font-weight: bold;
    line-height: 1;
    letter-spacing: -.03em;
    color: white;
  }

  :host([loading]) .bar{
    display: inline;
    animation: sweep ${TURN_MS}ms linear infinite;
  }

  :host([loading]) .score{
    visibility: hidden;
  }

  :host([arrived]) .bar{
    display: inline;
    animation: sweep ${TURN_MS}ms linear var(--turns) forwards;
  }

  :host([arrived]) .arc{
    animation: grow calc(var(--score) * ${GROW_MS_PER_POINT}ms) ${EASE_OUT} var(--wait) backwards, tint .6s ease-out var(--wait) backwards;
  }

  :host([arrived]) .score{
    animation: appear .4s ease-out var(--wait) backwards;
  }

  /* Wait to be seen, but grow straight away without script to release it */
  @media (scripting: enabled){
    :host([hold]) :is(.arc, .score){
      animation-play-state: paused;
    }
  }

  @keyframes sweep{
    from{ stroke-dashoffset: ${BAR / 2}px }
    to{ stroke-dashoffset: ${BAR / 2 - 100}px }
  }

  @keyframes grow{
    from{ stroke-dasharray: 0px 200px; visibility: hidden }
  }

  @keyframes tint{
    from{ stroke: var(--gray-30) }
  }

  @keyframes appear{
    from{ opacity: 0 }
  }
</style>

<figure role="img" aria-label="${describe(score, lowConfidence, loading)}">
  <svg viewBox="0 0 100 100">
    <mask id="gauge"><path ${GAUGE} stroke="white"/></mask>
    <path class="track" ${GAUGE}/>
    <path class="bar" ${CIRCLE} pathLength="100" mask="url(#gauge)"/>
    <path class="arc" ${GAUGE} pathLength="100"/>
  </svg>
  <span class="score">${label(score)}</span>
</figure>
`

if (typeof HTMLElement !== 'undefined') {
  const onScreen = new IntersectionObserver(entries => {
    for (const { target, isIntersecting } of entries) {
      if (!isIntersecting) continue
      target.removeAttribute('hold')
      onScreen.unobserve(target)
    }
  })

  class ScoreBadge extends HTMLElement {
    #score

    constructor() {
      super();

      const parsed = parseFloat(this.getAttribute('score'))

      // Keep 0: RT publishes 0% critic ratings
      this.#score = Number.isFinite(parsed) ? parsed : undefined

      if (!this.shadowRoot) {
        this.attachShadow({ mode: 'open' }).innerHTML = html(this.#score, this.hasAttribute('low-confidence'), this.loading)
        this.render()
      }
    }

    // Grow after the page's own transition, so the two do not play over each other
    connectedCallback() {
      if (!this.hasAttribute('hold')) return

      const transition = document.activeViewTransition?.finished ?? Promise.resolve()
      transition.then(() => this.isConnected && onScreen.observe(this))
    }

    disconnectedCallback() {
      onScreen.unobserve(this)
    }

    get score() {
      return this.#score
    }

    set score(value) {
      this.#score = value
      this.setAttribute('score', value)
      this.render()
    }

    get loading() {
      return this.hasAttribute('loading')
    }

    set loading(value) {
      if (this.loading && !value) this.#land()
      this.toggleAttribute('loading', Boolean(value))
      this.render()
    }

    set lowConfidence(value) {
      this.toggleAttribute('low-confidence', Boolean(value))
      this.render()
    }

    // CSS cannot see where the bar is, so tell it how many turns to finish and how long that takes
    #land() {
      const elapsed = this.shadowRoot.querySelector('.bar').getAnimations()[0]?.currentTime ?? 0
      const turns = Math.ceil(elapsed / TURN_MS)

      this.style.setProperty('--turns', turns)
      this.style.setProperty('--wait', `${turns * TURN_MS - elapsed}ms`)
      this.setAttribute('arrived', '')
    }

    render() {
      const scored = Number.isFinite(this.#score)

      this.shadowRoot.querySelector('.score').textContent = label(this.#score)
      this.shadowRoot.querySelector('figure').setAttribute('aria-label', describe(this.#score, this.hasAttribute('low-confidence'), this.loading))
      // An empty value removes the property
      this.style.setProperty('--score', scored ? Math.round(this.#score) : '')
      this.style.setProperty('--band', scored ? band(this.#score) : '')
    }
  }

  customElements.define('score-badge', ScoreBadge)
}

// Load a score the cache lacks unless the sources answered none; grow in a known one once seen
export const scoreBadge = (score, lowConfidence, noScore) => {
  const scored = Number.isFinite(score)
  const loading = !scored && !noScore

  return `
<score-badge score="${score}"${scored ? ` style="--score: ${Math.round(score)}; --band: ${band(score)}" arrived hold` : ''}${lowConfidence ? ' low-confidence' : ''}${loading ? ' loading' : ''}>
  <template shadowrootmode="open">${html(score, lowConfidence, loading)}</template>
</score-badge>
`
}
