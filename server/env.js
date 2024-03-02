const requiredKeys = [
  'TMDB_TOKEN',
  'TMDB_API_URL'
]

const optionalKeys = [
  'PORT',
]

const env = {
  STATIC_DIR: process.env.npm_lifecycle_event === 'start' ? 'dist' : 'src',
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

console.log('process.env.TMDB_API_URL:', process.env.TMDB_API_URL)
console.log('env.js all done. TMDB_API_URL:', env.TMDB_API_URL)

export default Object.freeze(env)