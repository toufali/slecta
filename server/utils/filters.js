// Reject filter values the list routes cannot honour: left alone, an unknown genre id or the
// other media type's sort key becomes a 500, at TMDB or in the view's label lookup.

// A repeated single-value filter arrives as an array and reaches the view as one — its own 500.
const MULTI = new Set(['wg', 'wog', 'wr'])

// A filter may arrive repeated (`wg=27&wg=878`) or comma-joined (`wg=27,878`).
const parts = value => [value].flat().flatMap(item => String(item).split(','))

// Digits only: `Number()` also takes `0x1b` and `1e2`, which pass a genre lookup but match nothing at TMDB.
const isCount = value => /^\d+$/.test(value)

const CHECKS = {
  page: (value, { pageMax }) => isCount(value) && +value >= 1 && +value <= pageMax,
  count: value => isCount(value),
  sort: (value, { sorts }) => sorts.some(option => option.value === value),
  wg: (value, { genres }) => isCount(value) && genres.has(+value),
  wog: (value, { genres }) => isCount(value) && genres.has(+value),
  // TV certifications are a separate vocabulary (TV-MA…) the TV route never fetches or sends,
  // so with no list supplied `wr` goes unjudged rather than held to the film list.
  wr: (value, { ratings }) => !ratings || ratings.some(rating => rating.certification === value)
}

/**
 * Name the filter params the request cannot honour. Params we do not use are ignored, so
 * tracking parameters and scanner noise still get a page.
 * @param {object} query - `ctx.query`
 * @param {object} rules - `{ pageMax, sorts, genres, ratings }` for the requested media type
 * @return {string[]}
 */
export function invalidFilters(query, rules) {
  if (isPolluted(query)) return ['__proto__']

  return Object.keys(query).filter(name => {
    // hasOwn, so a param named after an Object.prototype member is not read as a check
    if (!Object.hasOwn(CHECKS, name)) return false

    const values = parts(query[name])

    if (values.length === 1 && !values[0]) return false // a lone empty value means absent
    if (values.length > 1 && !MULTI.has(name)) return true

    return !values.every(value => value && CHECKS[name](value, rules))
  })
}

// Koa's parser assigns each key onto a plain object, so a repeated `__proto__` goes through the
// inherited setter and becomes the query's prototype: `query.sort` then resolves to
// `Array.prototype.sort` and reaches TMDB. It never appears in `Object.keys`, hence this check.
function isPolluted(query) {
  const proto = Object.getPrototypeOf(query)

  return proto !== Object.prototype && proto !== null
}
