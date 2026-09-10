// The footer's More control appends the next page rather than navigating to it, so a reader keeps
// their place. The address bar is left alone deliberately: tracking the page would make a reload
// or a shared link open a slice of the window with nothing before it.

const footer = document.querySelector('footer')

let inFlight = false
let generation = 0

const control = () => footer.querySelector('.more')

/**
 * @param {object} config
 * @param {string} config.endpoint API path answering the same query as the page route
 * @param {string} config.segment property the rows arrive under, `movies` or `shows`
 * @param {(rows: object[]) => void} config.append
 */
export function initMore({ endpoint, segment, append }) {
  // Delegated, so a control rebuilt by `resetMore` does not need rebinding
  footer.addEventListener('click', async e => {
    const link = e.target.closest('.more')

    if (!link) return

    e.preventDefault()

    if (inFlight) return // a double tap arrives before the first fetch lands

    inFlight = true
    link.classList.add('loading')

    try {
      const asked = new URL(link.href)
      const api = new URL(endpoint, location)
      const era = generation

      api.search = asked.search

      const res = await fetch(api)

      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)

      const data = await res.json()

      if (era !== generation) return // a filter landed first, and these rows answer the old query

      append(data[segment])
      advance(link, Number(asked.searchParams.get('page')), data.totalPages)
    } catch (e) {
      // Left in place, so the reader can ask again rather than lose the rest of the window
      console.error(e)
    } finally {
      inFlight = false
      link.classList.remove('loading')
    }
  })
}

/**
 * Rebuild the control after a filter change, which always lands on the first page.
 * @param {URLSearchParams} params
 * @param {number} [totalPages]
 */
export function resetMore(params, totalPages) {
  const existing = control()

  generation++

  if (!(totalPages > 1)) return existing?.remove()

  const next = new URLSearchParams(params)

  next.set('page', 2)

  const href = `${location.pathname}?${next}`

  if (existing) return existing.href = href

  // Built when absent: a list that arrived as one page rendered no control, and filtering to a
  // wider one would leave the rest unreachable without a reload
  const link = document.createElement('a')

  link.className = 'button secondary more'
  link.rel = 'next'
  link.href = href
  link.textContent = 'More'

  footer.prepend(link)
}

// Negated comparisons, so an unreadable count reads as the end of the list: `totalPages` is
// undefined when the list metadata could not be read, and a link past the end would 400 on pageMax
function advance(link, page, totalPages) {
  if (!(page < totalPages)) return link.remove()

  const url = new URL(link.href)

  url.searchParams.set('page', page + 1)

  link.href = `${url.pathname}${url.search}`
}
