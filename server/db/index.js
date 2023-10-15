import Knex from 'knex'
import knexConfig from './knexfile.js'

export const knex = Knex(knexConfig)
