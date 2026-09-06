const html = `
<style>
  :host{
    contain: content;
    container-type: inline-size;
    min-width: 50px;
    --color: var(--gray-50);
  }

  :host([hidden]) {
    display: none
  }

  figure{
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    aspect-ratio: 1/1;
    margin: 0;
    animation: scale-in .3s cubic-bezier(0.25, 2, 0.75, 1);
  }

  :host([score="undefined"]) figure{
    animation: none;
  }

  :host([score="undefined"]) figure::after {
    content: "-";
    position: absolute;
    transform: none;
  }

  :host(.loading) figure::after {
    content: "";
    position: absolute;
    width: 20cqw;
    aspect-ratio: 1/1;
    border-radius: 50%;
    border: 3cqw solid #fff;
    border-color: #fff transparent #fff transparent;
    animation: rotate-loading 1.2s linear infinite;
  }

  .badge {
    position: absolute;
    height: 100%;
    width: 100%;
    animation: rotate-loading .75s forwards;
    animation-composition: accumulate;
    transition: background-color .5s ease-out;
    background-color: var(--color);
    background-image: radial-gradient(#ccc, transparent 50%);
    background-blend-mode: overlay;
    -webkit-mask: url(../../images/badge.svg) no-repeat 50% / 80%;
    mask: url(../../images/badge.svg) no-repeat 50% / 80%;
    }

  :host(.loading) .badge{
    animation-duration: 1.5s;
    animation-delay: 0s;
    animation-iteration-count: infinite;
  }

  svg{
    position: relative;
    width: 100%;
    height: 100%;
    filter: drop-shadow(0 0 2px rgb(0 0 0 / .5));
    transform: rotate(5deg);
  }

  /* Drawn clear of the medallion, which is a starburst masked to 80% and so reaches 40% radius.
     A dashed line rather than a colour, since colour already carries the score band. */
  .ring{
    fill: none;
    stroke: none;
  }

  :host([low-confidence]) .ring{
    stroke: white;
    stroke-width: 3cqw;
    stroke-dasharray: 5cqw 4cqw;
  }

  svg text{
    font-size: 38cqw;
    font-weight: bold;
    letter-spacing: -1px;
    fill: white;
    text-anchor: middle;
    dominant-baseline: central;
  }

  @keyframes rotate-loading{
    to{
      transform: rotate(180deg);
    }
  }

  @keyframes scale-in{
    from{
      transform: scale(.5);
    }
  }

</style>

<figure>
  <div class="badge"></div>
  <svg xmlns="http://www.w3.org/2000/svg">
    <circle class="ring" cx="50%" cy="50%" r="46%"></circle>
    <text x="50%" y="50%"></text>
  </svg>
</figure>
`

if (typeof HTMLElement !== 'undefined') {
  // Define custom element for browser environment, ignore for server
  class ScoreBadge extends HTMLElement {
    #score
    #outputEl

    constructor() {
      super();

      if (!this.shadowRoot) { // DSD did not render
        this.attachShadow({ mode: 'open' });
        this.shadowRoot.innerHTML = html
      }

      this.#score = parseFloat(this.getAttribute('score')) || undefined
      this.#outputEl = this.shadowRoot.querySelector('svg text')
      this.render()
    }

    get score() {
      return this.#score
    }

    set score(value) {
      this.#score = value
      this.setAttribute('score', value)
      this.render()
    }

    // Its own property rather than part of the score, so the two can be set in either order
    set lowConfidence(value) {
      this.toggleAttribute('low-confidence', Boolean(value))
    }

    render() {
      this.#outputEl.textContent = Math.round(this.#score) || ''

      switch (true) {
        case this.#score >= 75:
          this.style.setProperty('--color', 'var(--green-50)')
          break
        case this.#score >= 60:
          this.style.setProperty('--color', 'var(--yellow-50)')
          break
        case this.#score < 60:
          this.style.setProperty('--color', 'var(--red-50)')
          break
      }
    }
  }

  customElements.define('score-badge', ScoreBadge)
}

// Export Declarative Shadow DOM for server-side render
export const scoreBadge = (score, lowConfidence) => `
<score-badge score="${score}"${lowConfidence ? ' low-confidence' : ''}>
  <template shadowrootmode="open">${html}</template>
</score-badge>
`