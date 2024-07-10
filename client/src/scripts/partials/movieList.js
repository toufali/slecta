const list = document.querySelector('[data-partial="movieList"] ul')
const listDescription = document.querySelector('.list-description')
const filterPanel = document.querySelector('.filter-panel')
const filterForm = document.querySelector('form[name="movie-filter"]')
const filterToggle = document.querySelector('.filter-toggle')

export default function init() {
  filterToggle.addEventListener('mousedown', handleMouseEvent)
  filterForm.addEventListener('submit', handleSubmit)
  renderScores()
}

function handleMouseEvent(e) {
  switch (true) {
    case e.target.matches('.filter-toggle'):
      filterPanel.classList.toggle('visible', !filterPanel.classList.contains('visible'))
      document.documentElement.scroll(0, 0)
      break
  }
}

async function handleSubmit(e) {
  if (e) e.preventDefault()

  const params = new URLSearchParams(new FormData(e.target))
  const data = await getMovieData(e.target, params) // this is more complex (passing form arg) in anticipation of adding TV functionality

  filterPanel.classList.toggle('visible', false)

  renderMovieList(data.movies)
  renderlistDescription(data)
  renderScores()
  updateUrl(params)
}

async function getMovieData(form, params) {
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
  window.scrollTo(0, 0)
}

function updateUrl(params) {
  history.replaceState(null, "", `${location.protocol}//${location.host}${location.pathname}?${params}`)
}