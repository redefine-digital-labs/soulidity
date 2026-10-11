import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedGetSoulObject = vi.hoisted(() => vi.fn())
const mockedGetSoulStateObject = vi.hoisted(() => vi.fn())
const mockedGetSoulMemoryObject = vi.hoisted(() => vi.fn())
const mockedGetSoulMetadataObject = vi.hoisted(() => vi.fn())
const mockedGetSoulSkillsObject = vi.hoisted(() => vi.fn())
const mockedGetSkillVersionObject = vi.hoisted(() => vi.fn())
const mockedGetRegisteredPersonalKiosk = vi.hoisted(() => vi.fn())
const mockedUpsertSoulProjection = vi.hoisted(() => vi.fn())
const mockedUpsertSkillVersionProjection = vi.hoisted(() => vi.fn())

vi.mock('@soulidity/sdk/queries', () => ({
  getSoulObject: mockedGetSoulObject,
  getSoulStateObject: mockedGetSoulStateObject,
  getSoulMemoryObject: mockedGetSoulMemoryObject,
  getSoulMetadataObject: mockedGetSoulMetadataObject,
  getSoulSkillsObject: mockedGetSoulSkillsObject,
  getSkillVersionObject: mockedGetSkillVersionObject,
  getRegisteredPersonalKiosk: mockedGetRegisteredPersonalKiosk,
  listOwnedPersonalKioskCaps: vi.fn().mockResolvedValue([]),
  getSoulCollectionObject: vi.fn(),
  getSoulCollectionRightObject: vi.fn(),
  getSoulGrantObject: vi.fn(),
}))

vi.mock('@soulidity/sdk/env', () => ({
  getRequiredSoulidityEnv: vi.fn((name: string) => `0x_mock_${name}`),
  getOptionalSoulidityEnv: vi.fn(),
}))

vi.mock('@/lib/soulidity/mirror/upsert-soul', () => ({
  upsertSoulProjection: mockedUpsertSoulProjection,
}))

vi.mock('@/lib/soulidity/mirror/upsert-skill', () => ({
  upsertSkillVersionProjection: mockedUpsertSkillVersionProjection,
  markSkillVersionDeleted: vi.fn(),
}))

vi.mock('@/lib/soulidity/mirror/upsert-collection', () => ({
  upsertCollectionProjection: vi.fn(),
}))

vi.mock('@/lib/soulidity/mirror/upsert-grant', () => ({
  upsertGrantProjection: vi.fn(),
  endSoulGrantProjection: vi.fn(),
  endActiveSoulGrantProjections: vi.fn(),
}))

vi.mock('@/lib/soulidity/mirror/upsert-asset', () => ({
  upsertAssetVersionProjection: vi.fn(),
}))

vi.mock('@/lib/soulidity/mirror/upsert-content-access', () => ({
  upsertContentAccessProjection: vi.fn(),
  markContentAccessRevoked: vi.fn(),
}))

describe('syncSoulProjectionFromChain', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockedGetRegisteredPersonalKiosk.mockResolvedValue({
      kioskId: '0xkiosk',
      kioskCapOnChainId: '0xkioskcap',
    })
    mockedGetSoulObject.mockResolvedValue({
      objectId: '0xsoul',
      protectedBlobObjectId: '0xblob',
      protectedBlobId: 'blob-id',
      name: 'Soul',
      description: 'desc',
      imageUrl: 'https://example.com/soul.png',
      provenanceKind: 'native',
      originRef: null,
      creatorAddress: '0xcreator',
    })
    mockedGetSoulStateObject.mockResolvedValue({
      objectId: '0xstate',
      currentOwnerAddress: '0xowner',
      currentKioskId: '0xkiosk',
      creatorRoyaltyBps: 500,
      memoryId: '0xmemory',
      metadataId: null,
      collectionId: null,
      grantCapacity: 3,
      activeGrantCount: 1,
      skillsId: '0xskills',
    })
    mockedGetSoulMemoryObject.mockResolvedValue({
      objectId: '0xmemory',
    })
    mockedGetSoulSkillsObject.mockResolvedValue({
      objectId: '0xskills',
      skillCount: 1,
      skillsTableId: '0xskillstable',
    })
    mockedUpsertSoulProjection.mockResolvedValue({
      onChainId: '0xsoul',
    })
  })

  it('upserts only the soul projection and stops mirroring a synthetic latest skill version pointer', async () => {
    const { syncSoulProjectionFromChain } = await import('../../web/lib/soulidity/mirror/sync-helpers')

    await syncSoulProjectionFromChain({
      packageId: '0xpackage',
      soulObjectId: '0xsoul',
      stateObjectId: '0xstate',
      memoryObjectId: '0xmemory',
      tags: ['alpha'],
      previewImages: [],
    })

    expect(mockedUpsertSoulProjection.mock.calls[0][0]).not.toHaveProperty('latestSkillVersionOnChainId')
    expect(mockedGetSkillVersionObject).not.toHaveBeenCalled()
    expect(mockedUpsertSkillVersionProjection).not.toHaveBeenCalled()
  })
})
