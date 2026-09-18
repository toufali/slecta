import { reviewQuote } from '../components/reviewQuote.js'

const figure = document.querySelector('figure')
const trailer = figure.querySelector('iframe')
const playBtn = figure.querySelector('button')
const article = document.querySelector('article')
const backBtn = article.querySelector('.back')
const scoreBadge = document.querySelector('score-badge')
const quotes = article.querySelector('.quotes')

// A list page behind the reader means back restores their results; anywhere else it would leave the site
const LIST_PATHS = ['/', '/movies', '/shows', '/search']

// /movies/603 and /shows/42 differ only here
const segment = location.pathname.split('/')[1]

export default async function init() {
  const referrer = document.referrer && new URL(document.referrer)

  // A new tab keeps the referrer but has no entry to go back to
  if (referrer && referrer.origin === location.origin && LIST_PATHS.includes(referrer.pathname) && history.length > 1) {
    backBtn.hidden = false
    backBtn.addEventListener('click', () => history.back())
  }

  if (trailer) playBtn.addEventListener('click', playTrailer)
  // Absent when the record already answered "no score"
  if (scoreBadge && scoreBadge.score === undefined) getScore()
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

  // An answered fetch with no aggregate is the answer; unanswered keeps the retry hook
  if (score.avgScore === undefined && score.answered) {
    scoreBadge.remove()
    document.querySelector('.no-score').hidden = false
    return
  }

  // The line ships hidden rather than absent, so a badge filled in here can explain itself too
  document.querySelector('.low-confidence').hidden = !score.lowConfidence
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