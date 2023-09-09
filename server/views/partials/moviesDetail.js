export const moviesDetail = data => `
<article id='${data.movie.id}'>
  <figure data-ytid='${data.movie.ytTrailerId}'>
    <img src='${data.movie.backdropUrl}'>
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
  </header>
  <p>${data.movie.overview}</p>
  <pre><code>${JSON.stringify(data.movie.providers, null, 2)}</code></pre>
</article>
`