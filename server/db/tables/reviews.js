import { knex } from '../index.js'

const reviews = {
  async getScores(tmdbId) {
    const res = await knex.first('imdb_score', 'rt_score')
      .from('reviews')
      .where('tmdb_id', tmdbId)

    return res
  },
  async getRTPath(wikiId) {
    const res = await knex.first('rt_path')
      .from('reviews')
      .where('wiki_id', wikiId)

    return res
  },
  async upsert(data) {
    const timestamp = new Date();
    const res = await knex('reviews')
      .insert({
        title: data.title,
        release_date: data.releaseDate,
        wiki_id: data.wikiId,
        tmdb_id: data.tmdbId,
        tmdb_score: data.tmdbScore,
        imdb_id: data.imdbId,
        imdb_score: data.imdbScore,
        rt_path: data.rtPath,
        rt_score: data.rtScore,
        created_at: timestamp,
        updated_at: timestamp,
      })
      .onConflict('wiki_id', 'tmdb_id', 'imdb_id')
      .merge(['title', 'release_date', 'wiki_id', 'tmdb_id', 'tmdb_score', 'imdb_id', 'imdb_score', 'rt_path', 'rt_score', 'updated_at'])

    return res[0]
  }
}

export { reviews }