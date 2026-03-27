import { beforeEach, describe, expect, it, vi } from 'vitest'

const CREATOR_ADDRESS = `0x${'a'.repeat(64)}`
const OWNER_ADDRESS = `0x${'b'.repeat(64)}`

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
      currentOwnerAddress: CREATOR_ADDRESS,
      currentOwnerMemberId: 'member-1',
      sellerKioskId: '0xkiosk',
      listedPriceSui: 1_000_000_000n,
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
      grantVersion: 0n,
      agentGrantAddress: null,
      agentAccessCapOnChainId: null,
    })

    expect(mockedPrisma.soulAsset.upsert).toHaveBeenCalledWith({
      where: { onChainId: '0xsoul' },
      create: expect.objectContaining({
        creatorAddress: CREATOR_ADDRESS,
        creatorMemberId: 'member-1',
      }),
      update: expect.objectContaining({
        creatorAddress: CREATOR_ADDRESS,
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
      currentOwnerAddress: CREATOR_ADDRESS,
      currentOwnerMemberId: 'member-1',
      sellerKioskId: '0xkiosk',
      listedPriceSui: 1_000_000_000n,
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
      grantVersion: 0n,
      agentGrantAddress: null,
      agentAccessCapOnChainId: null,
    })).rejects.toThrow('existing Soul creator does not match the submitted on-chain creator')
  })

  it('allows a relisting holder to refresh a Soul without impersonating the creator member id', async () => {
    const { dbUpsertSoulAsset } = await import('../../web/lib/souls/post-tx-db.ts')

    await expect(dbUpsertSoulAsset({
      soulOnChainId: '0xsoul',
      creatorAddress: CREATOR_ADDRESS,
      creatorMemberId: null,
      currentOwnerAddress: OWNER_ADDRESS,
      currentOwnerMemberId: 'member-holder',
      sellerKioskId: '0xkiosk',
      listedPriceSui: 2_000_000_000n,
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
      grantVersion: 1n,
      agentGrantAddress: null,
      agentAccessCapOnChainId: null,
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
      currentOwnerAddress: '0xA',
      sellerKioskId: null,
      listedPriceSui: null,
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
      grantVersion: 2n,
      agentGrantAddress: null,
      agentAccessCapOnChainId: null,
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

  it('updates the mirrored agent grant fields for a soul', async () => {
    const { dbSetSoulAgentGrant } = await import('../../web/lib/souls/post-tx-db.ts')

    await dbSetSoulAgentGrant({
      soulOnChainId: '0xsoul',
      agentGrantAddress: OWNER_ADDRESS,
      agentAccessCapOnChainId: '0xcap',
      grantVersion: 3n,
    })

    expect(mockedPrisma.soulAsset.updateMany).toHaveBeenCalledWith({
      where: { onChainId: '0xsoul' },
      data: {
        agentGrantAddress: OWNER_ADDRESS,
        agentAccessCapOnChainId: '0xcap',
        grantVersion: '3',
      },
    })
  })

  it('clears mirrored listing and grant state when ownership changes after purchase', async () => {
    const { dbSetSoulOwnership } = await import('../../web/lib/souls/post-tx-db.ts')

    await dbSetSoulOwnership({
      soulOnChainId: '0xsoul',
      currentOwnerAddress: OWNER_ADDRESS,
      currentOwnerMemberId: 'member-buyer',
      listingStatus: 'held',
      sellerKioskId: null,
      listedPriceSui: null,
      grantVersion: 4n,
    })

    expect(mockedPrisma.soulAsset.updateMany).toHaveBeenCalledWith({
      where: { onChainId: '0xsoul' },
      data: {
        currentOwnerAddress: OWNER_ADDRESS,
        currentOwnerMemberId: 'member-buyer',
        listingStatus: 'held',
        sellerKioskId: null,
        listedPriceSui: null,
        agentGrantAddress: null,
        agentAccessCapOnChainId: null,
        grantVersion: '4',
      },
    })
  })
})
