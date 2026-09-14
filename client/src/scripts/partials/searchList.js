import { debounce } from '../utils/time.js'
import { searchTitles, renderResults } from '../utils/search.js'

const searchInput = document.querySelector('input[type="search"]')
const searchOutput = document.querySelector('.result-list')

export default function init() {
  searchInput.addEventListener('input', debounce(handleInput))
}

async function handleInput(e) {
  const title = e.target.value

  if (title.length < 2) return searchOutput.replaceChildren()

  try {
    const results = await searchTitles(title)

    if (searchInput.value === title) renderResults(searchOutput, results)
  } catch (e) {
    console.error(e)
  }
}
