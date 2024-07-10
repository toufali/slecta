/**
 * Wraps a given function to debounce it by a delay in milliseconds.
 * @param {function} func
 * @param {number} delay
 * @return {function}
 * @example `el.addEventListener('input', debounce(handleInput))` where `handleInput` is the function doing the work
 */
export function debounce(func, delay = 400) {
  let timeout
  return (...args) => {
    clearTimeout(timeout)
    timeout = setTimeout(() => { func.apply(this, args); }, delay)
  };
}