/**
 * Prev/next hrefs for the page the request is on, absent at either boundary so the view has
 * nothing to render there. `totalPages` is undefined when the list metadata could not be read,
 * which withholds the next link rather than offering one that would 400.
 * @param {string} path
 * @param {object} query
 * @param {number} [totalPages]
 * @return {{page: number, totalPages: (number|undefined), prev: (string|undefined), next: (string|undefined)}}
 */
export function pageLinks(path, query, totalPages) {
  const page = Number(query.page) || 1

  const href = to => {
    const params = new URLSearchParams()

    // Appended one at a time: a repeated filter arrives as an array, and passing the query object
    // straight to URLSearchParams would flatten it to one comma-joined value
    for (const [key, value] of Object.entries(query)) {
      if (key !== 'page') for (const each of [].concat(value)) params.append(key, each)
    }

    // Page one is the bare URL, so the first page has one address rather than two
    if (to > 1) params.set('page', to)

    return params.size ? `${path}?${params}` : path
  }

  return {
    page,
    totalPages,
    prev: page > 1 ? href(page - 1) : undefined,
    next: page < totalPages ? href(page + 1) : undefined
  }
}
