export async function runSearch(input, list) {
  const title = input.value

  if (title.length < 2) return list.replaceChildren()

  try {
    const params = new URLSearchParams({ title })
    const res = await fetch(`/api/v1/search/?${params}`)

    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)

    const results = await res.json()

    // Render only when the input still holds the awaited query, so a slow response cannot
    // overwrite a newer search or repopulate a cleared list
    if (input.value === title) renderResults(list, results)
  } catch (e) {
    console.error(e)
  }
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
