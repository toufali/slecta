import { debounce } from '../utils/time.js'
import { runSearch } from '../utils/search.js'

const searchInput = document.querySelector('input[type="search"]')
const searchOutput = document.querySelector('.result-list')

export default function init() {
  searchInput.addEventListener('input', debounce(() => runSearch(searchInput, searchOutput)))
}
