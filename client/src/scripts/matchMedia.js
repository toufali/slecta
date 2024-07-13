// Looks like we can deprecate this and replace its functionality with Container Queries

const mediaQueryMobile = window.matchMedia('(width <= 768px)') // this breakpoint is also set in vars.css

handleMediaQuery()
mediaQueryMobile.addEventListener('change', handleMediaQuery)

function handleMediaQuery(e = mediaQueryMobile) {
  document.documentElement.classList.toggle('mobile', e.matches)
  document.documentElement.classList.toggle('desktop', !e.matches)
}