// Sent from script, so a request for the HTML alone never counts as a page view

const device = matchMedia('(pointer: coarse)').matches
  ? Math.min(screen.width, screen.height) < 600 ? 'mobile' : 'tablet'
  : 'desktop'

// Visiting /#owner marks this browser's views as the owner's; storage throws where blocked
function owner() {
  try {
    if (location.hash === '#owner') localStorage.setItem('owner', 'true')
    return localStorage.getItem('owner') === 'true'
  } catch {
    return false
  }
}

function send() {
  if (navigator.webdriver) return

  const params = new URLSearchParams({
    name: 'pageview', page: location.pathname, device, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
  })

  if (document.referrer) params.set('referrer', new URL(document.referrer).hostname)
  if (owner()) params.set('owner', 'true')

  // Absent where disabled; a throw here would stop the page's other scripts
  navigator.sendBeacon?.(`/api/v1/events?${params}`)
}

// A prerendered page counts once it is shown, if ever
if (document.prerendering) document.addEventListener('prerenderingchange', send, { once: true })
else send()
