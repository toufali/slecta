/**
 * Calculate average from an array of numbers. 
 * Values that are NaN or Infinity are skipped.
 * @param {number[]} arr
 * @return {(number|NaN)}
 */
export function average(arr) {
  let len = arr.length
  const sum = arr.reduce((acc, cur) => {
    if (Number.isFinite(cur)) return acc + cur // include in average if Number is not NaN, Infinity, or -Infinity

    len--
    return acc
  }, 0)

  if (len === 0) return NaN

  return sum / len
}

/**
 * Coerce an external score to an integer, or undefined when there is no usable number.
 * A genuine 0 is kept — Rotten Tomatoes can legitimately report 0%.
 * @param {*} value
 * @return {(number|undefined)}
 */
export function toScore(value) {
  const score = parseInt(value)
  return Number.isFinite(score) ? score : undefined
}
