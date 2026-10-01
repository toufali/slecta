import { sendEvent } from './events.js'

export async function runSearch(input, list) {
  const title = input.value

  if (title.length < 2) {
    list.classList.remove('loading')
    return list.replaceChildren()
  }

  list.classList.add('loading')

  try {
    const params = new URLSearchParams({ title })
    const res = await fetch(`/api/v1/search/?${params}`)

    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)

    const results = await res.json()

    // Drop a response the input has moved past
    if (input.value !== title) return

    // Showing the same query again, as reopening the panel does, is not a new search
    if (!results.length && list.dataset.query !== title) sendEvent('search', { query: title, results: 0 })

    list.dataset.query = title
    renderResults(list, results)
    list.classList.remove('loading')
  } catch (e) {
    console.error(e)
  }
}

export function recordPick(e) {
  const link = e.target.closest('a')
  const list = e.currentTarget

  if (link) sendEvent('search', { query: list.dataset.query, results: list.children.length, pick: new URL(link.href).pathname })
}

function renderResults(list, results) {
  list.innerHTML = results.map((item, i) => `
  <li>
    <a href="/${item.mediaType === 'tv' ? 'shows' : 'movies'}/${item.id}">
      <article data-type="${item.mediaType}" style="--delay:${30 * i}ms; --icon-url:url(/images/${item.mediaType}-icon.svg)">
        <dl>
          <dt><h3 class='title'>${item.title}</h3></dt>
          <dd>${item.mediaTypeText}</dd>
          ${item.releaseDate ? `<dd><time title='Release date' datetime="${item.releaseDate}">${new Date(item.releaseDate).toLocaleDateString('en-US', { year: 'numeric' })}</time></dd>` : ''}
          ${item.genres?.length ? `<dd title='${item.genres.join(', ')}'>${item.genres.join(', ')}</dd>` : ''}
        </dl>
      </article>
    </a>
  </li>
  `).join('')
}
