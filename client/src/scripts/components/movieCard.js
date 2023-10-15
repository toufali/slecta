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
          &nbsp;&nbsp;<span title='Review score'>${Math.round(data.tmdbScore * 10)}%</span>
        </dd>
      </dl>
  </article>
</a>
`

customElements.define('movie-card', class extends HTMLElement {
  constructor() {
    super()

    this.attachShadow({ mode: 'open' })
  }

  set data(obj) {
    this.shadowRoot.innerHTML = html(obj)
    this.setAttribute('id', obj.tmdbId)
  }
})
