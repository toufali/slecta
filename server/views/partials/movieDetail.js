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

  return items.map(item => `<li><img src='${item.logoUrl}' alt=''> ${item.provider_name}</li>`)
    .slice(0, limit)
    .join('')
}

export const movieDetail = data => `
<link rel='stylesheet' href='/styles/partials/movieDetail.css' type='text/css'>
<figure>
  <img src='${data.movie.backdropUrl}'>
  ${ytTrailer(data.movie.ytTrailerId)}
</figure>
<article id='${data.movie.tmdbId}' data-wiki-id='${data.movie.wikiId}' data-imdb-id='${data.movie.imdbId}'>
  <header>
    <h1>${data.movie.title}</h1>
    <ul class='details'>
      <li><time title='Release date' datetime="${data.movie.releaseDate}">${new Date(data.movie.releaseDate).toLocaleDateString('en-US', { year: 'numeric' })}</time></li>
      <li title='Rating'>${data.movie.rating}</li>
      <li class='genres' title='${data.movie.genres}'><p>${data.movie.genres}</p></li>
    </ul>
  </header>
  <p>${data.movie.overview}</p>
  <p>
    <label>Review score:</label>
    <output data-tmdb-score='${data.movie.tmdbScore}' data-avg-score='${data.movie.avgScore}'>${data.movie.avgScore ? Math.round(data.movie.avgScore * 10) + '%' : 'Not available'}</output>
  </p>
  <p><label>Running time:</label>${data.movie.runtime} min</p>
  <p><label>Spoken languages:</label>${data.movie.languages}</p>
  <div class='providers'>
    <p><label>Available on:</label></p>
    <ul>${providers(data.movie.providers)}</ul>
  </div>
</article>
`