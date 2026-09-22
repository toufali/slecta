const disjunction = new Intl.ListFormat('en-US', { type: 'disjunction' })

export function namesText(ids, names) {
  const found = ids.map(id => names.get(parseInt(id))).filter(Boolean)

  return found.length > 3 ? `${found.slice(0, 3).join(', ')}, etc` : disjunction.format(found)
}
