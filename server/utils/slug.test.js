import { test } from 'node:test'
import assert from 'node:assert/strict'
import { slugify } from './slug.js'

// Every case was live-checked against Rotten Tomatoes or Metacritic. Where a comment says
// "was", that is what an earlier version of slugify produced, and it 404'd.

test('accents flatten to plain letters', () => {
  assert.equal(slugify('Amélie', '_'), 'amelie') // was: amlie
  assert.equal(slugify('Comédie-Française', '-'), 'comedie-francaise')
})

test('dashes act as word separators', () => {
  assert.equal(slugify('Spider-Man: No Way Home', '_'), 'spider_man_no_way_home') // was: spiderman_no_way_home
  assert.equal(slugify('WALL-E', '_'), 'wall_e') // was: walle
})

test('runs of punctuation collapse to one separator', () => {
  assert.equal(slugify('Sara - Woman in the Shadow', '_'), 'sara_woman_in_the_shadow') // was: sara___woman_in_the_shadow
  assert.equal(slugify('Tick, Tick... Boom!', '_'), 'tick_tick_boom')
})

test('apostrophes drop rather than splitting the word', () => {
  assert.equal(slugify("The Devil's Mouth", '_'), 'the_devils_mouth') // collapsing alone gives: the_devil_s_mouth
  assert.equal(slugify('Am I OK?', '_'), 'am_i_ok') // no trailing separator
})

test('each source gets its own separator', () => {
  assert.equal(slugify('Dune: Part Two', '_'), 'dune_part_two') // Rotten Tomatoes
  assert.equal(slugify('Dune: Part Two', '-'), 'dune-part-two') // Metacritic
})
