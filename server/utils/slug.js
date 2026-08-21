/**
 * Convert a title into a URL slug, in the shape Rotten Tomatoes and Metacritic use.
 * Accents flatten, apostrophes vanish so possessives stay whole, and every other run of
 * punctuation collapses to a single separator.
 * Live-checked: `the_devil_s_mouth` and `sara___woman_in_the_shadow` both 404.
 * @param {string} title
 * @param {string} separator - `_` for Rotten Tomatoes, `-` for Metacritic
 * @return {string}
 */
export function slugify(title, separator) {
  return title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, separator)
    .replace(new RegExp(`^${separator}+|${separator}+$`, 'g'), '')
}
