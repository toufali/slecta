import { throttle } from './utils/time.js'

let prevScrollY

window.addEventListener('scroll', throttle(handleScroll))

function handleScroll(e) {
  if (!prevScrollY) return prevScrollY = window.scrollY // avoid scroll behavior on page reload

  const dir = window.scrollY > prevScrollY ? 'down' : 'up'

  document.documentElement.setAttribute('data-scroll-dir', dir)
  prevScrollY = window.scrollY
}