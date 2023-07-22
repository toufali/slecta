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
<a href='/movies/${data.id}'>
  <figure>
    <img src='${data.imgBaseUrl}${data.posterSizes[0]}/${data.posterFilename}'>
    <figcaption>
      <dl>
        <dt>${data.title}</dt>
        <dd><time datetime="${data.releaseDate}">${new Date(data.releaseDate).toLocaleDateString(navigator.language, { dateStyle: 'medium' })}</time></dd>
        <dd>${Math.round(data.voteAverage / 10 * 100)}%</dd>
      </dl>
    </figcaption>
  </figure>
</a>
`

customElements.define('movie-card', class extends HTMLElement {
  connectedCallback() {
    this.attachShadow({ mode: 'open' })
    this.shadowRoot.innerHTML = html(this.data)
    this.setAttribute('id', this.data.id)
  }

  disconnectedCallback() {
  }
})
