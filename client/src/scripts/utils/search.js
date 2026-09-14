export async function searchTitles(title) {
  const params = new URLSearchParams({ title })
  const res = await fetch(`/api/v1/search/?${params}`)

  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)

  return res.json()
}

export function renderResults(list, results) {
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
