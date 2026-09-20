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

/**
 * Inverse of the standard normal CDF: the z-score below which a given share of a normal
 * population falls — inverseNormal(0.94) is about 1.55, the 94th percentile sitting 1.55
 * standard deviations above the mean. No closed form exists, so this is Acklam's
 * approximation: a ratio of two polynomials fits the middle of the range, a second pair the
 * tails. The coefficients are the published constants of that fit, good to |error| < 1.2e-9.
 * @param {number} p probability, exclusive of 0 and 1
 * @return {number}
 */
const CENTRAL_NUMERATOR = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239]
const CENTRAL_DENOMINATOR = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572, 1]
const TAIL_NUMERATOR = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
const TAIL_DENOMINATOR = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416, 1]
const TAIL_BELOW = 0.02425

const polynomial = (coefficients, x) => coefficients.reduce((sum, coefficient) => sum * x + coefficient, 0)

export function inverseNormal(p) {
  if (!(p > 0 && p < 1)) return p <= 0 ? -Infinity : Infinity

  if (p < TAIL_BELOW || p > 1 - TAIL_BELOW) {
    const q = Math.sqrt(-2 * Math.log(Math.min(p, 1 - p)))
    const z = polynomial(TAIL_NUMERATOR, q) / polynomial(TAIL_DENOMINATOR, q)

    return p < TAIL_BELOW ? z : -z
  }

  const q = p - 0.5
  const r = q * q

  return q * polynomial(CENTRAL_NUMERATOR, r) / polynomial(CENTRAL_DENOMINATOR, r)
}
