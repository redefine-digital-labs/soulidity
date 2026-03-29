import { beforeEach, describe, expect, it, vi } from 'vitest'

const SOUL_OBJECT_ID = `0x${'a'.repeat(64)}`
const LISTING_OBJECT_ID = `0x${'b'.repeat(64)}`
const SELLER_KIOSK_ID = `0x${'2'.repeat(64)}`
const AGENT_ADDRESS = `0x${'4'.repeat(64)}`

const mockedPrisma = vi.hoisted(() => ({
  soulPreparedPurchase: {
    create: vi.fn(),
    deleteMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
  },
  $transaction: vi.fn(),
}))

vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

describe('prepared purchase helpers', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

    mockedPrisma.soulPreparedPurchase.create.mockResolvedValue({
      id: 'prepared-1',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    })
    mockedPrisma.soulPreparedPurchase.deleteMany.mockResolvedValue({ count: 0 })
    mockedPrisma.soulPreparedPurchase.findUnique.mockResolvedValue({
      id: 'prepared-1',
      agentMemberId: 'agent-1',
      soulOnChainId: SOUL_OBJECT_ID,
      listingObjectId: LISTING_OBJECT_ID,
      sellerKioskId: SELLER_KIOSK_ID,
      agentAddress: AGENT_ADDRESS,
      priceAtomic: 1_000_000n,
      platformFeeAtomic: 50_000n,
      creatorRoyaltyAtomic: 25_000n,
      totalAtomic: 1_075_000n,
      txBytesBase64: 'c2VydmVyLXR4',
      txBytesHash: 'deadbeef',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      executedAt: null,
      executionTxDigest: null,
      resultStatusCode: null,
      resultBody: null,
    })
    mockedPrisma.soulPreparedPurchase.updateMany.mockResolvedValue({ count: 1 })
    mockedPrisma.soulPreparedPurchase.update.mockResolvedValue({})
    mockedPrisma.$transaction.mockImplementation(async (callback: (tx: typeof mockedPrisma) => Promise<unknown>) => callback(mockedPrisma))
  })

  it('stores a hash alongside prepared tx bytes for integrity checks', async () => {
    const { createPreparedSoulPurchase } = await import('../../web/lib/souls/prepared-purchase.ts')

    await createPreparedSoulPurchase({
      agentMemberId: 'agent-1',
      soulOnChainId: SOUL_OBJECT_ID,
      listingObjectId: LISTING_OBJECT_ID,
      sellerKioskId: SELLER_KIOSK_ID,
      agentAddress: AGENT_ADDRESS,
      priceAtomic: 1_000_000n,
      platformFeeAtomic: 50_000n,
      creatorRoyaltyAtomic: 25_000n,
      totalAtomic: 1_075_000n,
      txBytesBase64: 'c2VydmVyLXR4',
    })

    expect(mockedPrisma.soulPreparedPurchase.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        soulOnChainId: SOUL_OBJECT_ID,
        listingObjectId: LISTING_OBJECT_ID,
        sellerKioskId: SELLER_KIOSK_ID,
        priceAtomic: '1000000',
        platformFeeAtomic: '50000',
        creatorRoyaltyAtomic: '25000',
        totalAtomic: '1075000',
        txBytesBase64: 'c2VydmVyLXR4',
        txBytesHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
      select: {
        id: true,
        expiresAt: true,
      },
    })
  })

  it('derives a stable transaction digest from prepared tx bytes', async () => {
    const { getPreparedSoulPurchaseTxDigest } = await import('../../web/lib/souls/prepared-purchase.ts')

    expect(getPreparedSoulPurchaseTxDigest('c2VydmVyLXR4')).toBe('5LwM4Dkngd9ASa84nvdjbh8np9KExpc8SdJsPbQX1APb')
  })

  it('returns null when an execution lookup is for a different soul object id', async () => {
    const { getPreparedSoulPurchaseForExecution } = await import('../../web/lib/souls/prepared-purchase.ts')

    await expect(getPreparedSoulPurchaseForExecution({
      preparedPurchaseId: 'prepared-1',
      agentMemberId: 'agent-1',
      soulOnChainId: `0x${'b'.repeat(64)}`,
    })).resolves.toBeNull()
  })

  it('atomically claims a prepared purchase before execution', async () => {
    mockedPrisma.soulPreparedPurchase.findUnique
      .mockResolvedValueOnce({
        id: 'prepared-1',
        agentMemberId: 'agent-1',
        soulOnChainId: SOUL_OBJECT_ID,
        executedAt: null,
        expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        id: 'prepared-1',
        soulOnChainId: SOUL_OBJECT_ID,
        listingObjectId: LISTING_OBJECT_ID,
        sellerKioskId: SELLER_KIOSK_ID,
        agentAddress: AGENT_ADDRESS,
        priceAtomic: 1_000_000n,
        platformFeeAtomic: 50_000n,
        creatorRoyaltyAtomic: 25_000n,
        totalAtomic: 1_075_000n,
        txBytesBase64: 'c2VydmVyLXR4',
        txBytesHash: 'deadbeef',
        executedAt: new Date('2099-01-01T00:00:01.000Z'),
        executionTxDigest: null,
        resultStatusCode: null,
        resultBody: null,
      })

    const { claimPreparedSoulPurchaseForExecution } = await import('../../web/lib/souls/prepared-purchase.ts')

    const prepared = await claimPreparedSoulPurchaseForExecution({
      preparedPurchaseId: 'prepared-1',
      agentMemberId: 'agent-1',
      soulOnChainId: SOUL_OBJECT_ID,
    })

    expect(prepared?.id).toBe('prepared-1')
    expect(mockedPrisma.soulPreparedPurchase.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'prepared-1',
        executedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      data: {
        executedAt: expect.any(Date),
      },
    })
  })

  it('returns null when the execution claim compare-and-set misses', async () => {
    mockedPrisma.soulPreparedPurchase.findUnique.mockResolvedValueOnce({
      id: 'prepared-1',
      agentMemberId: 'agent-1',
      soulOnChainId: SOUL_OBJECT_ID,
      executedAt: null,
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    })
    mockedPrisma.soulPreparedPurchase.updateMany.mockResolvedValueOnce({ count: 0 })

    const { claimPreparedSoulPurchaseForExecution } = await import('../../web/lib/souls/prepared-purchase.ts')

    await expect(claimPreparedSoulPurchaseForExecution({
      preparedPurchaseId: 'prepared-1',
      agentMemberId: 'agent-1',
      soulOnChainId: SOUL_OBJECT_ID,
    })).resolves.toBeNull()

    expect(mockedPrisma.soulPreparedPurchase.findUnique).toHaveBeenCalledTimes(1)
  })

  it('still returns executed purchases after expiry so finalize recovery can continue', async () => {
    mockedPrisma.soulPreparedPurchase.findUnique.mockResolvedValueOnce({
      id: 'prepared-1',
      agentMemberId: 'agent-1',
      soulOnChainId: SOUL_OBJECT_ID,
      listingObjectId: LISTING_OBJECT_ID,
      sellerKioskId: SELLER_KIOSK_ID,
      agentAddress: AGENT_ADDRESS,
      priceAtomic: 1_000_000n,
      platformFeeAtomic: 50_000n,
      creatorRoyaltyAtomic: 25_000n,
      totalAtomic: 1_075_000n,
      txBytesBase64: 'c2VydmVyLXR4',
      txBytesHash: 'deadbeef',
      expiresAt: new Date('2000-01-01T00:00:00.000Z'),
      executedAt: new Date('2099-01-01T00:00:01.000Z'),
      executionTxDigest: '0xtx',
      resultStatusCode: null,
      resultBody: null,
    })

    const { getPreparedSoulPurchaseForExecution } = await import('../../web/lib/souls/prepared-purchase.ts')

    await expect(getPreparedSoulPurchaseForExecution({
      preparedPurchaseId: 'prepared-1',
      agentMemberId: 'agent-1',
      soulOnChainId: SOUL_OBJECT_ID,
    })).resolves.toEqual(expect.objectContaining({
      id: 'prepared-1',
      executionTxDigest: '0xtx',
    }))
  })

  it('releases an execution claim so a failed broadcast can be retried', async () => {
    const { releasePreparedSoulPurchaseExecution } = await import('../../web/lib/souls/prepared-purchase.ts')

    await releasePreparedSoulPurchaseExecution({
      preparedPurchaseId: 'prepared-1',
    })

    expect(mockedPrisma.soulPreparedPurchase.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'prepared-1',
        resultStatusCode: null,
      },
      data: {
        executedAt: null,
        executionTxDigest: null,
      },
    })
  })
})
