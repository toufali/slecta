const device = matchMedia('(pointer: coarse)').matches
  ? Math.min(screen.width, screen.height) < 600 ? 'mobile' : 'tablet'
  : 'desktop'

const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone

// Visiting /#owner marks this browser's views as the owner's; storage throws where blocked
function isOwner() {
  try {
    if (location.hash === '#owner') localStorage.setItem('owner', 'true')
    return localStorage.getItem('owner') === 'true'
  } catch {
    return false
  }
}

const owner = isOwner()

export function sendEvent(name, fields) {
  if (navigator.webdriver) return

  const params = new URLSearchParams({ name, page: location.pathname, device, timeZone, owner, ...fields })

  // Absent where disabled; a throw here would stop the page's other scripts
  navigator.sendBeacon?.(`/api/v1/events?${params}`)
}
