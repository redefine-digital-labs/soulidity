import { describe, expect, it, vi, beforeEach } from 'vitest'

import {
  __resetDesktopLastSeenThrottleForTests,
  generateDesktopAccessToken,
  verifyDesktopAccessToken,
} from '../auth'

const DESKTOP_TOKEN_PREFIX = 'dtk_'
const recentlyIssuedAt = () => new Date(Date.now() - 24 * 60 * 60 * 1000)

// ── Mock prisma ────────────────────────────────────────────
const mockPetFindUnique = vi.fn()
const mockPetUpdate = vi.fn()
const mockProfileFindUnique = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    desktopPet: {
      findUnique: (...args: unknown[]) => mockPetFindUnique(...args),
      update: (...args: unknown[]) => mockPetUpdate(...args),
    },
    desktopProfile: {
      findUnique: (...args: unknown[]) => mockProfileFindUnique(...args),
    },
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  __resetDesktopLastSeenThrottleForTests()
  mockPetUpdate.mockResolvedValue({})
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
    expect(mockPetFindUnique).not.toHaveBeenCalled()
  })

  it('returns null for an empty dtk_ token', async () => {
    const result = await verifyDesktopAccessToken('dtk_')
    expect(result).toBeNull()
  })

  it('returns null when no matching pet is found', async () => {
    mockPetFindUnique.mockResolvedValue(null)

    const { token } = generateDesktopAccessToken()
    const result = await verifyDesktopAccessToken(token)

    expect(result).toBeNull()
    expect(mockPetFindUnique).toHaveBeenCalledTimes(1)
  })

  it('returns accountId + desktopPet when the token hash matches a pet row', async () => {
    const { token, hash } = generateDesktopAccessToken()

    mockPetFindUnique.mockResolvedValue({
      id: 'pet-1',
      accountId: 'account-123',
      agentAddress: '0xagent',
      agentMemberId: 'member-9',
      desktopAccessTokenHash: hash,
      desktopAccessTokenIssuedAt: recentlyIssuedAt(),
    })

    const result = await verifyDesktopAccessToken(token)

    expect(result).toEqual({
      accountId: 'account-123',
      desktopPet: {
        id: 'pet-1',
        accountId: 'account-123',
        agentAddress: '0xagent',
        agentMemberId: 'member-9',
      },
    })
  })

  it('does not query desktop_profiles on the verify path (regression)', async () => {
    const { token, hash } = generateDesktopAccessToken()

    mockPetFindUnique.mockResolvedValue({
      id: 'pet-1',
      accountId: 'account-123',
      agentAddress: '0xagent',
      agentMemberId: 'member-9',
      desktopAccessTokenHash: hash,
      desktopAccessTokenIssuedAt: recentlyIssuedAt(),
    })

    await verifyDesktopAccessToken(token)
    expect(mockProfileFindUnique).not.toHaveBeenCalled()
  })

  it('returns null when the stored hash does not match the token', async () => {
    const { token } = generateDesktopAccessToken()

    mockPetFindUnique.mockResolvedValue({
      id: 'pet-1',
      accountId: 'account-123',
      agentAddress: '0xagent',
      agentMemberId: 'member-9',
      desktopAccessTokenHash: 'wrong_hash_value',
      desktopAccessTokenIssuedAt: recentlyIssuedAt(),
    })

    const result = await verifyDesktopAccessToken(token)
    expect(result).toBeNull()
  })

  it('returns null when the indexed token is expired', async () => {
    vi.useFakeTimers()
    const now = new Date('2026-07-15T10:00:00Z')
    vi.setSystemTime(now)

    const { token, hash } = generateDesktopAccessToken()

    mockPetFindUnique.mockResolvedValue({
      id: 'pet-1',
      accountId: 'account-123',
      agentAddress: '0xagent',
      agentMemberId: 'member-9',
      desktopAccessTokenHash: hash,
      desktopAccessTokenIssuedAt: new Date('2026-04-12T10:00:00Z'),
    })

    const result = await verifyDesktopAccessToken(token)
    expect(result).toBeNull()

    vi.useRealTimers()
  })

  it('returns the pet for an expired token when allowExpired is set (revoke path)', async () => {
    // Regression: revoke must succeed even past the 90-day rotation window
    // so that 401 from /api/desktop/me/revoke uniquely means "pet row
    // gone", not "token stale but pet still active". Without this branch
    // the desktop reset helper would conflate the two and silently leave
    // server-side pet/member/api-key state behind.
    vi.useFakeTimers()
    const now = new Date('2026-07-15T10:00:00Z')
    vi.setSystemTime(now)

    const { token, hash } = generateDesktopAccessToken()

    mockPetFindUnique.mockResolvedValue({
      id: 'pet-1',
      accountId: 'account-123',
      agentAddress: '0xagent',
      agentMemberId: 'member-9',
      desktopAccessTokenHash: hash,
      desktopAccessTokenIssuedAt: new Date('2026-04-12T10:00:00Z'),
    })

    const result = await verifyDesktopAccessToken(token, { allowExpired: true })
    expect(result).toEqual({
      accountId: 'account-123',
      desktopPet: {
        id: 'pet-1',
        accountId: 'account-123',
        agentAddress: '0xagent',
        agentMemberId: 'member-9',
      },
    })

    vi.useRealTimers()
  })

  it('still returns null for a non-matching hash even with allowExpired', async () => {
    // allowExpired only relaxes the age check — it does NOT relax the
    // hash-match check. A token whose hash does not match any row must
    // still fail (so 401 from the revoke route still uniquely means
    // "no pet matches this token", which is what the desktop relies on).
    const { token } = generateDesktopAccessToken()

    mockPetFindUnique.mockResolvedValue(null)

    const result = await verifyDesktopAccessToken(token, { allowExpired: true })
    expect(result).toBeNull()
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
    mockPetFindUnique.mockResolvedValue({
      id: 'pet-1',
      accountId: 'account-123',
      agentAddress: '0xagent',
      agentMemberId: 'member-9',
      desktopAccessTokenHash: fresh.hash,
      desktopAccessTokenIssuedAt: recentlyIssuedAt(),
    })

    // Old token should fail
    const result = await verifyDesktopAccessToken(old.token)
    expect(result).toBeNull()
  })

  it('new token succeeds verification after hash is replaced in the store', async () => {
    const fresh = generateDesktopAccessToken()

    mockPetFindUnique.mockResolvedValue({
      id: 'pet-1',
      accountId: 'account-123',
      agentAddress: '0xagent',
      agentMemberId: 'member-9',
      desktopAccessTokenHash: fresh.hash,
      desktopAccessTokenIssuedAt: recentlyIssuedAt(),
    })

    const result = await verifyDesktopAccessToken(fresh.token)
    expect(result).toMatchObject({ accountId: 'account-123' })
  })
})
