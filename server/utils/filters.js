// Reject filter values the list routes cannot honour. TMDB answers 200 and ignores an unknown
// sort key, or returns nothing for an unknown genre, so the 500 comes from the view: it looks
// every active filter up for a label and hands `Intl.ListFormat` the undefined it gets back.

// Only the panel's own form is accepted: one param repeated per value, which TMDB reads as OR.
// Comma-joined `27,878` means AND to TMDB, labels one genre, and leaves the boxes unchecked.
const MULTI = new Set(['wg', 'wog', 'wr'])

// Digits only: `Number()` also takes `0x1b` and `1e2`, which pass a genre lookup but match nothing at TMDB.
export const isCount = value => /^\d+$/.test(value)

const isGenre = (value, { genres }) => isCount(value) && genres.has(+value)

const CHECKS = {
  page: (value, { pageMax }) => isCount(value) && +value >= 1 && +value <= pageMax,
  count: (value, { countMax }) => isCount(value) && +value <= countMax,
  sort: (value, { sorts }) => sorts.some(option => option.value === value),
  // Only the panel's own value. Anything else applies the filter while the page renders it off.
  streaming: value => value === 'on',
  wg: isGenre,
  wog: isGenre,
  // TV certifications are a separate vocabulary (TV-MA…) the TV route never fetches or sends,
  // so with no list supplied `wr` goes unjudged rather than held to the film list.
  wr: (value, { ratings }) => !ratings || ratings.some(rating => rating.certification === value)
}

/**
 * Name the filter params the request cannot honour. Params we do not use are ignored, so
 * tracking parameters and scanner noise still get a page.
 * @param {object} query - `ctx.query`
 * @param {object} rules - `{ pageMax, countMax, sorts, genres, ratings }` for the media type
 * @return {string[]}
 */
export function invalidFilters(query, rules) {
  return Object.keys(query).filter(name => {
    // hasOwn, so a param named after an Object.prototype member is not read as a check
    if (!Object.hasOwn(CHECKS, name)) return false

    const values = [query[name]].flat()

    if (values.length === 1 && !values[0]) return false // a lone empty value means absent
    if (values.length > 1 && !MULTI.has(name)) return true // an array reaches the view as an array

    return !values.every(value => value && CHECKS[name](value, rules))
  })
}

/**
 * Replace `ctx.query` with a plain object holding only its own keys, before any route reads it.
 * Koa caches parsed queries in a `{}` keyed by the querystring, which leaks two ways: `?toString`
 * finds a function up the prototype chain and returns it as the query, and a repeated key that
 * Object.prototype defines with a setter lands on the prototype instead of the object, leaving
 * inherited members like `sort` readable as filters. Spread rather than assign — assign would
 * trip the same setter.
 */
export function plainQuery(ctx, next) {
  const query = ctx.request.query
  const proto = query && typeof query === 'object' ? Object.getPrototypeOf(query) : undefined

  if (proto !== Object.prototype && proto !== null) {
    Object.defineProperty(ctx.request, 'query', { value: { ...query }, configurable: true })
  }

  return next()
}
