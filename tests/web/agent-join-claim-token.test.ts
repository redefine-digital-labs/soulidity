import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createClaimToken, isValidClaimToken } from '../../web/lib/auth/agent-claim-token.ts'

describe('agent claim token', () => {
  const originalAuthSecret = process.env.AUTH_SECRET

  beforeEach(() => {
    process.env.AUTH_SECRET = 'test-secret'
  })

  afterEach(() => {
    if (originalAuthSecret === undefined) {
      delete process.env.AUTH_SECRET
    } else {
      process.env.AUTH_SECRET = originalAuthSecret
    }
  })

  it('creates tokens that validate for the matching member', () => {
    const token = createClaimToken('member-1', 1_700_000_000_000)

    expect(isValidClaimToken('member-1', token, 1_700_000_000_000)).toBe(true)
  })

  it('rejects expired claim tokens', () => {
    const issuedAt = 1_700_000_000_000
    const token = createClaimToken('member-1', issuedAt)

    expect(isValidClaimToken('member-1', token, issuedAt + 25 * 60 * 60 * 1000)).toBe(false)
  })

  it('rejects claim tokens issued in the future', () => {
    const issuedAt = 1_700_000_000_000
    const token = createClaimToken('member-1', issuedAt)

    expect(isValidClaimToken('member-1', token, issuedAt - 1)).toBe(false)
  })

  it('rejects malformed legacy tokens without a timestamp segment', () => {
    expect(isValidClaimToken('member-1', 'legacy-token')).toBe(false)
  })

  it('rejects truncated legacy signatures even when the HMAC prefix matches', () => {
    const fullToken = createClaimToken('member-1', 1_700_000_000_000)
    const [issuedAt, signature] = fullToken.split('.')
    const legacyToken = `${issuedAt}.${signature.slice(0, 32)}`

    expect(isValidClaimToken('member-1', legacyToken, 1_700_000_000_000)).toBe(false)
  })
})
