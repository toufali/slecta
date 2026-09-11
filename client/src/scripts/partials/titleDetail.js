import { reviewQuote } from '../components/reviewQuote.js'

const figure = document.querySelector('figure')
const trailer = figure.querySelector('iframe')
const playBtn = figure.querySelector('button')
const article = document.querySelector('article')
const scoreBadge = document.querySelector('score-badge')
const quotes = article.querySelector('.quotes')

// /movies/603 and /shows/42 differ only here
const segment = location.pathname.split('/')[1]

export default async function init() {
  if (trailer) playBtn.addEventListener('click', playTrailer)
  if (scoreBadge.score === undefined) getScore()
  if (!quotes.childElementCount) getQuotes()
}

function playTrailer(e) {
  figure.toggleAttribute('data-trailer-active')
  trailer.remove() // remove and re-add iframe to avoid browser history navigation when changing src
  trailer.src = trailer.dataset.src
  figure.append(trailer)
}

async function getScore() {
  scoreBadge.classList.add('loading')

  const score = await fetch(`/api/v1/${segment}/${article.id}/score`).then(res => res.json())

  // The line ships hidden rather than absent, so a badge filled in here can explain itself too
  document.querySelector('.unsettled').hidden = !score.lowConfidence
  scoreBadge.lowConfidence = score.lowConfidence
  scoreBadge.score = score.avgScore
  scoreBadge.classList.remove('loading')
}

async function getQuotes() {
  const urlParams = new URLSearchParams({
    title: article.querySelector('header h1').textContent,
    releaseDate: article.querySelector('header time').getAttribute('datetime')
  })

  const res = await fetch(`/api/v1/${segment}/${article.id}/quotes?${urlParams}`)

  if (!res.ok) return console.error('Error fetching quotes:', res.message)

  const json = await res.json()

  quotes.innerHTML = json.map(item => reviewQuote(item)).join('')
}