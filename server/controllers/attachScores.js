import scoreService, { scoreKey } from '../services/scoreService.js'

// Attaches each row's cached badge in place. Settled, so an unreadable record costs one badge
// rather than the whole list — and cache only, because a page render never fetches a source.
export async function attachScores(items, segment) {
  const scores = await Promise.allSettled(
    items.map(item => scoreService.getScoreFromCache(scoreKey(segment, item.id)))
  )

  scores.forEach((score, i) => {
    if (score.value?.avgScore !== undefined) items[i].score = score.value.avgScore
  })
}
