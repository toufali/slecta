// The list's More control appends the next page rather than navigating to it, so a reader keeps
// their place. The address bar is left alone deliberately: tracking the page would make a reload
// or a shared link open a slice of the window with nothing before it.

import { moreLink } from './moreLink.js'

const main = document.querySelector('main')

let generation = 0

/**
 * @param {string} endpoint API path answering the same query as the page route
 * @param {(data: object) => (HTMLElement|undefined)} append renders the response's rows and
 *   returns the first row's focusable element, which is where a keyboard reader has to be put
 */
export function initMore(endpoint, append) {
  // Delegated, so a control rebuilt by `resetMore` does not need rebinding
  main.addEventListener('click', async e => {
    const link = e.target.closest('.more')

    if (!link) return

    e.preventDefault()

    if (link.classList.contains('loading')) return // a double tap arrives before the fetch lands

    link.classList.add('loading')

    try {
      const asked = new URL(link.href)
      const api = new URL(endpoint, location)
      const era = generation
      // Read before the fetch, while the activation that set it is still the last thing to happen
      const byKeyboard = link.matches(':focus-visible')

      api.search = asked.search

      const res = await fetch(api)

      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)

      const data = await res.json()

      if (era !== generation) return // a filter landed first, and these rows answer the old query

      const first = append(data)

      // Tab order is document order, so a reader tabbing on from the control would skip the batch
      // it just loaded. Before `advance`, which removes the control and would drop focus with it.
      if (byKeyboard) first?.focus()

      advance(link, asked, data.totalPages)
    } catch (e) {
      // Left in place, so the reader can ask again rather than lose the rest of the window
      console.error(e)
    } finally {
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
  const existing = main.querySelector('.more')

  generation++

  if (!(totalPages > 1)) return existing?.remove()

  const next = new URLSearchParams(params)

  next.set('page', 2)

  const href = `${location.pathname}?${next}`

  if (existing) return existing.href = href

  // Built when absent: a list that arrived as one page rendered no control, and filtering to a
  // wider one would leave the rest unreachable without a reload
  main.querySelector('.filter-toggle').insertAdjacentHTML('beforebegin', moreLink(href))
}

// An unknown count reads as the end of the list
function advance(link, asked, totalPages) {
  const page = Number(asked.searchParams.get('page'))

  if (!(page < totalPages)) return link.remove()

  asked.searchParams.set('page', page + 1)

  link.href = `${asked.pathname}${asked.search}`
}
