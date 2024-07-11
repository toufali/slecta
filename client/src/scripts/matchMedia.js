const mediaQueryMobile = window.matchMedia('(width <= 768px)') // this breakpoint is also set in vars.css

function handleMediaQuery(e = mediaQueryMobile) {
  document.documentElement.classList.toggle('mobile', e.matches)
  document.documentElement.classList.toggle('desktop', !e.matches)
}

mediaQueryMobile.addEventListener('change', handleMediaQuery)
handleMediaQuery()
