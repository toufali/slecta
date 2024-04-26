const form = document.querySelector('[data-partial="movieList"] form')
const list = document.querySelector('[data-partial="movieList"] ul')
const filterToggle = document.querySelector('.filter-toggle')

export default function init() {
  filterToggle.addEventListener('mousedown', handleMouseEvent)
  form.addEventListener('submit', handleSubmit)
  renderScores()
}

function handleMouseEvent(e) {
  form.toggleAttribute('hidden', form.getAttribute('hidden') === null)
}

async function handleSubmit(e) {
  if (e) e.preventDefault()

  const searchParams = new URLSearchParams(new FormData(form))
  const data = await getMovieData(searchParams)

  renderMovieList(data)
  updateUrl(searchParams)
  renderScores()
  if (!document.documentElement.hasAttribute('desktop')) {
    form.toggleAttribute('hidden', true) // hide filter panel for mobile only
  }
}

async function getMovieData(searchParams) {
  let movieData

  try {
    const res = await fetch(`${form.action}?${searchParams}`)

    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)

    const { movies } = await res.json()
    movieData = movies
  } catch (e) {
    console.error(e)
  }

  return movieData
}

function renderMovieList(movies) {
  const movieItems = movies.map(movie => {
    const item = document.createElement('li')
    const movieCard = document.createElement('movie-card')

    movieCard.data = movie

    item.append(movieCard)
    return item
  });

  list.replaceChildren(...movieItems)
}

async function renderScores() {
  const cards = document.querySelectorAll('movie-card')

  for (const card of cards) {
    const scoreBadge = card.shadowRoot.querySelector('score-badge')
    if (!scoreBadge.score) {
      scoreBadge.classList.add('loading')
      scoreBadge.score = await fetch(`/api/v1/movies/${card.id}/score`)
        .then(res => res.json())
        .then(json => json.avgScore)
      scoreBadge.classList.remove('loading')
    }
  }
}

function updateUrl(searchParams) {
  history.replaceState(null, "", `${location.protocol}//${location.host}${location.pathname}?${searchParams}`)
}