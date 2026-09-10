/**
 * Href of the page after the one requested, absent at the end of the list so the view has nothing
 * to render. `totalPages` is undefined when the list metadata could not be read, which withholds
 * the link rather than offering one that would 400.
 * @param {string} path
 * @param {object} query
 * @param {number} [totalPages]
 * @return {string|undefined}
 */
export function nextPageHref(path, query, totalPages) {
  const page = Number(query.page) || 1

  // A negated comparison, so an unreadable count and a page past the end both fall through
  if (!(page < totalPages)) return

  const params = new URLSearchParams()

  // Appended one at a time: a repeated filter arrives as an array, and passing the query object
  // straight to URLSearchParams would flatten it to one comma-joined value
  for (const [key, value] of Object.entries(query)) {
    if (key !== 'page') for (const each of [].concat(value)) params.append(key, each)
  }

  params.set('page', page + 1)

  return `${path}?${params}`
}
