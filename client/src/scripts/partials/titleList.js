import { monthsText } from '../utils/months.js'
import { genreText } from '../utils/genres.js'

const list = document.querySelector('.movie-list')
const listDescription = document.querySelector('.list-description')
const filterPanel = document.querySelector('.filter-panel')
const filterForm = document.querySelector('form[name="movie-filter"]')
const filterToggle = document.querySelector('.filter-toggle')
const lookback = document.querySelector('.lookback input')
const lookbackOutput = document.querySelector('.lookback output')
const more = document.querySelector('.more')
const panelClose = document.querySelector('.filter-panel .close')

const segment = new URL(filterForm.action).pathname.split('/').pop()
const { noun, dated } = {
  movies: { noun: 'Movies', dated: 'released' },
  shows: { noun: 'TV Shows', dated: 'first aired' }
}[segment]

let generation = 0

export default function init() {
  filterToggle.addEventListener('click', togglePanel)
  listDescription.addEventListener('click', e => e.target.closest('output') && togglePanel())
  filterForm.addEventListener('submit', handleSubmit)
  lookback.addEventListener('input', handleLookback)
  more.addEventListener('click', handleMore)
  panelClose.addEventListener('click', togglePanel)
  renderScores()
}

function handleLookback() {
  lookbackOutput.textContent = monthsText(+lookback.value)
  lookback.ariaValueText = lookbackOutput.textContent
}

function togglePanel() {
  if (filterPanel.contains(document.activeElement)) filterToggle.focus()

  filterPanel.inert = !filterPanel.inert
  filterPanel.scroll(0, 0)
}

async function handleMore(e) {
  e.preventDefault()

  if (more.classList.contains('loading')) return

  const era = generation

  more.classList.add('loading')

  try {
    const asked = new URL(more.href)
    const api = new URL(filterForm.action)
    const byKeyboard = more.matches(':focus-visible')

    api.search = asked.search

    const res = await fetch(api)

    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)

    const data = await res.json()

    if (era !== generation) return

    const items = cardItems(data[segment])

    list.append(...items)
    renderScores(items.map(item => item.firstChild))

    if (byKeyboard) items[0]?.firstChild.shadowRoot.querySelector('a').focus()

    advance(asked, data.totalPages)
  } catch (e) {
    console.error(e)
  } finally {
    if (era === generation) more.classList.remove('loading')
  }
}

// Reset the control after a filter change, which always lands on the first page
function resetMore(params, totalPages) {
  generation++
  more.classList.remove('loading')

  if (!(totalPages > 1)) return more.hidden = true

  const next = new URLSearchParams(params)

  next.set('page', 2)

  more.href = `${location.pathname}?${next}`
  more.hidden = false
}

function advance(asked, totalPages) {
  const page = Number(asked.searchParams.get('page'))

  if (!(page < totalPages)) return more.hidden = true

  asked.searchParams.set('page', page + 1)

  more.href = `${asked.pathname}${asked.search}`
}

async function handleSubmit(e) {
  if (e) e.preventDefault()

  const params = new URLSearchParams(new FormData(e.target))

  togglePanel()

  const data = await getData(params)

  list.replaceChildren(...cardItems(data[segment]))
  renderlistDescription(data)
  renderScores()
  resetMore(params, data.totalPages)
  updateUrl(params)
}

async function getData(params) {
  try {
    var res = await fetch(`${filterForm.action}?${params}`)
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  } catch (e) {
    console.error(e)
  }

  const json = await res.json()
  json.allGenres = new Map(json.allGenres)

  return json
}

const cardItems = rows => rows.map(row => {
  const item = document.createElement('li')
  const movieCard = document.createElement('movie-card')

  movieCard.data = row

  item.append(movieCard)
  return item
})

async function renderScores(cards = document.querySelectorAll('movie-card')) {
  for (const card of cards) {
    const scoreBadge = card.shadowRoot.querySelector('score-badge')

    if (scoreBadge.score === undefined) {
      scoreBadge.classList.add('loading')

      try {
        const score = await fetch(`/api/v1/${segment}/${card.id}/score`).then(res => res.json())

        scoreBadge.lowConfidence = score.lowConfidence
        scoreBadge.score = score.avgScore
      } catch (e) {
        console.error(e)
      } finally {
        scoreBadge.classList.remove('loading')
      }
    }
  }
}

function renderlistDescription(data) {
  const conjunctionFmt = new Intl.ListFormat("en-US", { style: "long", type: "conjunction" })
  const disjunctionFmt = new Intl.ListFormat("en-US", { style: "short", type: "disjunction" })

  let sort, genres, ratings, streaming, language

  sort = `<label>${noun} sorted by <output>${data.allSorting.find(opt => opt.value === data.sortBy).name}</output></label>`
  if (data.withGenres) genres = `<label>with genre <output>${genreText(data.withGenres, data.allGenres)}</output></label>`
  if (data.withRatings) ratings = `<label>rated <output>${disjunctionFmt.format(data.withRatings)}</output></label>`
  if (data.streamingNow) streaming = `<label>are <output>streaming now</output></label>`
  if (data.inEnglish) language = `<output>in English</output>`

  const lookbackText = `<label>${dated} in the last <output>${monthsText(data.lookback)}</output></label>`

  listDescription.innerHTML = conjunctionFmt.format([sort, genres, ratings, streaming, language, lookbackText].filter(item => item))
  window.scrollTo(0, 0)
}

function updateUrl(params) {
  history.replaceState(null, "", `${location.protocol}//${location.host}${location.pathname}?${params}`)
}
