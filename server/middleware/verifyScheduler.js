// Verifies a Cloud Scheduler OIDC token. Lives in the app rather than Cloud Run IAM, because
// the service must stay invokable without IAM auth to serve the public site.

import { createPublicKey, verify } from 'node:crypto'
import env from '../env.js'
import log from '../utils/logger.js'

const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs'
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com']
const CLOCK_SKEW = 60 // seconds
const CERTS_TIMEOUT = 5000

// An unreachable key provider is our failure, not the caller's, and must not read as a 403
class KeyProviderError extends Error {}

let keyCache = { keys: new Map(), expires: 0 }
let refreshing = null

async function getKey(kid) {
  // Shared promise: this route is reachable before a token is validated, so without it a
  // burst on a cold instance fans out into one outbound fetch per request
  if (keyCache.expires < Date.now()) {
    refreshing ??= refreshKeys().finally(() => { refreshing = null })
    await refreshing
  }

  return keyCache.keys.get(kid)
}

async function refreshKeys() {
  try {
    const res = await fetch(CERTS_URL, { signal: AbortSignal.timeout(CERTS_TIMEOUT) })

    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)

    const { keys } = await res.json()
    // Google rotates these, so reuse only for as long as it says to. `max-age=0` is a valid
    // directive meaning revalidate now, so it must not fall through to the default.
    const maxAge = Number(res.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1])

    keyCache = {
      keys: new Map(keys.map(jwk => [jwk.kid, createPublicKey({ key: jwk, format: 'jwk' })])),
      expires: Date.now() + (Number.isFinite(maxAge) ? maxAge : 3600) * 1000
    }
  } catch (e) {
    throw new KeyProviderError(`Unable to fetch Google signing keys: ${e.message}`)
  }
}

function decodeSegment(segment) {
  return JSON.parse(Buffer.from(segment, 'base64url').toString())
}

async function verifyToken(token) {
  const segments = token.split('.')

  if (segments.length !== 3 || segments.some(segment => !segment)) throw new Error('malformed token')

  const [encodedHeader, encodedPayload, encodedSignature] = segments

  const header = decodeSegment(encodedHeader)

  if (header.alg !== 'RS256') throw new Error(`unexpected algorithm ${header.alg}`)

  const key = await getKey(header.kid)

  if (!key) throw new Error(`unknown key id ${header.kid}`)

  const signed = verify(
    'RSA-SHA256',
    Buffer.from(`${encodedHeader}.${encodedPayload}`),
    key,
    Buffer.from(encodedSignature, 'base64url')
  )

  if (!signed) throw new Error('signature mismatch')

  const payload = decodeSegment(encodedPayload)
  const now = Math.floor(Date.now() / 1000)

  if (!ISSUERS.includes(payload.iss)) throw new Error(`unexpected issuer ${payload.iss}`)
  if (!Number.isFinite(payload.exp) || !Number.isFinite(payload.iat)) throw new Error('missing timestamps')
  if (payload.exp + CLOCK_SKEW < now) throw new Error('token expired')
  if (payload.iat - CLOCK_SKEW > now) throw new Error('token issued in the future')
  if (payload.aud !== env.SCHEDULER_AUDIENCE) throw new Error('audience mismatch')
  if (payload.email !== env.SCHEDULER_SERVICE_ACCOUNT || !payload.email_verified) throw new Error('caller not authorised')

  return payload
}

export async function verifyScheduler(ctx, next) {
  // Reject when unconfigured: a missing env var must not leave this route open
  if (!env.SCHEDULER_AUDIENCE || !env.SCHEDULER_SERVICE_ACCOUNT) {
    log.error('Scheduler auth is not configured; rejecting')
    ctx.status = 503
    return
  }

  const token = ctx.get('authorization').match(/^Bearer (.+)$/i)?.[1]

  if (!token) {
    ctx.status = 401
    return
  }

  try {
    await verifyToken(token)
  } catch (e) {
    if (e instanceof KeyProviderError) {
      log.error('Cannot verify scheduler token', { reason: e.message })
      ctx.status = 503
      return
    }

    log.warn('Rejected scheduler request', { reason: e.message, ip: ctx.ip })
    ctx.status = 403
    return
  }

  await next()
}
