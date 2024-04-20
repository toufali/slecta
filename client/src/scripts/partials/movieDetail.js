const figure = document.querySelector('figure')
const trailer = figure.querySelector('iframe')
const playBtn = figure.querySelector('button')
const article = document.querySelector('article')

export default async function init() {
  if (trailer) {
    playBtn.addEventListener('click', playTrailer)
  }

  const scoreBadge = document.querySelector('score-badge')
  if (!scoreBadge.score) {
    scoreBadge.classList.add('loading')
    scoreBadge.score = await getScore(article.id)
    scoreBadge.classList.remove('loading')
  }
}

function playTrailer(e) {
  figure.toggleAttribute('data-trailer-active')
  trailer.remove() // remove and re-add iframe to avoid browser history navigation when changing src
  trailer.src = trailer.dataset.src
  figure.append(trailer)
}

async function getScore(id) {
  const res = await fetch(`/api/v1/movies/${id}/score`)
  const { avgScore } = await res.json()
  return avgScore
}