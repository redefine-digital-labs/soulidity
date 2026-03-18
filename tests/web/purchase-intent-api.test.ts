import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedResolveIdentity = vi.hoisted(() => vi.fn())
const mockedGetAssociatedTokenAddress = vi.hoisted(() => vi.fn())
const mockedUsdCentsToUsdcAtomicUnits = vi.hoisted(() => vi.fn())
const mockedUsdCentsToLamports = vi.hoisted(() => vi.fn())
const mockedGetUsdcMint = vi.hoisted(() => vi.fn())
const mockedGetAccountInfo = vi.hoisted(() => vi.fn())

const mockedPrisma = vi.hoisted(() => ({
  walletBinding: {
    findFirst: vi.fn(),
  },
  listing: {
    findFirst: vi.fn(),
  },
  entitlement: {
    findFirst: vi.fn(),
  },
  purchaseIntent: {
    create: vi.fn(),
  },
}))

vi.mock('@web/lib/auth/identity', () => ({
  resolveIdentity: mockedResolveIdentity,
}))

vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

vi.mock('@web/lib/solana', () => ({
  getUsdcMint: mockedGetUsdcMint,
  solanaConnection: {
    getAccountInfo: mockedGetAccountInfo,
  },
  usdCentsToLamports: mockedUsdCentsToLamports,
  usdCentsToUsdcAtomicUnits: mockedUsdCentsToUsdcAtomicUnits,
}))

vi.mock('@web/lib/solana-spl', () => ({
  getAssociatedTokenAddress: mockedGetAssociatedTokenAddress,
}))

describe('POST /api/market/purchase-intent', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

    mockedResolveIdentity.mockResolvedValue({
      accountId: 'account-1',
      memberId: 'buyer-1',
      kind: 'human',
    })

    mockedPrisma.walletBinding.findFirst
      .mockResolvedValueOnce({ id: 'buyer-wallet', address: 'So11111111111111111111111111111111111111112' })
      .mockResolvedValueOnce({ id: 'seller-wallet', address: '11111111111111111111111111111111' })

    mockedPrisma.listing.findFirst.mockResolvedValue({
      id: 'listing-1',
      bundleId: 'bundle-1',
      priceMist: 1_000_000_000n,
      priceUsdCents: 250,
      bundle: {
        sellerId: 'seller-1',
      },
    })

    mockedPrisma.entitlement.findFirst.mockResolvedValue(null)
    mockedGetUsdcMint.mockReturnValue({
      toBase58: () => 'mint-usdc',
    })
    mockedGetAssociatedTokenAddress.mockResolvedValue({
      toBase58: () => 'seller-ata',
    })
    mockedGetAccountInfo.mockResolvedValue({ owner: 'token-program' })
    mockedUsdCentsToUsdcAtomicUnits.mockReturnValue(2_500_000n)
    mockedUsdCentsToLamports.mockReturnValue(20_000_000n)
  })

  it('creates a Solana USDC purchase intent using the seller ATA', async () => {
    mockedPrisma.purchaseIntent.create.mockResolvedValue({
      id: 'intent-1',
      nonce: 'nonce-1',
      chain: 'solana',
      currency: 'USDC',
      expectedAmount: 2_500_000n,
      recipientAddress: '11111111111111111111111111111111',
      recipientTokenAccount: 'seller-ata',
      expiresAt: new Date('2026-03-17T01:15:00.000Z'),
    })

    const { POST } = await import('../../web/app/api/market/purchase-intent/route.ts')
    const response = await POST(
      new Request('http://localhost/api/market/purchase-intent', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          listingId: 'listing-1',
          chain: 'solana',
          currency: 'USDC',
        }),
      }) as any,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      intentId: 'intent-1',
      nonce: 'nonce-1',
      chain: 'solana',
      currency: 'USDC',
      amount: '2500000',
      recipientAddress: '11111111111111111111111111111111',
      recipientTokenAccount: 'seller-ata',
      mint: 'mint-usdc',
      expiresAt: '2026-03-17T01:15:00.000Z',
    })

    expect(mockedPrisma.purchaseIntent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        listingId: 'listing-1',
        memberId: 'buyer-1',
        walletBindingId: 'buyer-wallet',
        chain: 'solana',
        currency: 'USDC',
        expectedAmount: 2_500_000n,
        recipientAddress: '11111111111111111111111111111111',
        recipientTokenAccount: 'seller-ata',
      }),
    })
  })

  it('creates a Solana SOL purchase intent using a lamports quote', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          solana: { usd: 125 },
        }),
      }),
    )

    mockedPrisma.purchaseIntent.create.mockResolvedValue({
      id: 'intent-2',
      nonce: 'nonce-2',
      chain: 'solana',
      currency: 'SOL',
      expectedAmount: 20_000_000n,
      recipientAddress: '11111111111111111111111111111111',
      recipientTokenAccount: null,
      expiresAt: new Date('2026-03-17T01:15:00.000Z'),
    })

    const { POST } = await import('../../web/app/api/market/purchase-intent/route.ts')
    const response = await POST(
      new Request('http://localhost/api/market/purchase-intent', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          listingId: 'listing-1',
          chain: 'solana',
          currency: 'SOL',
        }),
      }) as any,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      intentId: 'intent-2',
      nonce: 'nonce-2',
      chain: 'solana',
      currency: 'SOL',
      amount: '20000000',
      recipientAddress: '11111111111111111111111111111111',
      recipientTokenAccount: null,
      expiresAt: '2026-03-17T01:15:00.000Z',
    })

    expect(mockedUsdCentsToLamports).toHaveBeenCalledWith(250, 125)

    vi.unstubAllGlobals()
  })

  it('rejects USDC purchase intents when the seller ATA does not exist on-chain', async () => {
    mockedGetAccountInfo.mockResolvedValue(null)

    const { POST } = await import('../../web/app/api/market/purchase-intent/route.ts')
    const response = await POST(
      new Request('http://localhost/api/market/purchase-intent', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          listingId: 'listing-1',
          chain: 'solana',
          currency: 'USDC',
        }),
      }) as any,
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Seller USDC token account not found',
    })
    expect(mockedPrisma.purchaseIntent.create).not.toHaveBeenCalled()
  })
})
