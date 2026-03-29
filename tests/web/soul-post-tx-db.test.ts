import { beforeEach, describe, expect, it, vi } from 'vitest'

const CREATOR_ADDRESS = `0x${'a'.repeat(64)}`
const OWNER_ADDRESS = `0x${'b'.repeat(64)}`
const LISTING_OBJECT_ID = `0x${'e'.repeat(64)}`
const CURRENT_KIOSK_ID = `0x${'c'.repeat(64)}`
const CURRENT_KIOSK_CAP_ID = `0x${'d'.repeat(64)}`

const mockedPrisma = vi.hoisted(() => ({
  soulAsset: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    updateMany: vi.fn(),
  },
  walletBinding: {
    findFirst: vi.fn(),
  },
}))

vi.mock('../../../generated/prisma/client', () => ({
  Prisma: {
    Decimal: class MockDecimal {
      value: string

      constructor(value: string) {
        this.value = value
      }

      toString() {
        return this.value
      }

      toJSON() {
        return this.value
      }
    },
  },
}))

vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

describe('post-tx db soul asset mirror', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    mockedPrisma.soulAsset.findUnique.mockResolvedValue({
      id: 'asset-db-1',
      creatorMemberId: 'member-1',
      creatorAddress: CREATOR_ADDRESS,
    })
    mockedPrisma.soulAsset.upsert.mockResolvedValue({})
    mockedPrisma.soulAsset.updateMany.mockResolvedValue({ count: 1 })
    mockedPrisma.walletBinding.findFirst.mockResolvedValue(null)
  })

  it('refreshes the stored creator address while preserving the existing creator member binding', async () => {
    const { dbUpsertSoulAsset } = await import('../../web/lib/souls/post-tx-db.ts')

    await dbUpsertSoulAsset({
      soulOnChainId: '0xsoul',
      creatorAddress: CREATOR_ADDRESS,
      creatorMemberId: 'member-1',
      creatorRoyaltyBps: 250,
      currentOwnerAddress: CREATOR_ADDRESS,
      currentOwnerMemberId: 'member-1',
      currentKioskId: CURRENT_KIOSK_ID,
      currentKioskCapOnChainId: CURRENT_KIOSK_CAP_ID,
      listingObjectOnChainId: LISTING_OBJECT_ID,
      listedPriceAtomic: 1_000_000_000n,
      listingStatus: 'listed',
      name: 'Signal Soul',
      description: 'A recovered mirror',
      imageUrl: 'https://example.com/soul.png',
      metadataRef: 'walrus://metadata',
      contentBlobId: 'blob-1',
      contentBlobObjectId: '0xblob',
      category: 'Research',
      tags: ['alpha'],
      previewImages: ['blob-1'],
      readme: 'README',
      allowlistVersion: 0n,
      allowlistAddress: null,
      allowlistCapOnChainId: null,
    })

    expect(mockedPrisma.soulAsset.upsert).toHaveBeenCalledWith({
      where: { onChainId: '0xsoul' },
      create: expect.objectContaining({
        creatorAddress: CREATOR_ADDRESS,
        creatorMemberId: 'member-1',
        creatorRoyaltyBps: 250,
        listingObjectOnChainId: LISTING_OBJECT_ID,
      }),
      update: expect.objectContaining({
        creatorAddress: CREATOR_ADDRESS,
        creatorRoyaltyBps: 250,
        listingObjectOnChainId: LISTING_OBJECT_ID,
      }),
    })
    const upsertArgs = mockedPrisma.soulAsset.upsert.mock.calls[0]?.[0]
    expect(upsertArgs?.update).not.toHaveProperty('creatorMemberId')
  })

  it('rejects a soul mirror when the stored creator does not match the on-chain creator', async () => {
    mockedPrisma.soulAsset.findUnique.mockResolvedValueOnce({
      id: 'asset-db-1',
      creatorMemberId: 'member-other',
      creatorAddress: OWNER_ADDRESS,
    })

    const { dbUpsertSoulAsset } = await import('../../web/lib/souls/post-tx-db.ts')

    await expect(dbUpsertSoulAsset({
      soulOnChainId: '0xsoul',
      creatorAddress: CREATOR_ADDRESS,
      creatorMemberId: 'member-1',
      creatorRoyaltyBps: 250,
      currentOwnerAddress: CREATOR_ADDRESS,
      currentOwnerMemberId: 'member-1',
      currentKioskId: CURRENT_KIOSK_ID,
      currentKioskCapOnChainId: CURRENT_KIOSK_CAP_ID,
      listingObjectOnChainId: LISTING_OBJECT_ID,
      listedPriceAtomic: 1_000_000_000n,
      listingStatus: 'listed',
      name: 'Signal Soul',
      description: 'A recovered mirror',
      imageUrl: 'https://example.com/soul.png',
      metadataRef: null,
      contentBlobId: 'blob-1',
      contentBlobObjectId: '0xblob',
      category: 'Research',
      tags: ['alpha'],
      previewImages: ['blob-1'],
      readme: null,
      allowlistVersion: 0n,
      allowlistAddress: null,
      allowlistCapOnChainId: null,
    })).rejects.toThrow('existing Soul creator does not match the submitted on-chain creator')
  })

  it('allows a relisting holder to refresh a Soul without impersonating the creator member id', async () => {
    const { dbUpsertSoulAsset } = await import('../../web/lib/souls/post-tx-db.ts')

    await expect(dbUpsertSoulAsset({
      soulOnChainId: '0xsoul',
      creatorAddress: CREATOR_ADDRESS,
      creatorMemberId: null,
      creatorRoyaltyBps: 250,
      currentOwnerAddress: OWNER_ADDRESS,
      currentOwnerMemberId: 'member-holder',
      currentKioskId: CURRENT_KIOSK_ID,
      currentKioskCapOnChainId: CURRENT_KIOSK_CAP_ID,
      listingObjectOnChainId: LISTING_OBJECT_ID,
      listedPriceAtomic: 2_000_000_000n,
      listingStatus: 'listed',
      name: 'Signal Soul',
      description: 'A relisted mirror',
      imageUrl: 'https://example.com/soul.png',
      metadataRef: null,
      contentBlobId: 'blob-1',
      contentBlobObjectId: '0xblob',
      category: 'Research',
      tags: ['alpha'],
      previewImages: ['blob-1'],
      readme: null,
      allowlistVersion: 1n,
      allowlistAddress: null,
      allowlistCapOnChainId: null,
    })).resolves.toBeDefined()

    expect(mockedPrisma.soulAsset.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        currentOwnerAddress: OWNER_ADDRESS,
        currentOwnerMemberId: 'member-holder',
      }),
    }))
  })

  it('normalizes owner addresses before resolving wallet bindings and persisting soul mirrors', async () => {
    const normalizedOwnerAddress = `0x${'0'.repeat(63)}a`
    mockedPrisma.walletBinding.findFirst.mockResolvedValueOnce({
      memberId: 'member-owner',
    })

    const { dbUpsertSoulAsset } = await import('../../web/lib/souls/post-tx-db.ts')

    await dbUpsertSoulAsset({
      soulOnChainId: '0xsoul',
      creatorAddress: CREATOR_ADDRESS,
      creatorMemberId: 'member-1',
      creatorRoyaltyBps: 250,
      currentOwnerAddress: '0xA',
      currentKioskId: CURRENT_KIOSK_ID,
      currentKioskCapOnChainId: CURRENT_KIOSK_CAP_ID,
      listingObjectOnChainId: null,
      listedPriceAtomic: null,
      listingStatus: 'held',
      name: 'Signal Soul',
      description: 'A recovered mirror',
      imageUrl: 'https://example.com/soul.png',
      metadataRef: null,
      contentBlobId: 'blob-1',
      contentBlobObjectId: '0xblob',
      category: 'Research',
      tags: ['alpha'],
      previewImages: ['blob-1'],
      readme: null,
      allowlistVersion: 2n,
      allowlistAddress: null,
      allowlistCapOnChainId: null,
    })

    expect(mockedPrisma.walletBinding.findFirst).toHaveBeenCalledWith({
      where: { address: normalizedOwnerAddress, chain: 'sui' },
    })
    expect(mockedPrisma.soulAsset.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        currentOwnerAddress: normalizedOwnerAddress,
        currentOwnerMemberId: 'member-owner',
      }),
    }))
  })

  it('updates the mirrored allowlist fields for a soul', async () => {
    const { dbSetSoulAllowlist } = await import('../../web/lib/souls/post-tx-db.ts')

    await dbSetSoulAllowlist({
      soulOnChainId: '0xsoul',
      allowlistAddress: OWNER_ADDRESS,
      allowlistCapOnChainId: '0xcap',
      allowlistVersion: 3n,
    })

    expect(mockedPrisma.soulAsset.updateMany).toHaveBeenCalledWith({
      where: { onChainId: '0xsoul' },
      data: {
        allowlistAddress: OWNER_ADDRESS,
        allowlistCapOnChainId: '0xcap',
        allowlistVersion: '3',
      },
    })
  })

  it('normalizes short-form allowlist addresses before mirroring them', async () => {
    const { dbSetSoulAllowlist } = await import('../../web/lib/souls/post-tx-db.ts')

    await dbSetSoulAllowlist({
      soulOnChainId: '0xsoul',
      allowlistAddress: '0xA',
      allowlistCapOnChainId: '0xcap',
      allowlistVersion: 3n,
    })

    expect(mockedPrisma.soulAsset.updateMany).toHaveBeenCalledWith({
      where: { onChainId: '0xsoul' },
      data: {
        allowlistAddress: `0x${'0'.repeat(63)}a`,
        allowlistCapOnChainId: '0xcap',
        allowlistVersion: '3',
      },
    })
  })

  it('clears mirrored allowlist fields for a soul', async () => {
    const { dbClearSoulAllowlist } = await import('../../web/lib/souls/post-tx-db.ts')

    await dbClearSoulAllowlist({
      soulOnChainId: '0xsoul',
      allowlistVersion: 4n,
    })

    expect(mockedPrisma.soulAsset.updateMany).toHaveBeenCalledWith({
      where: { onChainId: '0xsoul' },
      data: {
        allowlistAddress: null,
        allowlistCapOnChainId: null,
        allowlistVersion: '4',
      },
    })
  })

  it('throws when clearing allowlist state for a Soul that is not mirrored locally', async () => {
    mockedPrisma.soulAsset.updateMany.mockResolvedValueOnce({ count: 0 })

    const { dbClearSoulAllowlist } = await import('../../web/lib/souls/post-tx-db.ts')

    await expect(dbClearSoulAllowlist({
      soulOnChainId: '0xmissing',
      allowlistVersion: 4n,
    })).rejects.toThrow('Soul 0xmissing not found')
  })

  it('clears mirrored listing and allowlist state when ownership changes after purchase', async () => {
    const { dbSetSoulOwnership } = await import('../../web/lib/souls/post-tx-db.ts')

    await dbSetSoulOwnership({
      soulOnChainId: '0xsoul',
      currentOwnerAddress: OWNER_ADDRESS,
      currentOwnerMemberId: 'member-buyer',
      currentKioskId: CURRENT_KIOSK_ID,
      currentKioskCapOnChainId: CURRENT_KIOSK_CAP_ID,
      listingObjectOnChainId: null,
      listingStatus: 'held',
      listedPriceAtomic: null,
      allowlistVersion: 4n,
    })

    expect(mockedPrisma.soulAsset.updateMany).toHaveBeenCalledWith({
      where: { onChainId: '0xsoul' },
      data: {
        currentOwnerAddress: OWNER_ADDRESS,
        currentOwnerMemberId: 'member-buyer',
        currentKioskId: CURRENT_KIOSK_ID,
        currentKioskCapOnChainId: CURRENT_KIOSK_CAP_ID,
        listingObjectOnChainId: null,
        listingStatus: 'held',
        listedPriceAtomic: null,
        allowlistAddress: null,
        allowlistCapOnChainId: null,
        allowlistVersion: '4',
      },
    })
  })

  it('preserves an already-mirrored allowlist when ownership sync is retried after access is reconfigured', async () => {
    const { dbSetSoulOwnership } = await import('../../web/lib/souls/post-tx-db.ts')

    await dbSetSoulOwnership({
      soulOnChainId: '0xsoul',
      currentOwnerAddress: OWNER_ADDRESS,
      currentOwnerMemberId: 'member-buyer',
      currentKioskId: CURRENT_KIOSK_ID,
      currentKioskCapOnChainId: CURRENT_KIOSK_CAP_ID,
      listingObjectOnChainId: null,
      listingStatus: 'held',
      listedPriceAtomic: null,
      allowlistVersion: 5n,
      preserveExistingAllowlistMirror: true,
    })

    expect(mockedPrisma.soulAsset.updateMany).toHaveBeenCalledWith({
      where: { onChainId: '0xsoul' },
      data: {
        currentOwnerAddress: OWNER_ADDRESS,
        currentOwnerMemberId: 'member-buyer',
        currentKioskId: CURRENT_KIOSK_ID,
        currentKioskCapOnChainId: CURRENT_KIOSK_CAP_ID,
        listingObjectOnChainId: null,
        listingStatus: 'held',
        listedPriceAtomic: null,
        allowlistVersion: '5',
      },
    })
  })

  it('throws when setting ownership for a Soul that is not mirrored locally', async () => {
    mockedPrisma.soulAsset.updateMany.mockResolvedValueOnce({ count: 0 })

    const { dbSetSoulOwnership } = await import('../../web/lib/souls/post-tx-db.ts')

    await expect(dbSetSoulOwnership({
      soulOnChainId: '0xmissing',
      currentOwnerAddress: OWNER_ADDRESS,
      currentOwnerMemberId: 'member-buyer',
      currentKioskId: CURRENT_KIOSK_ID,
      currentKioskCapOnChainId: CURRENT_KIOSK_CAP_ID,
      listingObjectOnChainId: null,
      listingStatus: 'held',
      listedPriceAtomic: null,
      allowlistVersion: 4n,
    })).rejects.toThrow('Soul 0xmissing not found')
  })

  it('normalizes ownership addresses before mirroring purchase ownership updates', async () => {
    mockedPrisma.walletBinding.findFirst.mockResolvedValueOnce({
      memberId: 'member-buyer',
    })

    const { dbSetSoulOwnership } = await import('../../web/lib/souls/post-tx-db.ts')

    await dbSetSoulOwnership({
      soulOnChainId: '0xsoul',
      currentOwnerAddress: '0xA',
      currentKioskId: CURRENT_KIOSK_ID,
      currentKioskCapOnChainId: CURRENT_KIOSK_CAP_ID,
      listingObjectOnChainId: null,
      listingStatus: 'held',
      listedPriceAtomic: null,
      allowlistVersion: 4n,
    })

    expect(mockedPrisma.walletBinding.findFirst).toHaveBeenCalledWith({
      where: { address: `0x${'0'.repeat(63)}a`, chain: 'sui' },
    })
    expect(mockedPrisma.soulAsset.updateMany).toHaveBeenCalledWith({
      where: { onChainId: '0xsoul' },
      data: expect.objectContaining({
        currentOwnerAddress: `0x${'0'.repeat(63)}a`,
        currentOwnerMemberId: 'member-buyer',
      }),
    })
  })

  it('normalizes kiosk object ids before mirroring purchase ownership updates', async () => {
    const { dbSetSoulOwnership } = await import('../../web/lib/souls/post-tx-db.ts')

    await dbSetSoulOwnership({
      soulOnChainId: '0xsoul',
      currentOwnerAddress: OWNER_ADDRESS,
      currentOwnerMemberId: 'member-buyer',
      currentKioskId: '0xC',
      currentKioskCapOnChainId: '0xD',
      listingObjectOnChainId: null,
      listingStatus: 'held',
      listedPriceAtomic: null,
      allowlistVersion: 4n,
    })

    expect(mockedPrisma.soulAsset.updateMany).toHaveBeenCalledWith({
      where: { onChainId: '0xsoul' },
      data: expect.objectContaining({
        currentKioskId: `0x${'0'.repeat(63)}c`,
        currentKioskCapOnChainId: `0x${'0'.repeat(63)}d`,
      }),
    })
  })
})
