import { scoreBadge } from '../../../client/src/scripts/components/scoreBadge.js'
import { reviewQuote } from '../../../client/src/scripts/components/reviewQuote.js'

function ytTrailer(id) {
  if (!id) return ''

  return `
  <button class='trailer-btn' type='button'>
    <img src='/images/yt-play-button-dark.svg' width='1024' height='721'>
  </button>
  <iframe data-src="https://www.youtube.com/embed/${id}?modestbranding=1&playsinline=1&color=white&iv_load_policy=3&rel=0&autoplay=1"
    type="text/html"
    width="1280"
    height="720"
    frameborder="0"
    allowfullscreen
    allow='autoplay'>
  </iframe>
  `
}

function providers(items) {
  if (!items) return 'No providers found'

  const limit = 6

  return items.map(item => `<li><img src='${item.logoUrl}' alt='${item.provider_name} logo'> <span>${item.provider_name}</span></li>`)
    .slice(0, limit)
    .join('')
}

export const titleDetail = data => `
<figure>${data.backdropUrl ? `<img src='${data.backdropUrl}' alt=''>` : ''}${ytTrailer(data.ytTrailerId)}</figure>
<article id='${data.tmdbId}' data-wiki-id='${data.wikiId}' data-imdb-id='${data.imdbId}'>
  <header>
    <h1>${data.title}</h1>
    ${scoreBadge(data.score, data.lowConfidence)}
    <ul class='details'>
      <li><time title='Release date' datetime="${data.releaseDate}">${new Date(data.releaseDate).toLocaleDateString('en-US', { year: 'numeric' })}</time></li>
      <li title='Rating'>${data.rating}</li>
      ${data.seasons > 1 ? `<li title='Seasons'>${data.seasons} seasons</li>` : ''}
      <li class='genres' title='${data.genres}'><p>${data.genres}</p></li>
      <li class='low-confidence'${data.lowConfidence ? '' : ' hidden'}>Score may be inaccurate due to limited reviews.</li>
    </ul>
  </header>
  <div class="quotes">${data.quotes.map(item => reviewQuote(item)).join('')}</div>
  <p><label>Synopsis:</label><span>${data.overview}</span></p>
  <p><label>Cast:</label><span>${data.cast}</span></p>
  ${!data.director ? '' : `<p><label>Director:</label><span>${data.director}</span></p>`}
  ${!data.creator ? '' : `<p><label>Creator:</label><span>${data.creator}</span></p>`}
  ${!data.runtime ? '' : `<p><label>Running time:</label><span>${data.runtime} min</span></p>`}
  <p><label>Language:</label><span>${data.language}</span></p>
  <div class='providers'>
    <p><label>Available on:</label></p>
    <ul>${providers(data.providers)}</ul>
  </div>
</article>
`

// Loaded from the document head by mainView, so it does not block the body render
titleDetail.styles = '/styles/partials/titleDetail.css'
