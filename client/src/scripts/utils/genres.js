// Two genres stand for the rest: the panel holds the full list
export function genreText(withGenres, allGenres) {
  const names = withGenres.map(genre => allGenres.get(parseInt(genre)))

  return names.length > 2 ? `${names.slice(0, 2).join(', ')}, etc` : names.join(' or ')
}
