/**
 * Rebuild the footer's page nav after a filter change. That always lands on the first page, so the
 * only state it can be in is: no previous, and a next carrying the filters just applied.
 * @param {URLSearchParams} params
 * @param {number} [totalPages] decides whether there is a next page; undefined when the list
 *   metadata could not be read
 */
export function resetPageNav(params, totalPages) {
  const footer = document.querySelector('footer')

  if (!footer) return

  const existing = footer.querySelector('.pagination')

  // A filtered list can be one page, and then the control goes rather than offer a page that 400s
  if (!totalPages || totalPages < 2) return existing?.remove()

  const next = new URLSearchParams(params)

  next.set('page', 2)

  // Created when absent, since a list that arrived as one page rendered no nav to update. Filtering
  // to a wider one would otherwise leave the rest of the results unreachable without a reload.
  const nav = existing ?? footer.insertBefore(document.createElement('nav'), footer.firstChild)

  nav.className = 'pagination'
  // Named like the server's, or a created landmark is one the shell's own nav cannot be told from
  nav.ariaLabel = 'Pagination'
  nav.innerHTML = `
    <span></span>
    <span class='page-number'>Page 1</span>
    <a class='button secondary' rel='next' href='${location.pathname}?${next}'>Next</a>`
}
