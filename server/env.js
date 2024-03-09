const requiredKeys = [
  'TMDB_TOKEN',
  'TMDB_API_URL'
]

const optionalKeys = [
  'PORT',
  'REDISHOST',
  'REDISPORT'
]

const env = {
  // STATIC_DIR set to 'src' if `npm run dev` called. Files are served direct from source without build/bundle
  // else, default to 'dist'. Client build required to serve files from bundle
  STATIC_DIR: process.env.npm_lifecycle_event === 'dev' ? 'src' : 'dist'
}

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