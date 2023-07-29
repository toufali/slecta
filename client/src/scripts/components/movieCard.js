const html = data => `
<style>
  :host{
    contain: style paint;
    display: block;
    border: 1px solid gray;
  }

  :host([hidden]) {
    display: none 
  }
</style>
<details>
  <summary>
    <img src='${data.posterThumb}'>
    <strong>${data.title}</strong><br>
    <time datetime="${data.releaseDate}">${new Date(data.releaseDate).toLocaleDateString(navigator.language, { year: 'numeric', month: 'numeric', day: 'numeric' })}</time><br>
    <span>${Math.round(data.reviewScore * 10)}%</span>
  </summary>
  <p>${data.overview}</p>
  <p>${data.genres}</p>
</details>
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
    this.detailsEl = this.shadowRoot.querySelector('details')
    this.trailerLinkEl = this.detailsEl.querySelector('a')
    this.detailsEl.addEventListener('toggle', e => this.handleToggle(e))
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
    console.log(data)
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
