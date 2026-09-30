// Newest-first already shows the newest titles, so a release limit only truncates the tail
export const newestFirst = sort => String(sort).endsWith('_date.desc')
