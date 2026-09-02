/**
 * Rebuild the footer's page nav after a filter change. That always lands on the first page, so the
 * only state it can be in is: no previous, and a next carrying the filters just applied.
 * @param {URLSearchParams} params
 * @param {number} [totalPages] undefined when the list metadata could not be read
 */
export function resetPageNav(params, totalPages) {
  const nav = document.querySelector('footer .pagination')

  if (!nav) return

  // A filtered list can be one page or none, and the nav has to go rather than offer a page that 400s
  if (!totalPages || totalPages < 2) return nav.replaceChildren()

  const next = new URLSearchParams(params)

  next.set('page', 2)

  nav.innerHTML = `
    <span></span>
    <span class='page-of'>Page 1 of ${totalPages}</span>
    <a class='button secondary' rel='next' href='${location.pathname}?${next}'>Next</a>`
}
