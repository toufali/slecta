export function namesText(ids, names) {
  const found = ids.map(id => names.get(parseInt(id)))

  return found.length > 3 ? `${found.slice(0, 3).join(', ')}, etc` : found.join(' or ')
}
