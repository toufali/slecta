/**
 * Calculate average from an array of numbers. 
 * Values that are NaN or Infinity are skipped.
 * @param {number[]} arr
 * @return {(number|NaN)}
 */
export function average(arr) {
  let len = arr.length
  const sum = arr.reduce((acc, cur) => {
    if (Number.isFinite(cur)) return acc + cur

    len--
    return acc
  }, 0)

  if (len === 0) return NaN

  return sum / len
}