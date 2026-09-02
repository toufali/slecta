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

/**
 * Coerce an external sample size to a positive integer, or undefined when there is none.
 * A zero is a source with nothing to count, which is the same as not reporting one.
 * Parsed strictly, not with parseInt: `parseInt('1,234')` is 1, and a thick component
 * reading as thin is worse than one carrying no count at all.
 * @param {*} value
 * @return {(number|undefined)}
 */
export function toCount(value) {
  const count = Number(value)
  return Number.isInteger(count) && count > 0 ? count : undefined
}

/**
 * Read the lower bound out of a banded count such as `"250+ Ratings"`.
 * A band with no floor — `"Fewer than 50"` — has nothing usable in it.
 * @param {*} value
 * @return {(number|undefined)}
 */
export function toFloor(value) {
  return toCount(String(value ?? '').replace(/,/g, '').match(/^(\d+)\+/)?.[1])
}
