const mediaQueryMobile = window.matchMedia('(min-width: 769px)') // this breakpoint is also set in variables.css

function handleMediaQuery(e = mediaQueryMobile) {
  document.documentElement.toggleAttribute('desktop', e.matches)
}

mediaQueryMobile.addEventListener('change', handleMediaQuery)
handleMediaQuery()
