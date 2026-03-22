import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedPrisma = vi.hoisted(() => ({
  soulPreparedPurchase: {
    create: vi.fn(),
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
    mockedPrisma.soulPreparedPurchase.findUnique.mockResolvedValue({
      id: 'prepared-1',
      agentMemberId: 'agent-1',
      seriesOnChainId: '0xseries',
      planOnChainId: '0xplan',
      planType: 'onetime',
      releaseOnChainId: '0xrelease',
      agentAddress: '0xagent',
      amountUsdc: 1_000_000n,
      txBytesBase64: 'c2VydmVyLXR4',
      txBytesHash: 'deadbeef',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      executedAt: new Date('2099-01-01T00:00:01.000Z'),
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
      seriesOnChainId: '0xseries',
      planOnChainId: '0xplan',
      planType: 'onetime',
      releaseOnChainId: '0xrelease',
      agentAddress: '0xagent',
      amountUsdc: 1_000_000n,
      txBytesBase64: 'c2VydmVyLXR4',
    })

    expect(mockedPrisma.soulPreparedPurchase.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        txBytesBase64: 'c2VydmVyLXR4',
        txBytesHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
      select: {
        id: true,
        expiresAt: true,
      },
    })
  })

  it('atomically claims a prepared purchase before execution', async () => {
    const { claimPreparedSoulPurchaseForExecution } = await import('../../web/lib/souls/prepared-purchase.ts')

    const prepared = await claimPreparedSoulPurchaseForExecution({
      preparedPurchaseId: 'prepared-1',
      agentMemberId: 'agent-1',
      seriesOnChainId: '0xseries',
    })

    expect(prepared?.id).toBe('prepared-1')
    expect(mockedPrisma.soulPreparedPurchase.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'prepared-1',
        agentMemberId: 'agent-1',
        seriesOnChainId: '0xseries',
        executedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      data: {
        executedAt: expect.any(Date),
      },
    })
  })
})
