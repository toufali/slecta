import { monthsText } from '../utils/months.js'
import { newestFirst } from '../utils/sort.js'
import { namesText } from '../utils/names.js'
import { debounce } from '../utils/time.js'
import { runSearch } from '../utils/search.js'

const list = document.querySelector('.title-list')
const listDescription = document.querySelector('.list-description')
const filterPanel = document.querySelector('.filter-panel')
const filterForm = document.querySelector('form[name="title-filter"]')
const filterBtn = document.querySelector('.list-actions .filter')
const lookback = document.querySelector('.lookback input')
const lookbackOutput = document.querySelector('.lookback output')
const lookbackFs = lookback.closest('fieldset')
const sortFs = document.querySelector('input[name=sort]').closest('fieldset')
const more = document.querySelector('.more')
const panelClose = document.querySelector('.filter-panel .close')
const searchPanel = document.querySelector('.search-panel')
const searchBtn = document.querySelector('.list-actions .search')
const searchInput = searchPanel.querySelector('input[type="search"]')
const searchClose = searchPanel.querySelector('.close')
const resultList = searchPanel.querySelector('.result-list')

const segment = new URL(filterForm.action).pathname.split('/').pop()
const { noun, dated } = {
  movies: { noun: 'Movies', dated: 'released' },
  shows: { noun: 'TV Shows', dated: 'first aired' }
}[segment]

let generation = 0

export default function init() {
  filterBtn.addEventListener('click', handlePanel)
  listDescription.addEventListener('click', handleDescription)
  filterForm.addEventListener('submit', handleSubmit)
  lookback.addEventListener('input', handleLookback)
  sortFs.addEventListener('change', handleSort)
  more.addEventListener('click', handleMore)
  panelClose.addEventListener('click', handlePanel)
  searchBtn.addEventListener('click', handleSearch)
  searchClose.addEventListener('click', handleSearch)
  // Keep this half synchronous: the URL must land on the overlay's entry before a quick close traverses away
  searchInput.addEventListener('input', handleSearchInput)
  searchInput.addEventListener('input', debounce(() => runSearch(searchInput, resultList)))
  window.addEventListener('popstate', handlePopstate)

  // A reload restores the pushed entry, but the panels ship closed
  if (history.state?.filterPanel) togglePanel()

  const title = new URLSearchParams(location.search).get('title')
  if (title || history.state?.searchPanel) restoreSearch(title)

  renderScores()
}

// A typed or shared URL arrives without the overlay's entry; synthesise one so close lands on the list
function restoreSearch(title) {
  if (!history.state?.searchPanel) {
    const entry = location.href
    const base = new URL(location)

    base.searchParams.delete('title')
    history.replaceState(null, '', base)
    history.pushState({ searchPanel: true }, '', entry)
  }

  togglePanel(searchPanel, searchBtn)

  if (title) {
    searchInput.value = title
    handleSearchInput()
    runSearch(searchInput, resultList)
  }
}

function handleSearch(e) {
  e.preventDefault()
  togglePanel(searchPanel, searchBtn)

  if (searchPanel.inert) history.back()
  else {
    history.pushState({ searchPanel: true }, '')
    // Re-sync a retained query onto the fresh entry, so a later restore matches what is shown
    if (searchInput.value) {
      handleSearchInput()
      runSearch(searchInput, resultList)
    }
    searchInput.focus()
  }
}

// The query rides the pushed entry's URL, so back from a tapped result can restore this search
function handleSearchInput() {
  const url = new URL(location)

  resultList.classList.add('loading')

  if (searchInput.value) url.searchParams.set('title', searchInput.value)
  else url.searchParams.delete('title')
  history.replaceState(history.state, '', url)
}

function handleDescription(e) {
  if (e.target.closest('output')) handlePanel()
}

// Flip first: an inert panel can't be tapped again, so a double-tap can't pop twice
function handlePanel() {
  togglePanel()

  if (filterPanel.inert) history.back()
  else history.pushState({ filterPanel: true }, '')
}

// Match the entry being traversed to, so Forward reopens a panel and Back closes it
function handlePopstate(e) {
  if (Boolean(e.state?.filterPanel) === filterPanel.inert) togglePanel()
  if (Boolean(e.state?.searchPanel) === searchPanel.inert) togglePanel(searchPanel, searchBtn)

  // Retained DOM does not survive a reload; the entry's URL is the truth
  if (e.state?.searchPanel) {
    const title = new URLSearchParams(location.search).get('title') ?? ''

    if (searchInput.value !== title) {
      searchInput.value = title
      runSearch(searchInput, resultList)
    }
  }
}

function handleSort(e) {
  const hide = newestFirst(e.target.value)
  lookbackFs.toggleAttribute('disabled', hide)
  lookbackFs.toggleAttribute('hidden', hide)
}

function handleLookback() {
  lookbackOutput.textContent = monthsText(+lookback.value)
  lookback.ariaValueText = lookbackOutput.textContent
}

function togglePanel(panel = filterPanel, btn = filterBtn) {
  if (panel.contains(document.activeElement)) btn.focus()

  panel.inert = !panel.inert
  panel.scroll(0, 0)
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
  const services = params.getAll('wp').join('|')

  // The server reads this to render the next visit's first paint already filtered
  document.cookie = `wp=${services}; path=/; samesite=lax; max-age=${services ? 31536000 : 0}`

  handlePanel()

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
  json.allProviders = new Map(json.allProviders)
  json.allStorefronts = new Map(json.allStorefronts)

  return json
}

const cardItems = rows => rows.map(row => {
  const item = document.createElement('li')
  const card = document.createElement('title-card')

  card.data = row

  item.append(card)
  return item
})

async function renderScores(cards = document.querySelectorAll('title-card')) {
  for (const card of cards) {
    const scoreBadge = card.shadowRoot.querySelector('score-badge')

    // Absent when the record already answered "no score"
    if (scoreBadge && scoreBadge.score === undefined) {
      scoreBadge.classList.add('loading')

      try {
        const score = await fetch(`/api/v1/${segment}/${card.id}/score`).then(res => res.json())

        // An answered fetch with no aggregate is the answer; unanswered keeps the retry hook
        if (score.avgScore === undefined && score.answered) {
          scoreBadge.remove()
          continue
        }

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

  let sort, genres, ratings, services, language

  sort = `<label>${noun} sorted by <output>${data.allSorting.find(opt => opt.value === data.sortBy).name}</output></label>`
  if (data.withGenres) genres = `<label>with genre <output>${namesText(data.withGenres, data.allGenres)}</output></label>`
  if (data.withRatings) ratings = `<label>rated <output>${disjunctionFmt.format(data.withRatings)}</output></label>`
  if (data.withProviders) services = `<label>on <output>${namesText(data.withProviders, new Map([...data.allProviders, ...data.allStorefronts]))}</output></label>`
  if (data.inEnglish) language = `<output>in English</output>`

  const lookbackText = newestFirst(data.sortBy) ? '' : `<label>${dated} in the last <output>${monthsText(data.lookback)}</output></label>`

  listDescription.innerHTML = conjunctionFmt.format([sort, genres, ratings, services, language, lookbackText].filter(item => item))
  window.scrollTo(0, 0)
}

function updateUrl(params) {
  history.replaceState(null, "", `${location.protocol}//${location.host}${location.pathname}?${params}`)
}
