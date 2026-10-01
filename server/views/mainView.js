// A title page sits in its section without being that section's page
const current = (data, section) => data.section === section ? ` aria-current='${data.partial.name === 'titleDetail' ? 'true' : 'page'}'` : ''

export const mainView = data => `
<!doctype html>
<html lang=en>
<head>
  <title>SLECTA</title>

  <meta charset='utf-8'>
  <meta name='viewport' content='width=device-width, initial-scale=1'>
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
  ${data.partial.styles ? `<link rel='stylesheet' href='${data.partial.styles}' type='text/css'>` : ''}
  <link rel='icon' href='/favicon.ico' sizes='32x32'>
  <link rel='icon' href='/icon.svg' type='image/svg+xml'>
  <link rel='apple-touch-icon' href='/apple-touch-icon.png'>
  <link rel='manifest' href='/manifest.webmanifest'>

  <script src='/scripts/index.js' type='module'></script>
</head>
<body data-partial='${data.partial.name}'>
  <header class='primary'>
    <div>
      <a href='/'><img class='logo' src='/images/logo.svg' alt='SLECTA'></a>
      <nav class='primary' aria-label='Sections'>
        <a href='/movies'${current(data, 'movies')} style="--icon-url:url(/images/movie-icon.svg)">Movie</a>
        <a href='/shows'${current(data, 'shows')} style="--icon-url:url(/images/tv-icon.svg)">Show</a>
        <a href='/about'${current(data, 'about')} style="--icon-url:url(/images/about-icon.svg)">About</a>
      </nav>
    </div>
  </header>
  <hr class='header-groove'>
  <main>
    ${data.partial(data.content)}
  </main>
  <button class='back pill' hidden>Back to results</button>
</body>
</html>
`