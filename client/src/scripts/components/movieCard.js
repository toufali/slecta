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
    padding-right: var(--padding-md);
  }

  img {
    object-fit: contain;
  }

  h3 {
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
  }

  dd {
    margin: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font: var(--small-font);
  }
</style>
<a href='/movies/${data.id}'>
  <article>
      <img title='${data.overview}' src='${data.posterThumb}'>
      <dl>
        <dt title='${data.overview}'><h3>${data.title}</h3></dt>
        <dd title='${data.genres.join(', ')}'>${data.genres.join(', ')}</dd>
        <dd>
          <time title='Release date' datetime="${data.releaseDate}">${new Date(data.releaseDate).toLocaleDateString(navigator.language, { year: 'numeric', month: 'numeric', day: 'numeric' })}</time>
          &nbsp;&nbsp;<span title='Review score'>${Math.round(data.reviewScore * 10)}%</span>
        </dd>
      </dl>
  </article>
</a>
`

customElements.define('movie-card', class extends HTMLElement {
  id
  #trailerLoaded

  constructor() {
    super()

    this.attachShadow({ mode: 'open' })
  }

  set data(obj) {
    this.shadowRoot.innerHTML = html(obj)
    this.setAttribute('id', obj.id)
    this.id = obj.id
  }

  connectedCallback() {
    // this.detailsEl = this.shadowRoot.querySelector('article')
    // this.trailerLinkEl = this.detailsEl.querySelector('a')
    // this.detailsEl.addEventListener('toggle', e => this.handleToggle(e))
  }

  handleToggle(e) {
    this.loadTrailer()
  }

  async loadTrailer() {
    if (this.#trailerLoaded) return

    this.#trailerLoaded = true
    const res = await fetch(`/api/v1/movies/${this.id}/trailer`)

    if (!res.ok) return console.info('Unable to load trailer:', res.status, res.statusText)

    const data = await res.json()

    if (!data.key) return console.info('Unable to load trailer: key is undefined')

    this.detailsEl.insertAdjacentHTML('beforeend', `<iframe 
      type="text/html" 
      width="720" 
      height="405" 
      src="https://www.youtube.com/embed/${data.key}?modestbranding=1&playsinline=1&color=white&iv_load_policy=3&rel=0" 
      frameborder="0" 
      allowfullscreen>`
    )
  }
})
