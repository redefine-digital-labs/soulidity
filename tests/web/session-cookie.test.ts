import { beforeEach, describe, expect, it } from 'vitest'

import {
  buildCsrfClearCookie,
  buildCsrfCookie,
  buildSessionClearCookie,
  buildSessionCookie,
  CSRF_COOKIE_NAME,
  generateCsrfToken,
  hashCsrfToken,
  SESSION_COOKIE_NAME,
  signSession,
  verifyCsrfToken,
  verifySession,
} from '../../web/lib/auth/session.ts'

describe('session cookie utilities', () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = 'test-secret-for-session-jwt'
    process.env.NODE_ENV = 'test'
  })

  it('signs and verifies a session payload', async () => {
    const csrfToken = generateCsrfToken()
    const csrfHash = hashCsrfToken(csrfToken)
    const token = await signSession({
      memberId: 'member-1',
      accountId: 'account-1',
      walletAddress: '0xabc',
      csrfHash,
      kind: 'human',
    })

    const payload = await verifySession(token)
    expect(payload).toEqual({
      memberId: 'member-1',
      accountId: 'account-1',
      walletAddress: '0xabc',
      csrfHash,
      kind: 'human',
    })
  })

  it('rejects a tampered session token', async () => {
    const csrfHash = hashCsrfToken(generateCsrfToken())
    const token = await signSession({
      memberId: 'member-1',
      accountId: 'account-1',
      walletAddress: '0xabc',
      csrfHash,
      kind: 'human',
    })
    const tampered = `${token.slice(0, -2)}AA`

    await expect(verifySession(tampered)).resolves.toBeNull()
  })

  it('rejects a session token signed with a different secret', async () => {
    const csrfHash = hashCsrfToken(generateCsrfToken())
    const token = await signSession({
      memberId: 'member-1',
      accountId: 'account-1',
      walletAddress: '0xabc',
      csrfHash,
      kind: 'human',
    })

    process.env.AUTH_SECRET = 'a-completely-different-secret'
    await expect(verifySession(token)).resolves.toBeNull()
  })

  it('rejects an empty session token', async () => {
    await expect(verifySession('')).resolves.toBeNull()
  })

  it('verifies CSRF tokens by hash equality', () => {
    const token = generateCsrfToken()
    const hash = hashCsrfToken(token)

    expect(verifyCsrfToken(token, hash)).toBe(true)
    expect(verifyCsrfToken(`${token}xx`, hash)).toBe(false)
    expect(verifyCsrfToken(null, hash)).toBe(false)
  })

  it('builds session and csrf cookies with HttpOnly + Lax + Path scope', () => {
    const cookie = buildSessionCookie('jwt-value')
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=jwt-value`)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toMatch(/Max-Age=\d+/)

    const csrfCookie = buildCsrfCookie('csrf-value')
    expect(csrfCookie).toContain(`${CSRF_COOKIE_NAME}=csrf-value`)
    expect(csrfCookie).not.toContain('HttpOnly')
  })

  it('builds clear cookies with Max-Age=0', () => {
    expect(buildSessionClearCookie()).toContain('Max-Age=0')
    expect(buildCsrfClearCookie()).toContain('Max-Age=0')
  })

  it('marks cookies Secure in production', () => {
    process.env.NODE_ENV = 'production'
    try {
      expect(buildSessionCookie('v')).toContain('Secure')
      expect(buildCsrfCookie('v')).toContain('Secure')
      expect(buildSessionClearCookie()).toContain('Secure')
      expect(buildCsrfClearCookie()).toContain('Secure')
    } finally {
      process.env.NODE_ENV = 'test'
    }
  })

  it('rejects sessions whose payload kind is missing or wrong', async () => {
    // Manually construct a JWT with the wrong kind to ensure verifySession catches it.
    const { SignJWT } = await import('jose')
    const secret = new TextEncoder().encode('test-secret-for-session-jwt')
    const badToken = await new SignJWT({
      memberId: 'm',
      accountId: 'a',
      walletAddress: '0x1',
      csrfHash: 'h',
      kind: 'agent',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('clawnews-web')
      .setAudience('clawnews-web-session')
      .setExpirationTime('1h')
      .sign(secret)

    await expect(verifySession(badToken)).resolves.toBeNull()
  })
})
