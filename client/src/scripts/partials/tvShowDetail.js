import { reviewQuote } from '../components/reviewQuote.js'

const figure = document.querySelector('figure')
const trailer = figure.querySelector('iframe')
const playBtn = figure.querySelector('button')
const article = document.querySelector('article')
const scoreBadge = document.querySelector('score-badge')
const quotes = article.querySelector('.quotes')

export default async function init() {
  if (trailer) playBtn.addEventListener('click', playTrailer)
  if (!scoreBadge.score) getScore()
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
  scoreBadge.score = await fetch(`/api/v1/shows/${article.id}/score`)
    .then(res => res.json())
    .then(json => json.avgScore)
  scoreBadge.classList.remove('loading')
}

async function getQuotes() {
  const urlParams = new URLSearchParams({
    title: article.querySelector('header h1').textContent,
    releaseDate: article.querySelector('header time').getAttribute('datetime')
  })

  const res = await fetch(`/api/v1/shows/${article.id}/quotes?${urlParams}`)

  if (!res.ok) return console.error('Error fetching quotes:', res.message)

  const json = await res.json()

  quotes.innerHTML = json.map(item => reviewQuote(item)).join('')
}