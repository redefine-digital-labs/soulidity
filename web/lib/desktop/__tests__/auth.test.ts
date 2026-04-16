import { describe, expect, it, vi, beforeEach } from 'vitest'

import { generateDesktopAccessToken, verifyDesktopAccessToken } from '../auth'

const DESKTOP_TOKEN_PREFIX = 'dtk_'

// ── Mock prisma ────────────────────────────────────────────
const mockFindUnique = vi.fn()

vi.mock('@web/lib/prisma', () => ({
  prisma: {
    desktopProfile: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
    },
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
})

// ── generateDesktopAccessToken ────────────────────────────
describe('generateDesktopAccessToken', () => {
  it('returns a token with the dtk_ prefix', () => {
    const { token } = generateDesktopAccessToken()
    expect(token.startsWith(DESKTOP_TOKEN_PREFIX)).toBe(true)
  })

  it('returns a 68-character token (dtk_ + 64 hex chars)', () => {
    const { token } = generateDesktopAccessToken()
    expect(token).toHaveLength(4 + 64)
  })

  it('returns a hash that is a 64-character hex SHA-256 digest', () => {
    const { hash } = generateDesktopAccessToken()
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('produces a hash that matches the token content', () => {
    const { token, hash } = generateDesktopAccessToken()

    // Verify by generating the expected hash manually
    const { createHash } = require('node:crypto')
    const expectedHash = createHash('sha256').update(token).digest('hex')
    expect(hash).toBe(expectedHash)
  })

  it('generates unique tokens on each call', () => {
    const a = generateDesktopAccessToken()
    const b = generateDesktopAccessToken()
    expect(a.token).not.toBe(b.token)
    expect(a.hash).not.toBe(b.hash)
  })
})

// ── verifyDesktopAccessToken ──────────────────────────────
describe('verifyDesktopAccessToken', () => {
  it('returns null for a token without the dtk_ prefix', async () => {
    const result = await verifyDesktopAccessToken('invalid_token')
    expect(result).toBeNull()
    expect(mockFindUnique).not.toHaveBeenCalled()
  })

  it('returns null for an empty dtk_ token', async () => {
    const result = await verifyDesktopAccessToken('dtk_')
    expect(result).toBeNull()
  })

  it('returns null when no matching profile is found', async () => {
    mockFindUnique.mockResolvedValue(null)

    const { token } = generateDesktopAccessToken()
    const result = await verifyDesktopAccessToken(token)

    expect(result).toBeNull()
    expect(mockFindUnique).toHaveBeenCalledTimes(1)
  })

  it('returns accountId when the token hash matches an indexed profile column', async () => {
    const { token, hash } = generateDesktopAccessToken()

    mockFindUnique.mockResolvedValue({
      accountId: 'account-123',
      desktopAccessTokenHash: hash,
      desktopAccessTokenIssuedAt: new Date('2026-04-12T10:00:00Z'),
    })

    const result = await verifyDesktopAccessToken(token)

    expect(result).toEqual({ accountId: 'account-123' })
  })

  it('returns null when the stored hash does not match the token', async () => {
    const { token } = generateDesktopAccessToken()

    mockFindUnique.mockResolvedValue({
      accountId: 'account-123',
      desktopAccessTokenHash: 'wrong_hash_value',
      desktopAccessTokenIssuedAt: new Date('2026-04-12T10:00:00Z'),
    })

    const result = await verifyDesktopAccessToken(token)
    expect(result).toBeNull()
  })

  it('returns null when the indexed token is expired', async () => {
    vi.useFakeTimers()
    const now = new Date('2026-07-15T10:00:00Z')
    vi.setSystemTime(now)

    const { token, hash } = generateDesktopAccessToken()

    mockFindUnique.mockResolvedValue({
      accountId: 'account-123',
      desktopAccessTokenHash: hash,
      desktopAccessTokenIssuedAt: new Date('2026-04-12T10:00:00Z'),
    })

    const result = await verifyDesktopAccessToken(token)
    expect(result).toBeNull()

    vi.useRealTimers()
  })
})

// ── Token rotation ────────────────────────────────────────
describe('token rotation', () => {
  it('new token generates a different hash than the old one', () => {
    const old = generateDesktopAccessToken()
    const fresh = generateDesktopAccessToken()

    expect(old.hash).not.toBe(fresh.hash)
  })

  it('old token fails verification after hash is replaced in the store', async () => {
    const old = generateDesktopAccessToken()
    const fresh = generateDesktopAccessToken()

    // Store now has the fresh hash
    mockFindUnique.mockResolvedValue({
      accountId: 'account-123',
      desktopAccessTokenHash: fresh.hash,
      desktopAccessTokenIssuedAt: new Date('2026-04-12T10:00:00Z'),
    })

    // Old token should fail
    const result = await verifyDesktopAccessToken(old.token)
    expect(result).toBeNull()
  })

  it('new token succeeds verification after hash is replaced in the store', async () => {
    const fresh = generateDesktopAccessToken()

    mockFindUnique.mockResolvedValue({
      accountId: 'account-123',
      desktopAccessTokenHash: fresh.hash,
      desktopAccessTokenIssuedAt: new Date('2026-04-12T10:00:00Z'),
    })

    const result = await verifyDesktopAccessToken(fresh.token)
    expect(result).toEqual({ accountId: 'account-123' })
  })
})
