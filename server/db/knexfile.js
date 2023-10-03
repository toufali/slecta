import dotenv from 'dotenv' // can't use env.js because it's not imported in npm script

dotenv.config({ path: '../../.env' })

export default {
  client: 'pg',
  connection: process.env.DATABASE_URL,
  migrations: {
    directory: "migrations",
  },
  pool: {
    min: 0, // https://knexjs.org/guide/#pool "...recommended to set min: 0 so all idle connections can be terminated"
    max: 10,
    afterCreate: (conn, done) => {
      console.log("Postgres connected.");
      done();
    },
  }
}
