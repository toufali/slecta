const figure = document.querySelector('figure')
const trailer = figure.querySelector('iframe')
const playBtn = figure.querySelector('button')

if (trailer) {
  playBtn.addEventListener('click', playTrailer)
}

function playTrailer(e) {
  figure.toggleAttribute('data-trailer-active')
  trailer.remove() // remove and re-add iframe to avoid browser history navigation when changing src
  trailer.src = trailer.dataset.src
  figure.append(trailer)
}