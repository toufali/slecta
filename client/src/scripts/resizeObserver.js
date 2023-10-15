const resizeObserver = new ResizeObserver(handleResize)
const filter = document.querySelector('.movies-filter')

function handleResize(entries) {
  let size

  entries.forEach((entry) => {
    switch (entry.target) {
      case filter:
        size = entry.borderBoxSize[0].inlineSize
        if (size && document.documentElement.hasAttribute('desktop')) {
          document.documentElement.style.setProperty('--filter-w', `${Math.round(size)}px`)
        } else {
          document.documentElement.style.removeProperty('--filter-w')
        }
    }
  })
}

if (filter) resizeObserver.observe(filter)
