import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedResolveIdentity = vi.hoisted(() => vi.fn())
const mockedVerifySolanaTransaction = vi.hoisted(() => vi.fn())

const transactionMocks = vi.hoisted(() => ({
  purchaseIntent: {
    update: vi.fn(),
  },
  order: {
    create: vi.fn(),
  },
  entitlement: {
    create: vi.fn(),
  },
}))

const mockedPrisma = vi.hoisted(() => ({
  purchaseIntent: {
    findUnique: vi.fn(),
  },
  order: {
    findUnique: vi.fn(),
  },
  $transaction: vi.fn(),
}))

vi.mock('@web/lib/auth/identity', () => ({
  resolveIdentity: mockedResolveIdentity,
}))

vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

vi.mock('@web/lib/solana-verify', () => ({
  verifySolanaTransaction: mockedVerifySolanaTransaction,
}))

vi.mock('@web/lib/sui', () => ({
  suiClient: {
    getTransactionBlock: vi.fn(),
  },
}))

describe('POST /api/market/confirm-purchase', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

    mockedResolveIdentity.mockResolvedValue({
      accountId: 'account-1',
      memberId: 'buyer-1',
      kind: 'human',
    })

    mockedPrisma.purchaseIntent.findUnique.mockResolvedValue({
      id: 'intent-1',
      memberId: 'buyer-1',
      listingId: 'listing-1',
      walletBindingId: 'buyer-wallet',
      expectedPriceMist: 1_000_000_000n,
      expectedAmount: 2_500_000n,
      recipientAddress: 'seller-sol',
      recipientTokenAccount: 'seller-ata',
      chain: 'solana',
      currency: 'USDC',
      agentMemberId: null,
      status: 'pending',
      createdAt: new Date('2099-03-17T00:00:00.000Z'),
      expiresAt: new Date('2099-03-17T01:00:00.000Z'),
      listing: { bundleId: 'bundle-1' },
      walletBinding: { address: 'buyer-sol' },
    })

    mockedPrisma.order.findUnique.mockResolvedValue(null)
    transactionMocks.purchaseIntent.update.mockResolvedValue({})
    transactionMocks.order.create.mockResolvedValue({
      id: 'order-1',
      chain: 'solana',
      currency: 'USDC',
      priceMist: 1_000_000_000n,
      txDigest: 'sig-1',
    })
    transactionMocks.entitlement.create.mockResolvedValue({
      id: 'ent-1',
      bundleId: 'bundle-1',
    })
    mockedPrisma.$transaction.mockImplementation(async (callback: any) => callback(transactionMocks))
    mockedVerifySolanaTransaction.mockResolvedValue({
      ok: true,
      verification: {
        success: true,
        sender: 'buyer-sol',
        recipient: 'seller-ata',
        amount: 2_500_000n,
        mint: 'mint-usdc',
        timestampMs: new Date('2099-03-17T00:05:00.000Z').getTime(),
      },
    })
  })

  it('verifies Solana transactions and stores chain metadata on the order', async () => {
    const { POST } = await import('../../web/app/api/market/confirm-purchase/route.ts')
    const response = await POST(
      new Request('http://localhost/api/market/confirm-purchase', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          intentId: 'intent-1',
          txDigest: 'sig-1',
        }),
      }) as any,
    )

    expect(response.status).toBe(200)
    expect(mockedVerifySolanaTransaction).toHaveBeenCalledWith(
      'sig-1',
      'buyer-sol',
      'seller-ata',
      2_500_000n,
      'USDC',
    )
    expect(transactionMocks.order.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        listingId: 'listing-1',
        buyerId: 'buyer-1',
        walletBindingId: 'buyer-wallet',
        purchaseIntentId: 'intent-1',
        chain: 'solana',
        currency: 'USDC',
        priceMist: 1_000_000_000n,
        txDigest: 'sig-1',
      }),
    })
    await expect(response.json()).resolves.toEqual({
      order: {
        id: 'order-1',
        chain: 'solana',
        currency: 'USDC',
        priceMist: '1000000000',
        txDigest: 'sig-1',
      },
      entitlement: {
        id: 'ent-1',
        bundleId: 'bundle-1',
      },
    })
  })

  it('rejects Solana confirmations when the chain response does not include a timestamp', async () => {
    mockedVerifySolanaTransaction.mockResolvedValue({
      ok: true,
      verification: {
        success: true,
        sender: 'buyer-sol',
        recipient: 'seller-ata',
        amount: 2_500_000n,
        mint: 'mint-usdc',
        timestampMs: undefined,
      },
    })

    const { POST } = await import('../../web/app/api/market/confirm-purchase/route.ts')
    const response = await POST(
      new Request('http://localhost/api/market/confirm-purchase', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          intentId: 'intent-1',
          txDigest: 'sig-1',
        }),
      }) as any,
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Transaction missing timestamp',
    })
  })
})
