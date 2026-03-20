import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedPrisma = vi.hoisted(() => ({
  soulSeries: {
    findUnique: vi.fn(),
  },
  walletBinding: {
    findFirst: vi.fn(),
  },
  soulPassSnapshot: {
    upsert: vi.fn(),
  },
}))

const mockedSuiClient = vi.hoisted(() => ({
  getObject: vi.fn(),
  queryEvents: vi.fn(),
}))

vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

vi.mock('@web/lib/sui', () => ({
  suiClient: mockedSuiClient,
}))

describe('sui indexer event handlers', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

    mockedPrisma.soulSeries.findUnique.mockResolvedValue({ id: 'series-db-1' })
    mockedPrisma.walletBinding.findFirst.mockResolvedValue({ memberId: 'member-1' })
    mockedPrisma.soulPassSnapshot.upsert.mockResolvedValue({})
  })

  it('repairs ownerMemberId when replaying subscription pass mint events', async () => {
    const mod = await import('../../web/lib/services/sui-indexer.ts')
    const createEventHandlers = (mod as { createEventHandlers?: (packageId: string) => Record<string, (event: any) => Promise<void>> })
      .createEventHandlers

    expect(typeof createEventHandlers).toBe('function')

    const handler = createEventHandlers!('0xpackage')['0xpackage::pass::SubscriptionPassMinted']

    await handler({
      id: { txDigest: 'tx-1', eventSeq: '0' },
      type: '0xpackage::pass::SubscriptionPassMinted',
      parsedJson: {
        pass_id: 'pass-1',
        series_id: 'series-1',
        owner: '0xowner',
        expires_at: '1710000000000',
      },
    })

    expect(mockedPrisma.soulPassSnapshot.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          ownerAddress: '0xowner',
          ownerMemberId: 'member-1',
          expiresAt: expect.any(Date),
        }),
      }),
    )
  })
})
