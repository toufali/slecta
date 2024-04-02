// TODO: this file is a mess

// import '../components/movieCard.js'

const form = document.querySelector('[data-partial="movieList"] form')
const list = document.querySelector('[data-partial="movieList"] ul')
// const filterToggle = document.querySelector('.filter-toggle')
// const state = new Proxy({
//   searchParams: null,
// }, {
//   set(target, key, value) {
//     if (target[key] !== value) {
//       target[key] = value
//       render()
//     }

//     return true
//   }
// })

export default async function init() {
  const cards = document.querySelectorAll('movie-card')

  for (const card of cards) {
    const output = card.shadowRoot.querySelector('[data-avg-score]')
    if (output.dataset.avgScore === 'undefined') {
      await getScore(card.id, output)
    }
  }

  // filterToggle.addEventListener('mousedown', handleMouseEvent)
  // form.elements['score'].addEventListener('input', handleInput)
  // form.elements['count'].addEventListener('input', handleInput)
  // form.elements['years'].addEventListener('input', handleInput)
  // form.addEventListener('change', handleChange)
  // form.addEventListener('submit', handleSubmit)
}

async function getScore(id, output) {
  output.classList.add('loading')
  output.title = 'calculating '

  const res = await fetch(`/api/v1/movies/${id}/score`)
  const { avgScore } = await res.json()

  output.classList.remove('loading')
  output.title = ''
  if (avgScore) {
    output.dataset.avgScore = avgScore
    output.textContent = Math.round(avgScore) + '%'
  }
}

function handleChange(e) {
  if (document.documentElement.hasAttribute('desktop')) {
    handleSubmit() // "live" update on change for desktop only
  }
}

function handleInput(e) {
  const outputEl = e.target.parentElement.querySelector('output')

  switch (e.target.name) {
    case 'score':
      outputEl.textContent = `${e.target.value}%`
      break
    case 'count':
      outputEl.textContent = `${e.target.value} reviews`
      break
    case 'years':
      outputEl.textContent = e.target.value.join(' - ')
      break
  }
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
  const movieItems = []

  movies.forEach(movie => {
    const item = document.createElement('li')
    const movieCard = document.createElement('movie-card')

    movieCard.data = movie

    item.append(movieCard)
    movieItems.push(item)
  });

  list.replaceChildren(...movieItems)
}

function updateUrl(searchParams) {
  history.replaceState(null, "", `${location.protocol}//${location.host}${location.pathname}?${searchParams}`)
}