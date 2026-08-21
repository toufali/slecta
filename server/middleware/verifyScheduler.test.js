import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'

// env.js validates at import time. AUDIENCE and SERVICE_ACCOUNT are the values a token must
// match; the rest are unrelated keys env.js insists on.
process.env.SCHEDULER_AUDIENCE ??= 'https://slecta.com'
process.env.SCHEDULER_SERVICE_ACCOUNT ??= 'cron@example.com'
for (const key of ['TMDB_TOKEN', 'TMDB_API_URL', 'GCP_API_URL', 'GCP_API_KEY', 'GCP_SEARCH_ENGINE']) {
  process.env[key] ??= 'test'
}

// Imported after the env is set — static imports are hoisted and would run env.js first
const { verifyScheduler } = await import('./verifyScheduler.js')

// Our own signing key, published through a stubbed certs endpoint, so tokens can be minted
// with any claims and still pass the real signature check
const KID = 'test-key'
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwks = { keys: [{ kid: KID, alg: 'RS256', use: 'sig', ...publicKey.export({ format: 'jwk' }) }] }

const NOW = () => Math.floor(Date.now() / 1000)
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url')

function mint(claims = {}, { alg = 'RS256', kid = KID, signed = true } = {}) {
  const body = `${b64({ alg, kid, typ: 'JWT' })}.${b64({
    iss: 'https://accounts.google.com',
    aud: process.env.SCHEDULER_AUDIENCE,
    email: process.env.SCHEDULER_SERVICE_ACCOUNT,
    email_verified: true,
    exp: NOW() + 3600,
    iat: NOW(),
    ...claims
  })}`
  const signature = signed
    ? sign('RSA-SHA256', Buffer.from(body), privateKey).toString('base64url')
    : Buffer.from('not-a-signature').toString('base64url')

  return `${body}.${signature}`
}

const realFetch = globalThis.fetch
// max-age=0 so the cache expires immediately and cannot leak between tests
const serveKeys = () => { globalThis.fetch = async () => new Response(JSON.stringify(jwks), { status: 200, headers: { 'cache-control': 'max-age=0' } }) }
// The cache is checked with `expires < Date.now()`, so a max-age=0 entry is still fresh within
// the same millisecond. Tests that need a genuinely cold cache wait for the clock to move on.
const coldCache = () => new Promise(resolve => setTimeout(resolve, 2))
afterEach(() => { globalThis.fetch = realFetch })

async function request(token) {
  const ctx = { status: 0, ip: '203.0.113.1', get: () => (token === undefined ? '' : `Bearer ${token}`) }
  let reached = false
  await verifyScheduler(ctx, async () => { reached = true })
  return { status: ctx.status, reached }
}

test('a correctly signed token with valid claims runs the job', async () => {
  serveKeys()
  assert.deepEqual(await request(mint()), { status: 0, reached: true })
})

test('no token is unauthorised, and does not even fetch keys', async () => {
  globalThis.fetch = async () => assert.fail('should not fetch keys without a token')
  assert.deepEqual(await request(undefined), { status: 401, reached: false })
})

test('a forged signature is rejected', async () => {
  serveKeys()
  assert.deepEqual(await request(mint({}, { signed: false })), { status: 403, reached: false })
})

test('a token signed by an unknown key is rejected', async () => {
  serveKeys()
  assert.deepEqual(await request(mint({}, { kid: 'someone-elses-key' })), { status: 403, reached: false })
})

test('a trailing fourth segment is malformed, not ignored', async () => {
  serveKeys()
  assert.deepEqual(await request(mint() + '.garbage'), { status: 403, reached: false })
})

test('absent or non-numeric timestamps are rejected', async () => {
  // `undefined + 60 < now` is NaN < now, which is false — both time checks used to pass
  serveKeys()
  assert.deepEqual(await request(mint({ exp: undefined })), { status: 403, reached: false })
  assert.deepEqual(await request(mint({ iat: undefined })), { status: 403, reached: false })
  assert.deepEqual(await request(mint({ exp: 'soon' })), { status: 403, reached: false })
})

test('expired and future-dated tokens are rejected, within a little skew', async () => {
  serveKeys()
  assert.deepEqual(await request(mint({ exp: NOW() - 120 })), { status: 403, reached: false })
  assert.deepEqual(await request(mint({ iat: NOW() + 120 })), { status: 403, reached: false })
  assert.deepEqual(await request(mint({ exp: NOW() - 30 })), { status: 0, reached: true }) // inside 60s skew
})

test('issuer, audience and caller identity must all match', async () => {
  serveKeys()
  assert.deepEqual(await request(mint({ iss: 'https://evil.example' })), { status: 403, reached: false })
  assert.deepEqual(await request(mint({ aud: 'https://other.example' })), { status: 403, reached: false })
  assert.deepEqual(await request(mint({ email: 'someone@else.com' })), { status: 403, reached: false })
  assert.deepEqual(await request(mint({ email_verified: false })), { status: 403, reached: false })
})

test('an unreachable key provider is 503, not 403', async () => {
  // 403 tells Cloud Scheduler the caller is wrong and will never succeed; this is our outage
  await coldCache()
  globalThis.fetch = async () => { throw new Error('ECONNREFUSED') }
  assert.deepEqual(await request(mint()), { status: 503, reached: false })
})

test('concurrent requests on a cold cache share one key fetch', async () => {
  // Reachable before a token is validated, so one fetch per request is an amplification vector
  await coldCache()
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    await new Promise(resolve => setTimeout(resolve, 50))
    throw new Error('ECONNREFUSED')
  }

  const results = await Promise.all(Array.from({ length: 8 }, () => request(mint())))

  assert.equal(calls, 1)
  assert.deepEqual([...new Set(results.map(r => r.status))], [503])
})
