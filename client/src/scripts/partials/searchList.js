import { debounce } from '../utils/time.js'
import { searchTitles, renderResults } from '../utils/search.js'

const searchInput = document.querySelector('input[type="search"]')
const searchOutput = document.querySelector('.result-list')

export default function init() {
  searchInput.addEventListener('input', debounce(handleInput))
}

async function handleInput(e) {
  if (e.target.value.length < 2) return searchOutput.replaceChildren()

  try {
    renderResults(searchOutput, await searchTitles(e.target.value))
  } catch (e) {
    console.error(e)
  }
}
