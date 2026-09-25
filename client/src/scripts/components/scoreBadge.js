// Keep green scarce: it marks a shortlist
const GREEN_FLOOR = 80
const YELLOW_FLOOR = 65

const TURN_MS = 1000

// Start at twice the average speed, so the score leaves the start as fast as the bar moved
const EASE_OUT = 'cubic-bezier(.5, 1, .89, 1)'
// A point of score is 2.7deg of the gauge
const GROW_MS_PER_POINT = 2 * TURN_MS * 2.7 / 360

// Short enough to hide in the gap between the track's rounded ends
const BAR = 16

const band = score => score >= GREEN_FLOOR ? 'var(--green-70)' : score >= YELLOW_FLOOR ? 'var(--yellow-70)' : 'var(--red-70)'
const label = score => Number.isFinite(score) ? Math.round(score) : '—'
const describe = (score, lowConfidence) => Number.isFinite(score)
  ? `Score ${Math.round(score)}${lowConfidence ? ', few ratings so far' : ''}`
  : 'Score unavailable'

// 270deg, open at the bottom
const GAUGE = 'd="M 20.302 79.698 A 42 42 0 1 1 79.698 79.698"'
// A full circle from the middle of the gap, so the bar's loop joins where the gauge hides it
const CIRCLE = 'd="M 50 92 A 42 42 0 1 1 50 8 A 42 42 0 1 1 50 92"'

const html = (score, lowConfidence) => `
<style>
  :host{
    display: block;
    width: 50px;
    container-type: inline-size;
    --color: var(--band);
    --wait: 0s;
  }

  :host([hidden]) {
    display: none
  }

  :host([low-confidence]){
    --color: var(--gray-30);
  }

  /* Keep the score the only box in flow: it sets the badge's baseline */
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
    stroke: var(--color);
    stroke-dasharray: calc(var(--score) * 1px) 200px;
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
    font-size: var(--score-size, 38cqw);
    font-weight: bold;
    line-height: 1;
    letter-spacing: -.03em;
    color: white;
  }

  :host([loading]) .bar{
    display: inline;
    animation: sweep ${TURN_MS}ms linear infinite;
  }

  /* Hide, not remove: the score sets the baseline while loading too */
  :host([loading]) .score{
    visibility: hidden;
  }

  /* Let the bar finish its turn, then grow the score from the start */
  :host([arrived]) .bar{
    display: inline;
    animation: sweep ${TURN_MS}ms linear infinite, gone 1ms var(--wait) forwards;
  }

  :host([arrived]) .arc{
    animation: grow calc(var(--score) * ${GROW_MS_PER_POINT}ms) ${EASE_OUT} var(--wait) backwards, tint .6s ease-out var(--wait) backwards;
  }

  :host([arrived]) .score{
    animation: appear .4s ease-out var(--wait) backwards;
  }

  /* Start each turn with the bar hidden in the middle of the gap */
  @keyframes sweep{
    from{ stroke-dashoffset: ${BAR / 2}px }
    to{ stroke-dashoffset: ${BAR / 2 - 100}px }
  }

  @keyframes gone{
    to{ visibility: hidden }
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

<figure role="img" aria-label="${describe(score, lowConfidence)}">
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
  class ScoreBadge extends HTMLElement {
    #score

    constructor() {
      super();

      const parsed = parseFloat(this.getAttribute('score'))

      // Keep 0: RT publishes 0% critic ratings
      this.#score = Number.isFinite(parsed) ? parsed : undefined

      if (!this.shadowRoot) {
        this.attachShadow({ mode: 'open' }).innerHTML = html(this.#score, this.hasAttribute('low-confidence'))
        this.render()
      }
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
    }

    set lowConfidence(value) {
      this.toggleAttribute('low-confidence', Boolean(value))
      this.render()
    }

    // CSS cannot see where the bar is, so tell it how long until the bar's turn ends
    #land() {
      const sweep = this.shadowRoot.querySelector('.bar').getAnimations()[0]
      const turned = (sweep?.currentTime ?? 0) % TURN_MS

      this.style.setProperty('--wait', `${(TURN_MS - turned) % TURN_MS}ms`)
      this.setAttribute('arrived', '')
    }

    render() {
      const scored = Number.isFinite(this.#score)

      this.shadowRoot.querySelector('.score').textContent = label(this.#score)
      this.shadowRoot.querySelector('figure').setAttribute('aria-label', describe(this.#score, this.hasAttribute('low-confidence')))
      // An empty value removes the property
      this.style.setProperty('--score', scored ? Math.round(this.#score) : '')
      this.style.setProperty('--band', scored ? band(this.#score) : '')
    }
  }

  customElements.define('score-badge', ScoreBadge)
}

// Load a score the cache lacks, unless the sources already answered that there is none. Grow in a
// known score as if it had just landed.
export const scoreBadge = (score, lowConfidence, noScore, grow) => `
<score-badge score="${score}"${Number.isFinite(score) ? ` style="--score: ${Math.round(score)}; --band: ${band(score)}"` : ''}${lowConfidence ? ' low-confidence' : ''}${Number.isFinite(score) || noScore ? '' : ' loading'}${grow && Number.isFinite(score) ? ' arrived' : ''}>
  <template shadowrootmode="open">${html(score, lowConfidence)}</template>
</score-badge>
`
