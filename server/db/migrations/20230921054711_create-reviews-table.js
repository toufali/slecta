/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export function up(knex) {
  return knex.schema
    .createTable('reviews', function (table) {
      table.increments('id')
      table.string('title', 500)
      table.date('release_date')
      table.string('wiki_id', 100).unique()
      table.integer('tmdb_id').unique()
      table.float('tmdb_score', 4, 2)
      table.string('imdb_id', 100).unique()
      table.float('imdb_score', 4, 2)
      table.string('rt_path', 500)
      table.float('rt_score', 4, 2)
      table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable()
      table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable()
    })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export function down(knex) {
  return knex.schema
    .dropTable("reviews")
}
