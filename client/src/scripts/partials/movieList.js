const form = document.querySelector('[data-partial="movieList"] form')
const list = document.querySelector('[data-partial="movieList"] ul')
const listDescription = document.querySelector('.list-description')
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

  const params = new URLSearchParams(new FormData(form))
  const data = await getMovieData(params)

  renderMovieList(data.movies)
  renderlistDescription(data)
  renderScores()
  updateUrl(params)
  if (!document.documentElement.hasAttribute('desktop')) {
    form.toggleAttribute('hidden', true) // hide filter panel for mobile only
  }
}

async function getMovieData(params) {
  try {
    var res = await fetch(`${form.action}?${params}`)
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  } catch (e) {
    console.error(e)
  }

  const json = await res.json()
  json.allGenres = new Map(json.allGenres) // genres was converted from Map to Array for JSON compatibility. Here we convert back to Map

  return json
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

function renderlistDescription(data) {
  const conjunctionFmt = new Intl.ListFormat("en-US", { style: "long", type: "conjunction" })
  const disjunctionFmt = new Intl.ListFormat("en-US", { style: "short", type: "disjunction" })

  let sort, genres, ratings, streaming

  sort = `<label>Movies sorted by <output>${data.allSorting.find(opt => opt.value === data.sortBy).name}</output></label>`
  if (data.withGenres) genres = `<label>with genre <output>${disjunctionFmt.format(data.withGenres?.map(genre => data.allGenres.get(parseInt(genre))))}</output></label>`
  if (data.withRatings) ratings = `<label>rated <output>${disjunctionFmt.format(data.withRatings)}</output></label>`
  if (data.streamingNow) streaming = `<label>are <output>streaming now</output></label>`

  listDescription.innerHTML = conjunctionFmt.format([sort, genres, ratings, streaming].filter(item => item))
}

function updateUrl(params) {
  history.replaceState(null, "", `${location.protocol}//${location.host}${location.pathname}?${params}`)
}