import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@web/lib/prisma', () => ({
  prisma: {
    soulAsset: {
      findFirst: vi.fn(),
    },
  },
}))

function makeRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'asset-db-1',
    onChainId: `0x${'1'.repeat(64)}`,
    name: 'Signal Soul',
    description: 'desc',
    imageUrl: 'https://example.com/soul.png',
    category: 'Research',
    tags: [],
    previewImages: [],
    creatorRoyaltyBps: 0,
    listingObjectOnChainId: null,
    listedPriceAtomic: null,
    listingStatus: 'held',
    creatorAddress: `0x${'2'.repeat(64)}`,
    currentOwnerAddress: `0x${'3'.repeat(64)}`,
    currentKioskId: `0x${'4'.repeat(64)}`,
    metadataRef: null,
    contentBlobId: 'blob-content',
    contentBlobObjectId: `0x${'5'.repeat(64)}`,
    currentKioskCapOnChainId: `0x${'6'.repeat(64)}`,
    readme: null,
    allowlistAddress: null,
    allowlistCapOnChainId: null,
    allowlistVersion: '1',
    creatorMemberId: 'creator-1',
    currentOwnerMemberId: 'owner-1',
    sealSidecar: null,
    createdAt: new Date('2026-03-27T00:00:00.000Z'),
    updatedAt: new Date('2026-03-27T00:00:00.000Z'),
    ...overrides,
  } as any
}

