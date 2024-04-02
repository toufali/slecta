// TODO: we don't need DSD.  We likely don't need any shadow dom here.
// TODO: optimize/reuse loading animation

export const movieCard = data => `
<movie-card id='${data.id}'>
  <template shadowrootmode="open">
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

      .loading {
        display: inline-block;
        max-height: 100%;
      }
      
      .loading::after {
        content: "";
        display: inline-block;
        aspect-ratio: 1/1;
        border-radius: 50%;
        border: 2px solid #fff;
        border-color: #fff transparent #fff transparent;
        animation: loading-rotate 1.2s linear infinite;
        height: .875rem;
        box-sizing: border-box;
        vertical-align: middle;
      }
      
      @keyframes loading-rotate {
        0% {
          transform: rotate(0deg);
        }
        100% {
          transform: rotate(360deg);
        }
      }
      
    </style>
    
    <a href='/movies/${data.id}'>
      <article>
          <img title='${data.overview}' src='${data.posterThumb}'>
          <dl>
            <dt title='${data.overview}'><h3>${data.title}</h3></dt>
            <dd title='${data.genres.join(', ')}'>${data.genres.join(', ')}</dd>
            <dd>
              <time title='Release date' datetime="${data.releaseDate}">${new Date(data.releaseDate).toLocaleDateString('en-US', { year: 'numeric', month: 'numeric', day: 'numeric' })}</time>
              &nbsp;&nbsp;<output data-avg-score='${data.score}'>${data.score ? Math.round(data.score) + '%' : ''}</output>
            </dd>
          </dl>
      </article>
    </a>
  </template>
</movie-card>
`