import { debounce } from '../utils/time.js'

const searchInput = document.querySelector('input[type="search"]')
const searchOutput = document.querySelector('.result-list')

export default function init() {
  searchInput.addEventListener('input', debounce(handleInput))
}

async function handleInput(e) {
  if (e.target.value.length < 2) return searchOutput.replaceChildren()

  const params = new URLSearchParams({ [searchInput.name]: searchInput.value })

  try {
    var res = await fetch(`/api/v1/search/?${params}`)
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  } catch (e) {
    console.error(e)
  }

  const results = await res.json()

  const outputHtml = results.map((item, i) => `
  <li>
    <a href="/movies/${item.id}">
      <article data-type="${item.mediaType}" style="--delay:${30 * i}ms; --icon-url:url(/images/${item.mediaType}-icon.svg)">
        <dl>
          <dt><h3 class='title'>${item.title}</h3></dt>
          <dd>${item.mediaTypeText}</dd>
          <dd><time title='Release date' datetime="${item.releaseDate}">${new Date(item.releaseDate).toLocaleDateString('en-US', { year: 'numeric' })}</time></dd>
          <dd title='${item.genres.join(', ')}'>${item.genres.join(', ')}</dd>
        </dl>
      </article>
    </a>
  </li>
  `).join('')

  searchOutput.innerHTML = outputHtml
}