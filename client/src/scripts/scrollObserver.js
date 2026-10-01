import { throttle } from './utils/time.js'

const header = document.querySelector('body > header')
let prevScrollY

window.addEventListener('scroll', throttle(handleScroll))

function handleScroll(e) {
  if (prevScrollY === undefined) return prevScrollY = window.scrollY // avoid scroll behavior on page reload

  // Shown within its own height of the top, where iOS lets the page pull past 0 and spring back
  const nearTop = window.scrollY <= header.offsetHeight

  if (!nearTop && Math.abs(window.scrollY - prevScrollY) < 5) return // only handle when difference is greater than 5 lines

  const dir = !nearTop && window.scrollY > prevScrollY ? 'down' : 'up'

  document.documentElement.setAttribute('data-scroll-dir', dir)
  prevScrollY = window.scrollY
}
