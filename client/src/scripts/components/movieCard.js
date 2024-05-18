import { scoreBadge } from './scoreBadge.js'

const html = data => `
<style>
  :host{
    contain: style paint;
    display: block;
    box-shadow: 3px 3px 12px -3px black;
  }

  :host([hidden]) {
    display: none
  }

  article {
    display: flex;
    gap: var(--padding-sm);
    border-radius: var(--border-radius);
    overflow: hidden;
    color: var(--blue-90);
    background: linear-gradient(-135deg, var(--blue-30), var(--blue-10));
  }

  img {
    object-fit: contain;
  }

  .title {
    font: var(--h3-font);
    color: white;
    margin: 0 0 var(--padding-sm);
  }

  a {
    display: contents;
    color: inherit;
  }

  dl {
    overflow: hidden;
    margin-top: auto;
    flex: 1;
  }

  dd {
    margin: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font: var(--small-font);
  }

  score-badge{
    margin: var(--padding-md);
  }
</style>

<a href='/movies/${data.id}'>
  <article>
    <img title='${data.overview}' src='${data.posterThumb}'>
    <dl>
      <dt title='${data.overview}'><h2 class='title'>${data.title}</h2></dt>
      <dd title='${data.genres.join(', ')}'>${data.genres.join(', ')}</dd>
      <dd>
        <time title='Release date' datetime="${data.releaseDate}">${new Date(data.releaseDate).toLocaleDateString('en-US', { year: 'numeric', month: 'numeric', day: 'numeric' })}</time>
      </dd>
    </dl>
    ${scoreBadge(data.score)}
  </article>
</a>
`

if (typeof HTMLElement !== 'undefined') {
  // TODO: this probably doesn't need to be Shadow DOM + Custom Element. See reviewQuote.js for more basic component example
  // Define custom element for browser environment, ignore for server

  class MovieCard extends HTMLElement {
    #data

    constructor() {
      super();

      if (!this.shadowRoot) { // DSD did not render
        this.attachShadow({ mode: 'open' })
      }
    }

    get data() {
      return this.#data
    }

    set data(value) {
      this.#data = value
      this.render()
    }

    render() {
      this.setAttribute('id', this.data.id)
      this.shadowRoot.innerHTML = html(this.data)
    }
  }

  customElements.define('movie-card', MovieCard)
}

// Export Declarative Shadow DOM for server-side render
export const movieCard = data => `
<movie-card id='${data.id}'>
  <template shadowrootmode="open">${html(data)}</template>
</movie-card>
`