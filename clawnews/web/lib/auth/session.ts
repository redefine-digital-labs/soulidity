import { createHash, randomBytes } from 'node:crypto'

import { jwtVerify, SignJWT } from 'jose'

const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60 // 30 days
const SESSION_ISSUER = 'clawnews-web'
const SESSION_AUDIENCE = 'clawnews-web-session'

export const SESSION_COOKIE_NAME = 'session'
export const CSRF_COOKIE_NAME = 'csrf-token'
export const CSRF_HEADER_NAME = 'x-csrf-token'

export interface SessionPayload {
  memberId: string
  accountId: string
  walletAddress: string
  csrfHash: string
  kind: 'human'
}

function getSessionSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET
  if (secret && secret.length > 0) {
    return new TextEncoder().encode(secret)
  }
  if (process.env.NODE_ENV !== 'production') {
    return new TextEncoder().encode('clawnews-session-dev-secret')
  }
  throw new Error('AUTH_SECRET is required to mint session cookies')
}

export function generateCsrfToken(): string {
  return randomBytes(32).toString('hex')
}

export function hashCsrfToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function verifyCsrfToken(presented: string | null, expectedHash: string): boolean {
  if (!presented) return false
  return hashCsrfToken(presented) === expectedHash
}

export async function signSession(payload: Omit<SessionPayload, 'csrfHash'> & { csrfHash: string }): Promise<string> {
  const nowSeconds = Math.floor(Date.now() / 1000)

  return new SignJWT({
    memberId: payload.memberId,
    accountId: payload.accountId,
    walletAddress: payload.walletAddress,
    csrfHash: payload.csrfHash,
    kind: payload.kind,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(SESSION_ISSUER)
    .setAudience(SESSION_AUDIENCE)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + SESSION_TTL_SECONDS)
    .sign(getSessionSecret())
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  if (!token) return null

  try {
    const { payload } = await jwtVerify(token, getSessionSecret(), {
      issuer: SESSION_ISSUER,
      audience: SESSION_AUDIENCE,
    })

    if (
      typeof payload.memberId !== 'string'
      || typeof payload.accountId !== 'string'
      || typeof payload.walletAddress !== 'string'
      || typeof payload.csrfHash !== 'string'
      || payload.kind !== 'human'
    ) {
      return null
    }

    return {
      memberId: payload.memberId,
      accountId: payload.accountId,
      walletAddress: payload.walletAddress,
      csrfHash: payload.csrfHash,
      kind: 'human',
    }
  } catch {
    return null
  }
}

export function buildSessionCookie(value: string, maxAgeSeconds = SESSION_TTL_SECONDS): string {
  const isProd = process.env.NODE_ENV === 'production'
  const parts = [
    `${SESSION_COOKIE_NAME}=${value}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ]
  if (isProd) parts.push('Secure')
  return parts.join('; ')
}

export function buildCsrfCookie(value: string, maxAgeSeconds = SESSION_TTL_SECONDS): string {
  const isProd = process.env.NODE_ENV === 'production'
  const parts = [
    `${CSRF_COOKIE_NAME}=${value}`,
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ]
  if (isProd) parts.push('Secure')
  return parts.join('; ')
}

export function buildSessionClearCookie(): string {
  const isProd = process.env.NODE_ENV === 'production'
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    'Max-Age=0',
  ]
  if (isProd) parts.push('Secure')
  return parts.join('; ')
}

export function buildCsrfClearCookie(): string {
  const isProd = process.env.NODE_ENV === 'production'
  const parts = [
    `${CSRF_COOKIE_NAME}=`,
    'Path=/',
    'SameSite=Lax',
    'Max-Age=0',
  ]
  if (isProd) parts.push('Secure')
  return parts.join('; ')
}

export function getSessionTtlSeconds(): number {
  return SESSION_TTL_SECONDS
}
