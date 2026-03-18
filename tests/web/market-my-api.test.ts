import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedResolveIdentity = vi.hoisted(() => vi.fn())

const mockedPrisma = vi.hoisted(() => ({
  entitlement: {
    findMany: vi.fn(),
  },
}))

vi.mock('@web/lib/auth/identity', () => ({
  resolveIdentity: mockedResolveIdentity,
}))

vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

describe('GET /api/market/my', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

    mockedResolveIdentity.mockResolvedValue({
      accountId: 'account-1',
      memberId: 'owner-1',
      kind: 'human',
    })
  })

  it('returns the actual paid amount and currency for Solana purchases', async () => {
    mockedPrisma.entitlement.findMany.mockResolvedValue([
      {
        id: 'entitlement-1',
        status: 'active',
        grantedAt: new Date('2026-03-17T01:15:00.000Z'),
        bundle: {
          id: 'bundle-1',
          name: 'Research Agent',
          category: 'research',
          version: '1.0.0',
        },
        order: {
          priceMist: 1_000_000_000n,
          currency: 'USDC',
          txDigest: 'sig-1',
          createdAt: new Date('2026-03-17T01:15:00.000Z'),
          purchaseIntent: {
            expectedAmount: 2_500_000n,
          },
        },
      },
    ])

    const { GET } = await import('../../web/app/api/market/my/route.ts')
    const response = await GET()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      entitlements: [
        {
          id: 'entitlement-1',
          status: 'active',
          grantedAt: '2026-03-17T01:15:00.000Z',
          bundle: {
            id: 'bundle-1',
            name: 'Research Agent',
            category: 'research',
            version: '1.0.0',
          },
          order: {
            priceMist: '1000000000',
            paidAmount: '2500000',
            currency: 'USDC',
            txDigest: 'sig-1',
            createdAt: '2026-03-17T01:15:00.000Z',
          },
        },
      ],
    })
  })
})
