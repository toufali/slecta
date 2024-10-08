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

export const tvShowDetail = data => `
<link rel='stylesheet' href='/styles/partials/movieDetail.css' type='text/css'>
<figure>${data.backdropUrl ? `<img src='${data.backdropUrl}' alt=''>` : ''}${ytTrailer(data.ytTrailerId)}</figure>
<article id='${data.tmdbId}' data-wiki-id='${data.wikiId}' data-imdb-id='${data.imdbId}'>
  <header>
    <h1>${data.title}</h1>
    ${scoreBadge(data.score)}
    <ul class='details'>
      <li><time title='Release date' datetime="${data.releaseDate}">${new Date(data.releaseDate).toLocaleDateString('en-US', { year: 'numeric' })}</time></li>
      <li title='Rating'>${data.rating}</li>
      <li class='genres' title='${data.genres}'><p>${data.genres}</p></li>
    </ul>
  </header>
  <div class="quotes">${data.quotes.map(item => reviewQuote(item)).join('')}</div>
  <p><label>Synopsis:</label>${data.overview}</p>
  <p><label>Cast:</label>${data.cast}</p>
  <p><label>Director:</label>${data.director}</p>
  <p><label>Running time:</label>${data.runtime} min</p>
  <p><label>Spoken languages:</label>${data.languages}</p>
  <div class='providers'>
    <p><label>Available on:</label></p>
    <ul>${providers(data.providers)}</ul>
  </div>
</article>
`