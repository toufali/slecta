const figure = document.querySelector('figure')
const trailer = figure.querySelector('iframe')
const playBtn = figure.querySelector('button')
const article = document.querySelector('article')
const score = article.querySelector('[data-avg-score]')

export default function init() {
  if (trailer) {
    playBtn.addEventListener('click', playTrailer)
  }
  if (score.dataset.avgScore === 'undefined') {
    getScore()
  }
}

function playTrailer(e) {
  figure.toggleAttribute('data-trailer-active')
  trailer.remove() // remove and re-add iframe to avoid browser history navigation when changing src
  trailer.src = trailer.dataset.src
  figure.append(trailer)
}

async function getScore() {
  score.classList.add('loading')
  score.title = 'calculating '

  const res = await fetch(`/api/v1/movies/${article.id}/score`)
  const { avgScore } = await res.json()

  score.classList.remove('loading')
  score.title = ''
  score.textContent = avgScore ? Math.round(avgScore) + '%' : 'Not available'
}