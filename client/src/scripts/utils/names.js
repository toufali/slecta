export function namesText(ids, names) {
  const found = ids.map(id => names.get(parseInt(id)))

  return found.length > 2 ? `${found.slice(0, 2).join(', ')}, etc` : found.join(' or ')
}
