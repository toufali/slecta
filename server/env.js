import dotenv from 'dotenv'

dotenv.config({ path: '../.env' })

const env = {
  STATIC_DIR: process.env.npm_lifecycle_event === 'start' ? 'dist' : 'src'
}

const requiredKeys = [
  'TMDB_TOKEN'
]

const optionalKeys = [
  'PORT',
]

requiredKeys.forEach(key => {
  const value = process.env[key]
  if (value === undefined) throw new Error(`Required environment variable was not set: ${key}`)
  env[key] = value
})

optionalKeys.forEach(key => {
  const value = process.env[key]
  if (value) env[key] = value
})

export default Object.freeze(env)