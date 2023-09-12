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

export const moviesDetail = data => `
<article id='${data.movie.id}'>
  <figure>
    <img src='${data.movie.backdropUrl}'>
    ${ytTrailer(data.movie.ytTrailerId)}
  </figure>
  <header>
    <h1>${data.movie.title}</h1>
    <p>${data.movie.genres}</p>
    <p>
      <time title='Release date' datetime="${data.movie.releaseDate}">${new Date(data.movie.releaseDate).toLocaleDateString('en-US', { year: 'numeric', month: 'numeric', day: 'numeric' })}</time>
    </p>
    <p>${data.movie.runtime}min</p>
    <p>${data.movie.rating}</p>
    <p>${data.movie.languages}</p>
    <p>${Math.round(data.movie.reviewScore * 10)}%</p>
    <p>${data.movie.providers?.map(item => `<img src='${item.logoUrl}' title='${item.provider_name}'>`).join('') ?? ''}</p>
  </header>
  <p>${data.movie.overview}</p>
</article>
`