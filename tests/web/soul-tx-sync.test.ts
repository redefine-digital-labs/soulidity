import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedPrisma = vi.hoisted(() => ({
  soulTxSync: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
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
    mockedPrisma.soulTxSync.findFirst.mockResolvedValue(null)
    mockedPrisma.soulTxSync.upsert.mockResolvedValue({})
  })

  it('scopes cached tx sync lookups to the authenticated actor', async () => {
    const { getStoredSoulTxSync } = await import('../../web/lib/souls/tx-sync.ts')

    await expect(getStoredSoulTxSync({
      txDigest: '0xtx',
      routeKey: 'purchase',
      actorKey: 'member-1',
      resourceKey: '0xresource',
    })).resolves.toBeNull()

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

  it('returns the cached response body under the public body field', async () => {
    mockedPrisma.soulTxSync.findUnique.mockResolvedValueOnce({
      statusCode: 201,
      responseBody: { ok: true, id: 'cached' },
    })

    const { getStoredSoulTxSync } = await import('../../web/lib/souls/tx-sync.ts')

    await expect(getStoredSoulTxSync({
      txDigest: '0xtx',
      routeKey: 'publish',
      actorKey: 'member-1',
      resourceKey: '0xresource',
    })).resolves.toEqual({
      statusCode: 201,
      body: { ok: true, id: 'cached' },
    })
  })

  it('rejects tx digests that were already mirrored by another actor before hitting chain RPCs', async () => {
    mockedPrisma.soulTxSync.findFirst.mockResolvedValue({ actorKey: 'member-2' })

    const { getStoredSoulTxSync } = await import('../../web/lib/souls/tx-sync.ts')

    await expect(getStoredSoulTxSync({
      txDigest: '0xtx',
      routeKey: 'purchase',
      actorKey: 'member-1',
      resourceKey: '0xresource',
    })).resolves.toEqual({
      statusCode: 409,
      body: { error: 'txDigest has already been processed by another account' },
    })

    expect(mockedPrisma.soulTxSync.findFirst).toHaveBeenCalledWith({
      where: {
        txDigest: '0xtx',
        NOT: { actorKey: 'member-1' },
      },
      select: {
        actorKey: true,
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
