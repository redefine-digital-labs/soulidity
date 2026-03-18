import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockedResolveIdentity = vi.hoisted(() => vi.fn())

const transactionMocks = vi.hoisted(() => ({
  agentBundle: {
    create: vi.fn(),
  },
  listing: {
    create: vi.fn(),
  },
}))

const mockedPrisma = vi.hoisted(() => ({
  walletBinding: {
    findFirst: vi.fn(),
  },
  $transaction: vi.fn(),
}))

vi.mock('@web/lib/auth/identity', () => ({
  resolveIdentity: mockedResolveIdentity,
}))

vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

describe('POST /api/market/publish', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

    mockedResolveIdentity.mockResolvedValue({
      accountId: 'account-1',
      memberId: 'seller-1',
      kind: 'human',
    })

    mockedPrisma.walletBinding.findFirst.mockResolvedValue({
      id: 'wallet-1',
      address: '0xseller',
    })

    transactionMocks.agentBundle.create.mockResolvedValue({
      id: 'bundle-1',
      sellerId: 'seller-1',
      name: 'Research Agent',
    })
    transactionMocks.listing.create.mockResolvedValue({
      id: 'listing-1',
      bundleId: 'bundle-1',
      sellerWalletAddress: '0xseller',
      priceMist: 1_000_000_000n,
      priceUsdCents: 75,
      status: 'active',
    })
    mockedPrisma.$transaction.mockImplementation(async (callback: any) => callback(transactionMocks))

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          sui: { usd: 0.75 },
        }),
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('persists a stable USD price when creating a listing', async () => {
    const { POST } = await import('../../web/app/api/market/publish/route.ts')
    const response = await POST(
      new Request('http://localhost/api/market/publish', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Research Agent',
          description: 'Summarizes markets',
          category: 'Analysis',
          tags: ['research'],
          storagePath: 'seller-1/research-agent.zip',
          contentHash: 'hash-1',
          previewImages: [],
          readme: null,
          priceMist: '1000000000',
        }),
      }) as any,
    )

    expect(response.status).toBe(201)
    expect(transactionMocks.listing.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        bundleId: 'bundle-1',
        sellerWalletAddress: '0xseller',
        priceMist: 1_000_000_000n,
        priceUsdCents: 75,
        status: 'active',
      }),
    })
  })
})
