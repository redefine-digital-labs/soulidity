import { beforeEach, describe, expect, it, vi } from 'vitest'

const SERIES_OBJECT_ID = `0x${'a'.repeat(64)}`
const SERIES_OBJECT_ID_UPPER = `0x${'A'.repeat(64)}`
const PLAN_OBJECT_ID = `0x${'2'.repeat(64)}`
const RELEASE_OBJECT_ID = `0x${'3'.repeat(64)}`
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
      seriesOnChainId: SERIES_OBJECT_ID,
      planOnChainId: PLAN_OBJECT_ID,
      planType: 'onetime',
      releaseOnChainId: RELEASE_OBJECT_ID,
      passOnChainId: null,
      agentAddress: AGENT_ADDRESS,
      amountUsdc: 1_000_000n,
      txBytesBase64: 'c2VydmVyLXR4',
      txBytesHash: 'deadbeef',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      executedAt: null,
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
      seriesOnChainId: SERIES_OBJECT_ID,
      planOnChainId: PLAN_OBJECT_ID,
      planType: 'onetime',
      releaseOnChainId: RELEASE_OBJECT_ID,
      agentAddress: AGENT_ADDRESS,
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

  it('throttles expired prepared purchase cleanup across burst prepare calls', async () => {
    const { createPreparedSoulPurchase } = await import('../../web/lib/souls/prepared-purchase.ts')

    await createPreparedSoulPurchase({
      agentMemberId: 'agent-1',
      seriesOnChainId: SERIES_OBJECT_ID,
      planOnChainId: PLAN_OBJECT_ID,
      planType: 'onetime',
      releaseOnChainId: RELEASE_OBJECT_ID,
      agentAddress: AGENT_ADDRESS,
      amountUsdc: 1_000_000n,
      txBytesBase64: 'c2VydmVyLXR4',
    })
    await createPreparedSoulPurchase({
      agentMemberId: 'agent-1',
      seriesOnChainId: SERIES_OBJECT_ID,
      planOnChainId: PLAN_OBJECT_ID,
      planType: 'onetime',
      releaseOnChainId: RELEASE_OBJECT_ID,
      agentAddress: AGENT_ADDRESS,
      amountUsdc: 1_000_000n,
      txBytesBase64: 'Y2xpZW50LXR4',
    })

    expect(mockedPrisma.soulPreparedPurchase.deleteMany).toHaveBeenCalledTimes(1)
    expect(mockedPrisma.soulPreparedPurchase.deleteMany).toHaveBeenCalledWith({
      where: {
        expiresAt: { lt: expect.any(Date) },
        executedAt: null,
        resultStatusCode: null,
        executionTxDigest: null,
      },
    })
  })

  it('does not wait for expired prepared purchase cleanup before persisting a new prepare record', async () => {
    let resolveCleanup: ((value: { count: number }) => void) | undefined

    mockedPrisma.soulPreparedPurchase.deleteMany.mockImplementation(
      () => new Promise((resolve) => { resolveCleanup = resolve }),
    )

    const { createPreparedSoulPurchase } = await import('../../web/lib/souls/prepared-purchase.ts')
    const preparePromise = createPreparedSoulPurchase({
      agentMemberId: 'agent-1',
      seriesOnChainId: SERIES_OBJECT_ID,
      planOnChainId: PLAN_OBJECT_ID,
      planType: 'onetime',
      releaseOnChainId: RELEASE_OBJECT_ID,
      agentAddress: AGENT_ADDRESS,
      amountUsdc: 1_000_000n,
      txBytesBase64: 'c2VydmVyLXR4',
    })

    let settled = false
    preparePromise.then(() => { settled = true })
    await Promise.resolve()
    await Promise.resolve()

    const settledBeforeCleanup = settled
    resolveCleanup?.({ count: 0 })

    await expect(preparePromise).resolves.toMatchObject({ id: 'prepared-1' })
    expect(settledBeforeCleanup).toBe(true)
    expect(mockedPrisma.soulPreparedPurchase.create).toHaveBeenCalled()
  })

  it('returns finalized prepared purchases as-is instead of extending their expired execute window', async () => {
    const conflict = new Error('Unique constraint failed')
    ;(conflict as Error & { code?: string }).code = 'P2002'
    mockedPrisma.soulPreparedPurchase.create.mockRejectedValueOnce(conflict)
    mockedPrisma.soulPreparedPurchase.findFirst.mockResolvedValueOnce({
      id: 'prepared-1',
      expiresAt: new Date('2000-01-01T00:00:00.000Z'),
      executedAt: new Date('2000-01-01T00:01:00.000Z'),
      resultStatusCode: 200,
    })
    const { createPreparedSoulPurchase } = await import('../../web/lib/souls/prepared-purchase.ts')

    const prepared = await createPreparedSoulPurchase({
      agentMemberId: 'agent-1',
      seriesOnChainId: SERIES_OBJECT_ID,
      planOnChainId: PLAN_OBJECT_ID,
      planType: 'onetime',
      releaseOnChainId: RELEASE_OBJECT_ID,
      agentAddress: AGENT_ADDRESS,
      amountUsdc: 1_000_000n,
      txBytesBase64: 'c2VydmVyLXR4',
    })

    expect(prepared).toEqual({
      id: 'prepared-1',
      expiresAt: new Date('2000-01-01T00:00:00.000Z'),
      executedAt: new Date('2000-01-01T00:01:00.000Z'),
      resultStatusCode: 200,
    })
    expect(mockedPrisma.soulPreparedPurchase.update).not.toHaveBeenCalled()
  })

  it('guards prepared purchase conflict refreshes against rows claimed mid-flight', async () => {
    const conflict = new Error('Unique constraint failed')
    ;(conflict as Error & { code?: string }).code = 'P2002'
    mockedPrisma.soulPreparedPurchase.create.mockRejectedValueOnce(conflict)
    mockedPrisma.soulPreparedPurchase.findFirst.mockResolvedValueOnce({
      id: 'prepared-1',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      executedAt: null,
      resultStatusCode: null,
    })
    mockedPrisma.soulPreparedPurchase.updateMany.mockResolvedValueOnce({ count: 0 })

    const { createPreparedSoulPurchase } = await import('../../web/lib/souls/prepared-purchase.ts')

    const prepared = await createPreparedSoulPurchase({
      agentMemberId: 'agent-1',
      seriesOnChainId: SERIES_OBJECT_ID,
      planOnChainId: PLAN_OBJECT_ID,
      planType: 'onetime',
      releaseOnChainId: RELEASE_OBJECT_ID,
      agentAddress: AGENT_ADDRESS,
      amountUsdc: 1_000_000n,
      txBytesBase64: 'c2VydmVyLXR4',
    })

    expect(prepared).toEqual({
      id: 'prepared-1',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      executedAt: null,
      resultStatusCode: null,
    })
    expect(mockedPrisma.soulPreparedPurchase.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'prepared-1',
        executedAt: null,
        resultStatusCode: null,
      },
      data: {
        seriesOnChainId: SERIES_OBJECT_ID,
        planOnChainId: PLAN_OBJECT_ID,
        planType: 'onetime',
        releaseOnChainId: RELEASE_OBJECT_ID,
        passOnChainId: null,
        agentAddress: AGENT_ADDRESS,
        amountUsdc: '1000000',
        txBytesBase64: 'c2VydmVyLXR4',
        expiresAt: expect.any(Date),
      },
    })
  })

  it('reclaims expired claimed prepares that never finalized so the same tx hash can be retried', async () => {
    const conflict = new Error('Unique constraint failed')
    ;(conflict as Error & { code?: string }).code = 'P2002'
    mockedPrisma.soulPreparedPurchase.create.mockRejectedValueOnce(conflict)
    mockedPrisma.soulPreparedPurchase.findFirst.mockResolvedValueOnce({
      id: 'prepared-1',
      expiresAt: new Date('2000-01-01T00:00:00.000Z'),
      executedAt: new Date('2000-01-01T00:01:00.000Z'),
      executionTxDigest: null,
      resultStatusCode: null,
    })
    mockedPrisma.soulPreparedPurchase.updateMany.mockResolvedValueOnce({ count: 1 })

    const { createPreparedSoulPurchase } = await import('../../web/lib/souls/prepared-purchase.ts')

    const prepared = await createPreparedSoulPurchase({
      agentMemberId: 'agent-1',
      seriesOnChainId: SERIES_OBJECT_ID,
      planOnChainId: PLAN_OBJECT_ID,
      planType: 'onetime',
      releaseOnChainId: RELEASE_OBJECT_ID,
      agentAddress: AGENT_ADDRESS,
      amountUsdc: 1_000_000n,
      txBytesBase64: 'c2VydmVyLXR4',
    })

    expect(prepared).toEqual({
      id: 'prepared-1',
      expiresAt: expect.any(Date),
    })
    expect(mockedPrisma.soulPreparedPurchase.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'prepared-1',
        executedAt: { not: null },
        executionTxDigest: null,
        resultStatusCode: null,
        expiresAt: { lte: expect.any(Date) },
      },
      data: {
        seriesOnChainId: SERIES_OBJECT_ID,
        planOnChainId: PLAN_OBJECT_ID,
        planType: 'onetime',
        releaseOnChainId: RELEASE_OBJECT_ID,
        passOnChainId: null,
        agentAddress: AGENT_ADDRESS,
        amountUsdc: '1000000',
        txBytesBase64: 'c2VydmVyLXR4',
        executedAt: null,
        expiresAt: expect.any(Date),
      },
    })
  })

  it('atomically claims a prepared purchase before execution', async () => {
    mockedPrisma.soulPreparedPurchase.findUnique
      .mockResolvedValueOnce({
        id: 'prepared-1',
        agentMemberId: 'agent-1',
        seriesOnChainId: SERIES_OBJECT_ID,
        executedAt: null,
        expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        id: 'prepared-1',
        seriesOnChainId: SERIES_OBJECT_ID,
        planOnChainId: PLAN_OBJECT_ID,
        planType: 'onetime',
        releaseOnChainId: RELEASE_OBJECT_ID,
        agentAddress: AGENT_ADDRESS,
        amountUsdc: 1_000_000n,
        txBytesBase64: 'c2VydmVyLXR4',
        txBytesHash: 'deadbeef',
        executedAt: new Date('2099-01-01T00:00:01.000Z'),
        resultStatusCode: null,
        resultBody: null,
      })

    const { claimPreparedSoulPurchaseForExecution } = await import('../../web/lib/souls/prepared-purchase.ts')

    const prepared = await claimPreparedSoulPurchaseForExecution({
      preparedPurchaseId: 'prepared-1',
      agentMemberId: 'agent-1',
      seriesOnChainId: SERIES_OBJECT_ID,
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

  it('releases an execution claim so a failed broadcast can be retried', async () => {
    const { releasePreparedSoulPurchaseExecution } = await import('../../web/lib/souls/prepared-purchase.ts')

    await releasePreparedSoulPurchaseExecution({
      preparedPurchaseId: 'prepared-1',
    })

    expect(mockedPrisma.soulPreparedPurchase.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'prepared-1',
        resultStatusCode: null,
        executionTxDigest: null,
      },
      data: {
        executedAt: null,
      },
    })
  })

  it('still returns finalized prepared purchases after their execute window expires', async () => {
    mockedPrisma.soulPreparedPurchase.findUnique.mockResolvedValueOnce({
        id: 'prepared-1',
        agentMemberId: 'agent-1',
        seriesOnChainId: SERIES_OBJECT_ID_UPPER,
        planOnChainId: PLAN_OBJECT_ID,
        planType: 'onetime',
        releaseOnChainId: RELEASE_OBJECT_ID,
        agentAddress: AGENT_ADDRESS,
        amountUsdc: 1_000_000n,
        txBytesBase64: 'c2VydmVyLXR4',
        txBytesHash: 'deadbeef',
      expiresAt: new Date('2000-01-01T00:00:00.000Z'),
      executedAt: new Date('2000-01-01T00:00:01.000Z'),
      resultStatusCode: 200,
      resultBody: { ok: true },
    })

    const { getPreparedSoulPurchaseForExecution } = await import('../../web/lib/souls/prepared-purchase.ts')

    await expect(getPreparedSoulPurchaseForExecution({
      preparedPurchaseId: 'prepared-1',
      agentMemberId: 'agent-1',
      seriesOnChainId: SERIES_OBJECT_ID,
    })).resolves.toMatchObject({
      id: 'prepared-1',
      resultStatusCode: 200,
      resultBody: { ok: true },
    })
  })

  it('matches prepared purchases against series ids case-insensitively', async () => {
    mockedPrisma.soulPreparedPurchase.findUnique.mockResolvedValueOnce({
      id: 'prepared-1',
      agentMemberId: 'agent-1',
      seriesOnChainId: SERIES_OBJECT_ID_UPPER,
      planOnChainId: PLAN_OBJECT_ID,
      planType: 'onetime',
      releaseOnChainId: RELEASE_OBJECT_ID,
      agentAddress: AGENT_ADDRESS,
      amountUsdc: 1_000_000n,
      txBytesBase64: 'c2VydmVyLXR4',
      txBytesHash: 'deadbeef',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      executedAt: null,
      resultStatusCode: null,
      resultBody: null,
    })

    const { getPreparedSoulPurchaseForExecution } = await import('../../web/lib/souls/prepared-purchase.ts')

    await expect(getPreparedSoulPurchaseForExecution({
      preparedPurchaseId: 'prepared-1',
      agentMemberId: 'agent-1',
      seriesOnChainId: SERIES_OBJECT_ID,
    })).resolves.toMatchObject({
      id: 'prepared-1',
      seriesOnChainId: SERIES_OBJECT_ID_UPPER,
    })
  })

  it('claims prepared purchases even when the stored series id casing differs', async () => {
    mockedPrisma.soulPreparedPurchase.findUnique
      .mockResolvedValueOnce({
        id: 'prepared-1',
        agentMemberId: 'agent-1',
        seriesOnChainId: SERIES_OBJECT_ID_UPPER,
        executedAt: null,
        expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        id: 'prepared-1',
        seriesOnChainId: SERIES_OBJECT_ID_UPPER,
        planOnChainId: PLAN_OBJECT_ID,
        planType: 'onetime',
        releaseOnChainId: RELEASE_OBJECT_ID,
        agentAddress: AGENT_ADDRESS,
        amountUsdc: 1_000_000n,
        txBytesBase64: 'c2VydmVyLXR4',
        txBytesHash: 'deadbeef',
        executedAt: new Date('2099-01-01T00:00:01.000Z'),
        resultStatusCode: null,
        resultBody: null,
      })

    const { claimPreparedSoulPurchaseForExecution } = await import('../../web/lib/souls/prepared-purchase.ts')

    await expect(claimPreparedSoulPurchaseForExecution({
      preparedPurchaseId: 'prepared-1',
      agentMemberId: 'agent-1',
      seriesOnChainId: SERIES_OBJECT_ID,
    })).resolves.toMatchObject({
      id: 'prepared-1',
      seriesOnChainId: SERIES_OBJECT_ID_UPPER,
    })
  })
})
