// Newest-first already shows the newest titles, so a lookback bound only truncates the tail
export const newestFirst = sort => String(sort).endsWith('_date.desc')
