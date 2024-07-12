/**
 * Wraps a given function to debounce it by a delay in milliseconds.
 * @param {function} func
 * @param {number} delay
 * @return {function}
 * @example `el.addEventListener('input', debounce(handleInput))` where `handleInput` is the function to debounce
 */
export function debounce(func, delay = 400) {
  let timeout

  return (...args) => {
    clearTimeout(timeout)
    timeout = setTimeout(() => { func.apply(this, args) }, delay)
  };
}

/**
 * Wraps a given function to throttle it by a delay in milliseconds.
 * Function is called immediately as well as the final call made during throttle
 * @param {function} func
 * @param {number} delay
 * @return {function}
 * @example `el.addEventListener('scroll', throttle(handleScroll))` where `handleScroll` is the function to throttle
 */
export function throttle(func, delay = 300) {
  let timeout, lastCall

  return (...args) => {
    if (!lastCall) func(...args) // first call

    if (timeout) return lastCall = func

    timeout = setTimeout(() => {
      if (lastCall) lastCall(...args) // last call
      lastCall = null
      timeout = null
    }, delay)
  }
}

