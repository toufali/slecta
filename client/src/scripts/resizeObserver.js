const resizeObserver = new ResizeObserver(handleResize)
const header = document.querySelector('body > header')
const filter = document.querySelector('.filter-panel')

if (header) resizeObserver.observe(header)
// if (filter) resizeObserver.observe(filter)

function handleResize(entries) {
  let size

  entries.forEach((entry) => {
    switch (entry.target) {
      case header:
        document.documentElement.style.setProperty('--header-bottom', `${header.getBoundingClientRect().bottom}px`)
        break
      case filter:
        size = entry.borderBoxSize[0].inlineSize
        if (size && document.documentElement.hasAttribute('desktop')) {
          document.documentElement.style.setProperty('--filter-w', `${Math.round(size)}px`)
        } else {
          document.documentElement.style.removeProperty('--filter-w')
        }
        break
    }
  })
}