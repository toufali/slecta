const mediaQueryMobile = window.matchMedia('(width <= 1024px)') // this breakpoint is also set in variables.css

function handleMediaQuery(e = mediaQueryMobile) {
  document.documentElement.toggleAttribute('mobile', e.matches)
  document.documentElement.toggleAttribute('desktop', !e.matches)
}

mediaQueryMobile.addEventListener('change', handleMediaQuery)
handleMediaQuery()