describe('soul repository helpers', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('treats short-form and canonical allowlist addresses as the same viewer', async () => {
    const { toSoulAssetDetail } = await import('../../web/lib/souls/repository.ts')
    const detail = toSoulAssetDetail(makeRecord({
      allowlistAddress: `0x${'0'.repeat(63)}1`,
      allowlistCapOnChainId: `0x${'7'.repeat(64)}`,
    }), {
      viewerMemberId: null,
      viewerWalletAddresses: ['0x1'],
    })

    expect(detail.isAllowlisted).toBe(true)
    expect(detail.contentBlobId).toBe('blob-content')
    expect(detail.contentBlobObjectId).toBe(`0x${'5'.repeat(64)}`)
    expect(detail.allowlistAddress).toBeNull()
    expect(detail.allowlistCapOnChainId).toBe(`0x${'7'.repeat(64)}`)
    expect(detail.allowlistVersion).toBe('1')
    expect(detail.creatorMemberId).toBeNull()
    expect(detail.currentOwnerMemberId).toBeNull()
  })

  it('marks creator and current owner flags from member ids', async () => {
    const { toSoulAssetDetail } = await import('../../web/lib/souls/repository.ts')
    const detail = toSoulAssetDetail(makeRecord(), {
      viewerMemberId: 'owner-1',
      viewerWalletAddresses: [],
    })

    expect(detail.isOwner).toBe(true)
    expect(detail.isCreator).toBe(false)
  })

  it('treats a wallet-matched viewer as the owner when the member mirror has not caught up', async () => {
    const { toSoulAssetDetail } = await import('../../web/lib/souls/repository.ts')
    const detail = toSoulAssetDetail(makeRecord({
      currentOwnerAddress: `0x${'0'.repeat(63)}3`,
      currentOwnerMemberId: null,
      allowlistAddress: `0x${'8'.repeat(64)}`,
      allowlistCapOnChainId: `0x${'7'.repeat(64)}`,
    }), {
      viewerMemberId: null,
      viewerWalletAddresses: ['0x3'],
    })

    expect(detail.isOwner).toBe(true)
    expect(detail.contentBlobId).toBe('blob-content')
    expect(detail.contentBlobObjectId).toBe(`0x${'5'.repeat(64)}`)
    expect(detail.currentKioskCapOnChainId).toBe(`0x${'6'.repeat(64)}`)
    expect(detail.allowlistAddress).toBe(`0x${'8'.repeat(64)}`)
    expect(detail.allowlistCapOnChainId).toBe(`0x${'7'.repeat(64)}`)
  })

  it('hides sensitive detail fields from unauthenticated viewers', async () => {
    const { toSoulAssetDetail } = await import('../../web/lib/souls/repository.ts')
    const detail = toSoulAssetDetail(makeRecord({
      allowlistAddress: `0x${'8'.repeat(64)}`,
      allowlistCapOnChainId: `0x${'7'.repeat(64)}`,
    }), {
      viewerMemberId: null,
      viewerWalletAddresses: [],
    })

    expect(detail.contentBlobId).toBeNull()
    expect(detail.contentBlobObjectId).toBeNull()
    expect(detail.currentKioskCapOnChainId).toBeNull()
    expect(detail.allowlistAddress).toBeNull()
    expect(detail.allowlistCapOnChainId).toBeNull()
    expect(detail.allowlistVersion).toBeNull()
    expect(detail.creatorMemberId).toBeNull()
    expect(detail.currentOwnerMemberId).toBeNull()
  })

  it('keeps private detail fields for the current owner detail view', async () => {
    const { toSoulAssetDetail } = await import('../../web/lib/souls/repository.ts')
    const detail = toSoulAssetDetail(makeRecord({
      allowlistAddress: `0x${'8'.repeat(64)}`,
      allowlistCapOnChainId: `0x${'7'.repeat(64)}`,
    }), {
      viewerMemberId: 'owner-1',
      viewerWalletAddresses: [],
    })

    expect(detail.contentBlobId).toBe('blob-content')
    expect(detail.contentBlobObjectId).toBe(`0x${'5'.repeat(64)}`)
    expect(detail.currentKioskCapOnChainId).toBe(`0x${'6'.repeat(64)}`)
    expect(detail.allowlistAddress).toBe(`0x${'8'.repeat(64)}`)
    expect(detail.allowlistCapOnChainId).toBe(`0x${'7'.repeat(64)}`)
    expect(detail.allowlistVersion).toBe('1')
    expect(detail.creatorMemberId).toBe('creator-1')
    expect(detail.currentOwnerMemberId).toBe('owner-1')
  })

  it('routes UUID ids to the database id field and non-UUID ids to on-chain id', async () => {
    const { buildSoulAssetRouteWhere } = await import('../../web/lib/souls/repository.ts')

    expect(buildSoulAssetRouteWhere('550e8400-e29b-41d4-a716-446655440000')).toEqual({
      id: '550e8400-e29b-41d4-a716-446655440000',
    })
    expect(buildSoulAssetRouteWhere('0x1')).toEqual({
      onChainId: `0x${'0'.repeat(63)}1`,
    })
    expect(buildSoulAssetRouteWhere('0xsoul')).toBeNull()
  })

  it('serializes summary timestamps and decimal listing amounts for API output', async () => {
    const { toSoulAssetSummary } = await import('../../web/lib/souls/repository.ts')
    const summary = toSoulAssetSummary(makeRecord({
      listedPriceAtomic: { toString: () => '123456789' },
      listingStatus: 'listed',
      previewImages: ['blob-1'],
    }))

    expect(summary).toMatchObject({
      listedPriceAtomic: '123456789',
      listingStatus: 'listed',
      createdAt: '2026-03-27T00:00:00.000Z',
      updatedAt: '2026-03-27T00:00:00.000Z',
    })
  })

  it('queries detail records with the route-aware where clause', async () => {
    const { prisma } = await import('@web/lib/prisma')
    const mockedFindFirst = vi.mocked(prisma.soulAsset.findFirst)
    mockedFindFirst.mockResolvedValueOnce(null)
    const { findSoulAssetDetailByRouteId } = await import('../../web/lib/souls/repository.ts')

    await findSoulAssetDetailByRouteId(`0x${'1'.repeat(64)}`)

    expect(mockedFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { onChainId: `0x${'1'.repeat(64)}` },
    }))
  })

  it('returns null without querying Prisma when the Soul route id is malformed', async () => {
    const { prisma } = await import('@web/lib/prisma')
    const mockedFindFirst = vi.mocked(prisma.soulAsset.findFirst)
    const { findSoulAssetDetailByRouteId } = await import('../../web/lib/souls/repository.ts')

    await expect(findSoulAssetDetailByRouteId('0xsoul')).resolves.toBeNull()
    expect(mockedFindFirst).not.toHaveBeenCalled()
  })
})
