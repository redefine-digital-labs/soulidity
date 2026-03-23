import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedPrisma = vi.hoisted(() => ({
  soulTxSync: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
}))

vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

describe('soul tx sync storage', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    mockedPrisma.soulTxSync.findUnique.mockResolvedValue(null)
    mockedPrisma.soulTxSync.upsert.mockResolvedValue({})
  })

  it('scopes cached tx sync lookups to the authenticated actor', async () => {
    const { getStoredSoulTxSync } = await import('../../web/lib/souls/tx-sync.ts')

    await getStoredSoulTxSync({
      txDigest: '0xtx',
      routeKey: 'purchase',
      actorKey: 'member-1',
      resourceKey: '0xresource',
    })

    expect(mockedPrisma.soulTxSync.findUnique).toHaveBeenCalledWith({
      where: {
        routeKey_txDigest_actorKey_resourceKey: {
          routeKey: 'purchase',
          txDigest: '0xtx',
          actorKey: 'member-1',
          resourceKey: '0xresource',
        },
      },
      select: {
        statusCode: true,
        responseBody: true,
      },
    })
  })

  it('rejects oversized cached response bodies before writing them to the database', async () => {
    const { storeSoulTxSync } = await import('../../web/lib/souls/tx-sync.ts')

    await expect(storeSoulTxSync({
      txDigest: '0xtx',
      routeKey: 'purchase',
      actorKey: 'member-1',
      resourceKey: '0xresource',
      statusCode: 200,
      body: { payload: 'x'.repeat(70_000) },
    })).rejects.toThrow('Soul tx sync body exceeds the size limit')

    expect(mockedPrisma.soulTxSync.upsert).not.toHaveBeenCalled()
  })
})
