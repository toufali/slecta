const figure = document.querySelector('figure')
const trailer = figure.querySelector('iframe')
const playBtn = figure.querySelector('button')
const article = document.querySelector('article')
const avgScore = article.querySelector('[data-avg-score]')

export default function init() {
  if (trailer) {
    playBtn.addEventListener('click', playTrailer)
  }
  if (avgScore.dataset.avgScore === 'undefined') {
    getAvgScore()
  }
}

function playTrailer(e) {
  figure.toggleAttribute('data-trailer-active')
  trailer.remove() // remove and re-add iframe to avoid browser history navigation when changing src
  trailer.src = trailer.dataset.src
  figure.append(trailer)
}

async function getAvgScore() {
  const tmdbId = article.id
  const { wikiId, imdbId } = article.dataset
  const { tmdbScore } = avgScore.dataset
  const title = article.querySelector('h1').textContent
  const releaseDate = article.querySelector('.details time').getAttribute('datetime')
  const url = `/api/v1/movies/${tmdbId}/score?wikiId=${wikiId}&imdbId=${imdbId}&tmdbScore=${tmdbScore}&title=${title}&releaseDate=${releaseDate}`
  avgScore.classList.add('loading')
  avgScore.textContent = 'calculating '
  const res = await fetch(url)
  const score = await res.json()
  console.log('got avgScore:', score)
  avgScore.classList.remove('loading')

  avgScore.textContent = score ? Math.round(score * 10) + '%' : 'Not available'
}