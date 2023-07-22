export const moviesDetail = data => `
<article>
  <header>
    <img src='${data.movie.imgBaseUrl}${data.movie.backdropSizes[2]}/${data.movie.backdrop_path}'>
    <h1>${data.movie.title}</h1>
  </header>
</article>
`