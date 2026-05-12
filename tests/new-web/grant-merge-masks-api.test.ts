import { beforeEach, describe, expect, it, vi } from 'vitest'

const SOUL_ID_A = `0x${'a'.repeat(64)}`
const SOUL_ID_B = `0x${'b'.repeat(64)}`
const AGENT_X = `0x${'1'.repeat(64)}`
const HUMAN_MEMBER_ID = '33333333-3333-4333-8333-333333333333'

const mockedPrisma = vi.hoisted(() => ({
  soulAsset: {
    findMany: vi.fn(),
  },
  soulGrantRecord: {
    findMany: vi.fn(),
  },
}))

const mockedRequireHumanWalletIdentity = vi.hoisted(() => vi.fn())
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({ prisma: mockedPrisma }))
vi.mock('@/lib/soulidity/server', () => ({
  requireHumanWalletIdentity: mockedRequireHumanWalletIdentity,
}))
vi.mock('@/lib/rate-limit', () => ({
  takeRateLimitToken: mockedTakeRateLimitToken,
}))

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/api/souls/grant-merge-masks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const SCOPE_SEAL = 1
const SCOPE_MEMORY = 2
const SCOPE_SKILLS = 4
const SCOPE_ASSETS = 8

describe('POST /api/souls/grant-merge-masks', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockedTakeRateLimitToken.mockResolvedValue({ limited: false })
  })

  it('returns 401 when no human wallet identity', async () => {
    mockedRequireHumanWalletIdentity.mockResolvedValue({
      error: Response.json({ error: 'Sign in' }, { status: 401 }),
    })
    const { POST } = await import('../../web/app/api/souls/grant-merge-masks/route')
    const response = await POST(jsonRequest({ items: [] }))
    expect(response.status).toBe(401)
    expect(mockedPrisma.soulAsset.findMany).not.toHaveBeenCalled()
  })

  it('returns 429 when rate limited', async () => {
    mockedRequireHumanWalletIdentity.mockResolvedValue({
      identity: { accountId: 'a', memberId: HUMAN_MEMBER_ID, kind: 'human' },
      walletAddresses: ['0xowner'],
    })
    mockedTakeRateLimitToken.mockResolvedValue({ limited: true, retryAfterSeconds: 60 })
    const { POST } = await import('../../web/app/api/souls/grant-merge-masks/route')
    const response = await POST(jsonRequest({
      items: [{ soulOnChainId: SOUL_ID_A, granteeAddress: AGENT_X, addedScopeMask: SCOPE_ASSETS }],
    }))
    expect(response.status).toBe(429)
  })

  it('400 when items is empty or oversized', async () => {
    mockedRequireHumanWalletIdentity.mockResolvedValue({
      identity: { accountId: 'a', memberId: HUMAN_MEMBER_ID, kind: 'human' },
      walletAddresses: ['0xowner'],
    })
    const { POST } = await import('../../web/app/api/souls/grant-merge-masks/route')
    expect((await POST(jsonRequest({ items: [] }))).status).toBe(400)
    expect((await POST(jsonRequest({}))).status).toBe(400)
    const big = Array.from({ length: 101 }, () => ({
      soulOnChainId: SOUL_ID_A,
      granteeAddress: AGENT_X,
      addedScopeMask: SCOPE_ASSETS,
    }))
    expect((await POST(jsonRequest({ items: big }))).status).toBe(400)
  })

  it('400 when addedScopeMask is invalid (zero, negative, > 15, non-int)', async () => {
    mockedRequireHumanWalletIdentity.mockResolvedValue({
      identity: { accountId: 'a', memberId: HUMAN_MEMBER_ID, kind: 'human' },
      walletAddresses: ['0xowner'],
    })
    const { POST } = await import('../../web/app/api/souls/grant-merge-masks/route')
    for (const badMask of [0, -1, 16, 32, 1.5, 'eight']) {
      const res = await POST(jsonRequest({
        items: [{ soulOnChainId: SOUL_ID_A, granteeAddress: AGENT_X, addedScopeMask: badMask }],
      }))
      expect(res.status).toBe(400)
    }
  })

  it('404 when any soul is missing', async () => {
    mockedRequireHumanWalletIdentity.mockResolvedValue({
      identity: { accountId: 'a', memberId: HUMAN_MEMBER_ID, kind: 'human' },
      walletAddresses: ['0xowner'],
    })
    mockedPrisma.soulAsset.findMany.mockResolvedValue([])
    const { POST } = await import('../../web/app/api/souls/grant-merge-masks/route')
    const response = await POST(jsonRequest({
      items: [{ soulOnChainId: SOUL_ID_A, granteeAddress: AGENT_X, addedScopeMask: SCOPE_ASSETS }],
    }))
    expect(response.status).toBe(404)
  })

  it('403 when caller is not the owner of every targeted soul', async () => {
    mockedRequireHumanWalletIdentity.mockResolvedValue({
      identity: { accountId: 'a', memberId: HUMAN_MEMBER_ID, kind: 'human' },
      walletAddresses: ['0xowner'],
    })
    mockedPrisma.soulAsset.findMany.mockResolvedValue([
      { onChainId: SOUL_ID_A, currentOwnerMemberId: HUMAN_MEMBER_ID, grantCapacity: 1, activeGrantCount: 0 },
      { onChainId: SOUL_ID_B, currentOwnerMemberId: 'someone-else', grantCapacity: 1, activeGrantCount: 0 },
    ])
    const { POST } = await import('../../web/app/api/souls/grant-merge-masks/route')
    const response = await POST(jsonRequest({
      items: [
        { soulOnChainId: SOUL_ID_A, granteeAddress: AGENT_X, addedScopeMask: SCOPE_ASSETS },
        { soulOnChainId: SOUL_ID_B, granteeAddress: AGENT_X, addedScopeMask: SCOPE_ASSETS },
      ],
    }))
    expect(response.status).toBe(403)
  })

  it('returns mergedScopeMask = existing | added for an existing grantee', async () => {
    mockedRequireHumanWalletIdentity.mockResolvedValue({
      identity: { accountId: 'a', memberId: HUMAN_MEMBER_ID, kind: 'human' },
      walletAddresses: ['0xowner'],
    })
    mockedPrisma.soulAsset.findMany.mockResolvedValue([
      { onChainId: SOUL_ID_A, currentOwnerMemberId: HUMAN_MEMBER_ID, grantCapacity: 2, activeGrantCount: 1 },
    ])
    // Existing grant: agent has [seal, skills] on this Soul (mask 5).
    mockedPrisma.soulGrantRecord.findMany.mockResolvedValue([
      { granteeAddress: AGENT_X, scopes: ['seal', 'skills'] },
    ])
    const { POST } = await import('../../web/app/api/souls/grant-merge-masks/route')
    const response = await POST(jsonRequest({
      items: [{ soulOnChainId: SOUL_ID_A, granteeAddress: AGENT_X, addedScopeMask: SCOPE_ASSETS }],
    }))
    expect(response.status).toBe(200)
    const body = await response.json() as {
      items: Array<{
        soulOnChainId: string
        granteeAddress: string
        existingScopeMask: number
        mergedScopeMask: number
        isNewGrantee: boolean
        requiredCapacity: number
      }>
    }
    expect(body.items).toHaveLength(1)
    expect(body.items[0]?.existingScopeMask).toBe(SCOPE_SEAL | SCOPE_SKILLS)
    expect(body.items[0]?.mergedScopeMask).toBe(SCOPE_SEAL | SCOPE_SKILLS | SCOPE_ASSETS)
    expect(body.items[0]?.isNewGrantee).toBe(false)
    // Existing grantee — supersede reuses slot, no capacity bump needed.
    expect(body.items[0]?.requiredCapacity).toBe(2)
  })

  it('marks isNewGrantee=true and bumps required capacity for a brand-new grantee', async () => {
    mockedRequireHumanWalletIdentity.mockResolvedValue({
      identity: { accountId: 'a', memberId: HUMAN_MEMBER_ID, kind: 'human' },
      walletAddresses: ['0xowner'],
    })
    mockedPrisma.soulAsset.findMany.mockResolvedValue([
      { onChainId: SOUL_ID_A, currentOwnerMemberId: HUMAN_MEMBER_ID, grantCapacity: 1, activeGrantCount: 1 },
    ])
    // No existing grant for this grantee.
    mockedPrisma.soulGrantRecord.findMany.mockResolvedValue([])
    const { POST } = await import('../../web/app/api/souls/grant-merge-masks/route')
    const response = await POST(jsonRequest({
      items: [{ soulOnChainId: SOUL_ID_A, granteeAddress: AGENT_X, addedScopeMask: SCOPE_MEMORY }],
    }))
    expect(response.status).toBe(200)
    const body = await response.json() as {
      items: Array<{
        existingScopeMask: number
        mergedScopeMask: number
        isNewGrantee: boolean
        requiredCapacity: number
        currentCapacity: number
        activeGrantCount: number
      }>
    }
    expect(body.items[0]?.existingScopeMask).toBe(0)
    expect(body.items[0]?.mergedScopeMask).toBe(SCOPE_MEMORY)
    expect(body.items[0]?.isNewGrantee).toBe(true)
    // 1 (active) + 1 (new grantee) = 2 > 1 (current capacity) → bumped to 2.
    expect(body.items[0]?.requiredCapacity).toBe(2)
  })

  it('handles batched items across multiple souls in a single response', async () => {
    mockedRequireHumanWalletIdentity.mockResolvedValue({
      identity: { accountId: 'a', memberId: HUMAN_MEMBER_ID, kind: 'human' },
      walletAddresses: ['0xowner'],
    })
    mockedPrisma.soulAsset.findMany.mockResolvedValue([
      { onChainId: SOUL_ID_A, currentOwnerMemberId: HUMAN_MEMBER_ID, grantCapacity: 1, activeGrantCount: 0 },
      { onChainId: SOUL_ID_B, currentOwnerMemberId: HUMAN_MEMBER_ID, grantCapacity: 1, activeGrantCount: 1 },
    ])
    // Different existing scope per soul.
    mockedPrisma.soulGrantRecord.findMany.mockImplementation(async (args: { where: { soulOnChainId: string } }) => {
      if (args.where.soulOnChainId === SOUL_ID_B) {
        return [{ granteeAddress: AGENT_X, scopes: ['seal'] }]
      }
      return []
    })
    const { POST } = await import('../../web/app/api/souls/grant-merge-masks/route')
    const response = await POST(jsonRequest({
      items: [
        { soulOnChainId: SOUL_ID_A, granteeAddress: AGENT_X, addedScopeMask: SCOPE_ASSETS },
        { soulOnChainId: SOUL_ID_B, granteeAddress: AGENT_X, addedScopeMask: SCOPE_ASSETS },
      ],
    }))
    expect(response.status).toBe(200)
    const body = await response.json() as { items: Array<{ soulOnChainId: string; mergedScopeMask: number; isNewGrantee: boolean }> }
    expect(body.items).toHaveLength(2)
    const a = body.items.find((i) => i.soulOnChainId === SOUL_ID_A)
    const b = body.items.find((i) => i.soulOnChainId === SOUL_ID_B)
    expect(a?.mergedScopeMask).toBe(SCOPE_ASSETS)
    expect(a?.isNewGrantee).toBe(true)
    expect(b?.mergedScopeMask).toBe(SCOPE_SEAL | SCOPE_ASSETS)
    expect(b?.isNewGrantee).toBe(false)
  })
})
