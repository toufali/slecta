export const mainView = data => `
<!doctype html>
<html lang=en>
<head>
  <title>SLECTA</title>

  <meta charset='utf-8'>
  <meta name='viewport' content='width=320, initial-scale=1'>
  <meta name='description' content=''>
  <meta name='twitter:card' content='summary_large_image'>
  <meta name='twitter:title' content=''>
  <meta name='twitter:description' content=''>
  <meta name='twitter:image' content=''>
  <meta property='og:title' content=''>
  <meta property='og:description' content=''>
  <meta property='og:site_name' content=''>
  <meta property='og:type' content='website'>
  <meta property='og:url' content=''>
  <meta property='og:image' content=''>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Barlow+Semi+Condensed:wght@400;500&display=swap" rel="stylesheet">
  <link rel='stylesheet' href='/styles/index.css' type='text/css'>
  <link rel='icon' href='data:,' sizes='16x16'>
  <link rel='icon' href='data:,' sizes='32x32'>
  <link rel='icon' href='data:,' sizes='48x48'>
  <link rel='icon' href='data:,' sizes='96x96'>
  <link rel='icon' href='data:,' sizes='144x144'>
  <link rel='icon' href='data:,' sizes='256x256'>
  <link rel='apple-touch-icon' href='data:,' sizes='180x180'>

  <script src='/scripts/index.js' type='module'></script>
</head>
<body data-partial='${data.partial.name}'>
  <header class='primary'>
    <div>
      <a href='/'><img class='logo' src='/images/logo.svg' alt='SLECTA'></a>
      <nav class='primary'>
        <a href='/movies' class="${data.partial.name === 'movieList' ? 'current' : ''}"  style="--icon-url:url(/images/movie-icon.svg)">Movie</a>
        <a href='/shows' class="${data.partial.name === 'showList' ? 'current' : ''}" style="--icon-url:url(/images/tv-icon.svg)">Show</a>
        <a href='/search' class="${data.partial.name === 'searchList' ? 'current' : ''}" style="--icon-url:url(/images/search-icon.svg)">Search</a>
      </nav>
    </div>
  </header>
  <hr class='header-groove'>
  <main>
    ${data.partial(data.content)}
  </main>
  <footer>
    <a href='/about'>About Slecta</a>
  </footer>
</body>
</html>
`