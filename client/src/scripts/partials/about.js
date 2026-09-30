const critics = document.querySelector('.critics')

// Turn the cards as the score gauges grow: after the page's transition, once the whole row is on screen
export default async function init() {
  await (document.activeViewTransition?.finished ?? Promise.resolve())

  new IntersectionObserver(([entry], observer) => {
    if (!entry.isIntersecting) return
    critics.removeAttribute('data-hold')
    observer.disconnect()
  }, { threshold: .99, rootMargin: '0px 100%' }).observe(critics.querySelector('ol'))
}
