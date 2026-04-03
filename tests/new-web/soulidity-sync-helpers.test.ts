import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedGetSoulObject = vi.hoisted(() => vi.fn())
const mockedGetSoulStateObject = vi.hoisted(() => vi.fn())
const mockedGetSoulMemoryObject = vi.hoisted(() => vi.fn())
const mockedGetSoulSkillsObject = vi.hoisted(() => vi.fn())
const mockedGetSkillVersionObject = vi.hoisted(() => vi.fn())
const mockedGetRegisteredPersonalKiosk = vi.hoisted(() => vi.fn())
const mockedUpsertSoulProjection = vi.hoisted(() => vi.fn())
const mockedUpsertSkillVersionProjection = vi.hoisted(() => vi.fn())

vi.mock('@/lib/soulidity/queries', () => ({
  getSoulObject: mockedGetSoulObject,
  getSoulStateObject: mockedGetSoulStateObject,
  getSoulMemoryObject: mockedGetSoulMemoryObject,
  getSoulSkillsObject: mockedGetSoulSkillsObject,
  getSkillVersionObject: mockedGetSkillVersionObject,
  getRegisteredPersonalKiosk: mockedGetRegisteredPersonalKiosk,
  getSoulCollectionObject: vi.fn(),
  getSoulCollectionRightObject: vi.fn(),
  getSoulGrantObject: vi.fn(),
}))

vi.mock('@/lib/soulidity/env', () => ({
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
      metadataRef: null,
      provenanceKind: 'native',
      originRef: null,
      creatorAddress: '0xcreator',
    })
    mockedGetSoulStateObject.mockResolvedValue({
      objectId: '0xstate',
      currentOwnerAddress: '0xowner',
      currentKioskId: '0xkiosk',
      creatorRoyaltyBps: 500,
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
      latestVersionId: '0xversion1',
    })
    mockedGetSkillVersionObject.mockResolvedValue({
      objectId: '0xversion1',
      versionNumber: 1,
      visibility: 'private',
      blobObjectId: '0xskillblob',
      blobId: 'skill-blob-id',
      previousVersionId: null,
      createdAtMs: 1710000000000,
    })
    mockedUpsertSoulProjection.mockResolvedValue({
      onChainId: '0xsoul',
      latestSkillVersionOnChainId: '0xversion1',
    })
    mockedUpsertSkillVersionProjection.mockResolvedValue({
      versionOnChainId: '0xversion1',
    })
  })

  it('upserts the latest mirrored skill version alongside the soul projection', async () => {
    const { syncSoulProjectionFromChain } = await import('../../new-web/lib/soulidity/mirror/sync-helpers')
    const skillSealSidecar = {
      version: 1,
      mode: 'seal-envelope',
      documentId: '0x1234',
      encryptedDek: 'ZW5jcnlwdGVk',
      iv: 'AAAAAAAAAAAAAAAA',
      cipher: 'AES-GCM-256',
      mimeType: 'text/markdown',
      fileName: 'skills.md',
      contentHash: 'a'.repeat(64),
    } as const

    await syncSoulProjectionFromChain({
      packageId: '0xpackage',
      soulObjectId: '0xsoul',
      stateObjectId: '0xstate',
      memoryObjectId: '0xmemory',
      category: 'agents',
      tags: ['alpha'],
      previewImages: [],
      latestSkillVersionSealSidecar: skillSealSidecar,
    })

    expect(mockedUpsertSoulProjection).toHaveBeenCalledWith(expect.objectContaining({
      latestSkillVersionOnChainId: '0xversion1',
    }))
    expect(mockedUpsertSkillVersionProjection).toHaveBeenCalledWith({
      version: expect.objectContaining({ objectId: '0xversion1' }),
      soulOnChainId: '0xsoul',
      skillsOnChainId: '0xskills',
      sealSidecar: skillSealSidecar,
    })
  })
})
