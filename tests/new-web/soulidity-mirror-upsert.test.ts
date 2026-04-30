import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  SoulObject,
  SoulStateObject,
  SoulMemoryObject,
  SoulGrantObject,
  SoulCollectionObject,
  SoulCollectionRightObject,
  MemoryEntryObject,
  SkillVersionObject,
} from '@/lib/soulidity/types'

// ---------------------------------------------------------------------------
// Prisma mock — hoisted so vi.mock() can reference it
// ---------------------------------------------------------------------------
const mockedPrisma = vi.hoisted(() => ({
  soulAsset: { upsert: vi.fn(), count: vi.fn() },
  soulCollectionAsset: { upsert: vi.fn(), updateMany: vi.fn() },
  soulGrantRecord: { upsert: vi.fn(), updateMany: vi.fn() },
  soulMemoryEntry: { upsert: vi.fn() },
  soulSkillVersionRecord: { upsert: vi.fn(), updateMany: vi.fn() },
}))

vi.mock('@web/lib/prisma', () => ({ prisma: mockedPrisma }))

// The types file imports SealEnvelopeSidecar — stub it so the TS import resolves
vi.mock('@web/lib/services/seal-crypto', () => ({
  SealEnvelopeSidecar: {},
}))

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function makeSoulObject(overrides?: Partial<SoulObject>): SoulObject {
  return {
    objectId: '0xsoul123',
    packageId: '0xpkg',
    creatorAddress: '0xcreator',
    name: 'Test Soul',
    description: 'A test soul',
    imageUrl: 'https://example.com/soul.png',
    protectedBlobId: 'blob-id-123',
    protectedBlobObjectId: '0xblobobj',
    provenanceKind: 'native',
    originRef: null,
    ...overrides,
  }
}

function makeSoulStateObject(overrides?: Partial<SoulStateObject>): SoulStateObject {
  return {
    objectId: '0xstate456',
    packageId: '0xpkg',
    soulId: '0xsoul123',
    creatorAddress: '0xcreator',
    creatorRoyaltyBps: 500,
    currentOwnerAddress: '0xowner789',
    currentKioskId: '0xkiosk',
    ownershipEpoch: 1,
    grantCapacity: 3,
    activeGrantCount: 0,
    activeGrants: [],
    metadataId: '0xmetadata',
    skillsId: '0xskills',
    collectionId: null,
    ...overrides,
  }
}

function makeSoulMemoryObject(overrides?: Partial<SoulMemoryObject>): SoulMemoryObject {
  return {
    objectId: '0xmemory',
    packageId: '0xpkg',
    soulId: '0xsoul123',
    entryCount: 0,
    entriesTableId: '0xtable',
    ...overrides,
  }
}

function makeGrantObject(overrides?: Partial<SoulGrantObject>): SoulGrantObject {
  return {
    objectId: '0xgrant1',
    packageId: '0xpkg',
    soulId: '0xsoul123',
    granteeAddress: '0xgrantee',
    issuedByAddress: '0xissuer',
    ownershipEpochSnapshot: 1,
    scopeMask: 7,
    scopes: ['seal', 'memory', 'skills'],
    expiresAtMs: null,
    ...overrides,
  }
}

function makeCollectionObject(overrides?: Partial<SoulCollectionObject>): SoulCollectionObject {
  return {
    objectId: '0xcol1',
    packageId: '0xpkg',
    creatorAddress: '0xcreator',
    extraRoyaltyBps: 200,
    tradeable: true,
    currentHolderAddress: '0xholder',
    currentHolderKioskId: '0xholderkiosk',
    rightId: '0xright1',
    ...overrides,
  }
}

function makeCollectionRightObject(overrides?: Partial<SoulCollectionRightObject>): SoulCollectionRightObject {
  return {
    objectId: '0xright1',
    packageId: '0xpkg',
    collectionId: '0xcol1',
    creatorAddress: '0xcreator',
    name: 'My Collection',
    description: 'A test collection',
    imageUrl: 'https://example.com/col.png',
    extraRoyaltyBps: 200,
    tradeable: true,
    ...overrides,
  }
}

function makeMemoryEntryObject(overrides?: Partial<MemoryEntryObject>): MemoryEntryObject {
  return {
    packageId: '0xpkg',
    memoryId: '0xmemory',
    soulId: '0xsoul123',
    timestampKey: 1710000000000,
    writerAddress: '0xwriter',
    writerKind: 'owner',
    createdAtMs: 1710000000000,
    blobObjectId: '0xblobobj',
    blobId: 'blob-id-entry',
    ...overrides,
  }
}

function makeSkillVersionObject(overrides?: Partial<SkillVersionObject>): SkillVersionObject {
  return {
    packageId: '0xpkg',
    soulId: '0xsoul123',
    skillsId: '0xskills',
    skillName: 'reporter',
    versionIndex: 1,
    visibility: 'public',
    deleted: false,
    createdAtMs: 1710000000000,
    blobObjectId: '0xskillblob',
    blobId: 'skill-blob-id',
    ...overrides,
  }
}

// =========================================================================
// upsertSoulProjection
// =========================================================================
describe('upsertSoulProjection', () => {
  beforeEach(() => vi.resetAllMocks())

  it('calls prisma.soulAsset.upsert with correct where/create/update', async () => {
    mockedPrisma.soulAsset.upsert.mockResolvedValue({ onChainId: '0xsoul123' })

    const { upsertSoulProjection } = await import('../../web/lib/soulidity/mirror/upsert-soul')

    await upsertSoulProjection({
      soul: makeSoulObject(),
      state: makeSoulStateObject(),
      memory: makeSoulMemoryObject(),
      currentKioskCapOnChainId: '0xkioskcap_explicit',

      tags: ['test'],
      previewImages: ['https://example.com/preview.png'],
    })

    expect(mockedPrisma.soulAsset.upsert).toHaveBeenCalledOnce()
    const call = mockedPrisma.soulAsset.upsert.mock.calls[0][0]

    // where key
    expect(call.where).toEqual({ onChainId: '0xsoul123' })

    // create + update share the same soul id
    expect(call.create.onChainId).toBe('0xsoul123')
    expect(call.update).not.toHaveProperty('onChainId')
  })

  it('uses params.currentKioskCapOnChainId (NOT state.currentKioskId) — kiosk cap bug fix', async () => {
    mockedPrisma.soulAsset.upsert.mockResolvedValue({ onChainId: '0xsoul123' })

    const { upsertSoulProjection } = await import('../../web/lib/soulidity/mirror/upsert-soul')

    await upsertSoulProjection({
      soul: makeSoulObject(),
      state: makeSoulStateObject({ currentKioskId: '0xkiosk_state_value' }),
      memory: makeSoulMemoryObject(),
      currentKioskCapOnChainId: '0xkioskcap_from_params',

      tags: [],
      previewImages: [],
    })

    const call = mockedPrisma.soulAsset.upsert.mock.calls[0][0]

    // The cap must come from the explicit param, not from state
    expect(call.create.currentKioskCapOnChainId).toBe('0xkioskcap_from_params')
    expect(call.update.currentKioskCapOnChainId).toBe('0xkioskcap_from_params')

    // currentKioskId still comes from state
    expect(call.create.currentKioskId).toBe('0xkiosk_state_value')
    expect(call.update.currentKioskId).toBe('0xkiosk_state_value')
  })

  it('converts listedPriceAtomic bigint to string', async () => {
    mockedPrisma.soulAsset.upsert.mockResolvedValue({ onChainId: '0xsoul123' })

    const { upsertSoulProjection } = await import('../../web/lib/soulidity/mirror/upsert-soul')

    await upsertSoulProjection({
      soul: makeSoulObject(),
      state: makeSoulStateObject(),
      memory: makeSoulMemoryObject(),
      currentKioskCapOnChainId: '0xkioskcap',

      tags: [],
      previewImages: [],
      listedPriceAtomic: 1_000_000_000n,
      listingStatus: 'listed',
      listingObjectOnChainId: '0xlisting',
    })

    const call = mockedPrisma.soulAsset.upsert.mock.calls[0][0]
    expect(call.create.listedPriceAtomic).toBe('1000000000')
    expect(call.update.listedPriceAtomic).toBe('1000000000')
    expect(call.create.listingStatus).toBe('listed')
    expect(call.create.listingObjectOnChainId).toBe('0xlisting')
  })

  it('listedPriceAtomic defaults to null when not provided', async () => {
    mockedPrisma.soulAsset.upsert.mockResolvedValue({ onChainId: '0xsoul123' })

    const { upsertSoulProjection } = await import('../../web/lib/soulidity/mirror/upsert-soul')

    await upsertSoulProjection({
      soul: makeSoulObject(),
      state: makeSoulStateObject(),
      memory: makeSoulMemoryObject(),
      currentKioskCapOnChainId: '0xkioskcap',

      tags: [],
      previewImages: [],
    })

    const call = mockedPrisma.soulAsset.upsert.mock.calls[0][0]
    expect(call.create.listedPriceAtomic).toBeNull()
    expect(call.update.listedPriceAtomic).toBeNull()
    expect(call.create.listingStatus).toBe('held')
  })

  it('contentBlobId falls back to protectedBlobObjectId when protectedBlobId is null', async () => {
    mockedPrisma.soulAsset.upsert.mockResolvedValue({ onChainId: '0xsoul123' })

    const { upsertSoulProjection } = await import('../../web/lib/soulidity/mirror/upsert-soul')

    await upsertSoulProjection({
      soul: makeSoulObject({ protectedBlobId: null, protectedBlobObjectId: '0xfallback_blob' }),
      state: makeSoulStateObject(),
      memory: makeSoulMemoryObject(),
      currentKioskCapOnChainId: '0xkioskcap',

      tags: [],
      previewImages: [],
    })

    const call = mockedPrisma.soulAsset.upsert.mock.calls[0][0]
    expect(call.create.contentBlobId).toBe('0xfallback_blob')
    expect(call.update.contentBlobId).toBe('0xfallback_blob')
    expect(call.create.contentBlobObjectId).toBe('0xfallback_blob')
  })

  it('contentBlobId uses protectedBlobId when present', async () => {
    mockedPrisma.soulAsset.upsert.mockResolvedValue({ onChainId: '0xsoul123' })

    const { upsertSoulProjection } = await import('../../web/lib/soulidity/mirror/upsert-soul')

    await upsertSoulProjection({
      soul: makeSoulObject({ protectedBlobId: 'real-blob-id', protectedBlobObjectId: '0xblobobj' }),
      state: makeSoulStateObject(),
      memory: makeSoulMemoryObject(),
      currentKioskCapOnChainId: '0xkioskcap',

      tags: [],
      previewImages: [],
    })

    const call = mockedPrisma.soulAsset.upsert.mock.calls[0][0]
    expect(call.create.contentBlobId).toBe('real-blob-id')
    expect(call.update.contentBlobId).toBe('real-blob-id')
  })

  it('maps all soul, state, and memory fields to the correct Prisma columns', async () => {
    mockedPrisma.soulAsset.upsert.mockResolvedValue({ onChainId: '0xsoul123' })

    const { upsertSoulProjection } = await import('../../web/lib/soulidity/mirror/upsert-soul')

    const soul = makeSoulObject()
    const state = makeSoulStateObject({ collectionId: '0xcol', skillsId: '0xskills' })
    const memory = makeSoulMemoryObject()

    await upsertSoulProjection({
      soul,
      state,
      memory,
      currentKioskCapOnChainId: '0xkioskcap',
      creatorMemberId: 'member-creator',
      currentOwnerMemberId: 'member-owner',

      tags: ['ai', 'bot'],
      previewImages: ['img1', 'img2'],
      readme: '# Hello',
      sealSidecar: { version: 1 },
    })

    const call = mockedPrisma.soulAsset.upsert.mock.calls[0][0]

    // Shared fields present in both create and update
    for (const section of [call.create, call.update]) {
      expect(section.stateOnChainId).toBe('0xstate456')
      expect(section.memoryOnChainId).toBe('0xmemory')
      expect(section.creatorMemberId).toBe('member-creator')
      expect(section.creatorAddress).toBe('0xcreator')
      expect(section.creatorRoyaltyBps).toBe(500)
      expect(section.currentOwnerMemberId).toBe('member-owner')
      expect(section.currentOwnerAddress).toBe('0xowner789')
      expect(section.currentKioskId).toBe('0xkiosk')
      expect(section.name).toBe('Test Soul')
      expect(section.description).toBe('A test soul')
      expect(section.imageUrl).toBe('https://example.com/soul.png')
      expect(section.metadataOnChainId).toBe('0xmetadata')
      expect(section.provenanceKind).toBe('native')
      expect(section.personaKind).toBe('agents')
      expect(section.originRef).toBeNull()
      expect(section.collectionOnChainId).toBe('0xcol')
      expect(section.grantCapacity).toBe(3)
      expect(section.activeGrantCount).toBe(0)
      expect(section.skillsOnChainId).toBe('0xskills')
      expect(section).not.toHaveProperty('latestSkillVersionOnChainId')
      expect(section.tags).toEqual(['ai', 'bot'])
      expect(section.previewImages).toEqual(['img1', 'img2'])
      expect(section.readme).toBe('# Hello')
      expect(section.sealSidecar).toEqual({ version: 1 })
    }
  })

  it('nullable optional fields default to null', async () => {
    mockedPrisma.soulAsset.upsert.mockResolvedValue({ onChainId: '0xsoul123' })

    const { upsertSoulProjection } = await import('../../web/lib/soulidity/mirror/upsert-soul')

    await upsertSoulProjection({
      soul: makeSoulObject(),
      state: makeSoulStateObject(),
      memory: makeSoulMemoryObject(),
      currentKioskCapOnChainId: '0xkioskcap',

      tags: [],
      previewImages: [],
      // deliberately omit optional fields
    })

    const call = mockedPrisma.soulAsset.upsert.mock.calls[0][0]
    expect(call.create.creatorMemberId).toBeNull()
    expect(call.create.currentOwnerMemberId).toBeNull()
    expect(call.create).not.toHaveProperty('latestSkillVersionOnChainId')
    expect(call.create.listingObjectOnChainId).toBeNull()
    expect(call.create.readme).toBeNull()
  })
})

// =========================================================================
// upsertGrantProjection
// =========================================================================
describe('upsertGrantProjection', () => {
  beforeEach(() => vi.resetAllMocks())

  it('calls prisma.soulGrantRecord.upsert with correct where and field mapping', async () => {
    mockedPrisma.soulGrantRecord.upsert.mockResolvedValue({ onChainId: '0xgrant1' })

    const { upsertGrantProjection } = await import('../../web/lib/soulidity/mirror/upsert-grant')

    await upsertGrantProjection({
      grant: makeGrantObject(),
      soulOnChainId: '0xsoul123',
      issuedByMemberId: 'member-issuer',
      granteeMemberId: 'member-grantee',
    })

    expect(mockedPrisma.soulGrantRecord.upsert).toHaveBeenCalledOnce()
    const call = mockedPrisma.soulGrantRecord.upsert.mock.calls[0][0]

    expect(call.where).toEqual({ onChainId: '0xgrant1' })
    expect(call.create.onChainId).toBe('0xgrant1')
    expect(call.create.soulOnChainId).toBe('0xsoul123')
    expect(call.create.issuedByAddress).toBe('0xissuer')
    expect(call.create.granteeAddress).toBe('0xgrantee')
    expect(call.create.scopes).toEqual(['seal', 'memory', 'skills'])
    expect(call.create.status).toBe('active')
    expect(call.create.issuedByMemberId).toBe('member-issuer')
    expect(call.create.granteeMemberId).toBe('member-grantee')
  })

  it('maps expiresAtMs to a Date when present', async () => {
    mockedPrisma.soulGrantRecord.upsert.mockResolvedValue({ onChainId: '0xgrant1' })

    const { upsertGrantProjection } = await import('../../web/lib/soulidity/mirror/upsert-grant')

    const expiresMs = 1720000000000
    await upsertGrantProjection({
      grant: makeGrantObject({ expiresAtMs: expiresMs }),
      soulOnChainId: '0xsoul123',
    })

    const call = mockedPrisma.soulGrantRecord.upsert.mock.calls[0][0]
    expect(call.create.expiresAt).toEqual(new Date(expiresMs))
    expect(call.update.expiresAt).toEqual(new Date(expiresMs))
  })

  it('expiresAt is null when expiresAtMs is null', async () => {
    mockedPrisma.soulGrantRecord.upsert.mockResolvedValue({ onChainId: '0xgrant1' })

    const { upsertGrantProjection } = await import('../../web/lib/soulidity/mirror/upsert-grant')

    await upsertGrantProjection({
      grant: makeGrantObject({ expiresAtMs: null }),
      soulOnChainId: '0xsoul123',
    })

    const call = mockedPrisma.soulGrantRecord.upsert.mock.calls[0][0]
    expect(call.create.expiresAt).toBeNull()
    expect(call.update.expiresAt).toBeNull()
  })

  it('respects explicit status and replacedByGrantOnChainId', async () => {
    mockedPrisma.soulGrantRecord.upsert.mockResolvedValue({ onChainId: '0xgrant1' })

    const { upsertGrantProjection } = await import('../../web/lib/soulidity/mirror/upsert-grant')

    const endedAt = new Date('2026-01-01')
    await upsertGrantProjection({
      grant: makeGrantObject(),
      soulOnChainId: '0xsoul123',
      status: 'superseded',
      endedAt,
      replacedByGrantOnChainId: '0xgrant2',
    })

    const call = mockedPrisma.soulGrantRecord.upsert.mock.calls[0][0]
    expect(call.create.status).toBe('superseded')
    expect(call.create.endedAt).toEqual(endedAt)
    expect(call.create.replacedByGrantOnChainId).toBe('0xgrant2')
    expect(call.update.status).toBe('superseded')
    expect(call.update.endedAt).toEqual(endedAt)
    expect(call.update.replacedByGrantOnChainId).toBe('0xgrant2')
  })
})

// =========================================================================
// endSoulGrantProjection
// =========================================================================
describe('endSoulGrantProjection', () => {
  beforeEach(() => vi.resetAllMocks())

  it('calls prisma.soulGrantRecord.updateMany with status and endedAt', async () => {
    mockedPrisma.soulGrantRecord.updateMany.mockResolvedValue({ count: 1 })

    const { endSoulGrantProjection } = await import('../../web/lib/soulidity/mirror/upsert-grant')

    const endedAt = new Date('2026-02-15')
    await endSoulGrantProjection({
      grantOnChainId: '0xgrant1',
      status: 'revoked',
      endedAt,
    })

    expect(mockedPrisma.soulGrantRecord.updateMany).toHaveBeenCalledOnce()
    const call = mockedPrisma.soulGrantRecord.updateMany.mock.calls[0][0]
    expect(call.where).toEqual({ onChainId: '0xgrant1' })
    expect(call.data.status).toBe('revoked')
    expect(call.data.endedAt).toEqual(endedAt)
  })

  it('defaults endedAt to current time when not provided', async () => {
    mockedPrisma.soulGrantRecord.updateMany.mockResolvedValue({ count: 1 })

    const { endSoulGrantProjection } = await import('../../web/lib/soulidity/mirror/upsert-grant')

    const before = new Date()
    await endSoulGrantProjection({
      grantOnChainId: '0xgrant1',
      status: 'expired',
    })
    const after = new Date()

    const call = mockedPrisma.soulGrantRecord.updateMany.mock.calls[0][0]
    const endedAt = call.data.endedAt as Date
    expect(endedAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
    expect(endedAt.getTime()).toBeLessThanOrEqual(after.getTime())
  })

  it('passes replacedByGrantOnChainId when provided', async () => {
    mockedPrisma.soulGrantRecord.updateMany.mockResolvedValue({ count: 1 })

    const { endSoulGrantProjection } = await import('../../web/lib/soulidity/mirror/upsert-grant')

    await endSoulGrantProjection({
      grantOnChainId: '0xgrant1',
      status: 'superseded',
      replacedByGrantOnChainId: '0xgrant_new',
    })

    const call = mockedPrisma.soulGrantRecord.updateMany.mock.calls[0][0]
    expect(call.data.replacedByGrantOnChainId).toBe('0xgrant_new')
  })
})

// =========================================================================
// endActiveSoulGrantProjections
// =========================================================================
describe('endActiveSoulGrantProjections', () => {
  beforeEach(() => vi.resetAllMocks())

  it('targets active grants for a specific soul', async () => {
    mockedPrisma.soulGrantRecord.updateMany.mockResolvedValue({ count: 2 })

    const { endActiveSoulGrantProjections } = await import('../../web/lib/soulidity/mirror/upsert-grant')

    await endActiveSoulGrantProjections({
      soulOnChainId: '0xsoul123',
      status: 'invalidated',
    })

    expect(mockedPrisma.soulGrantRecord.updateMany).toHaveBeenCalledOnce()
    const call = mockedPrisma.soulGrantRecord.updateMany.mock.calls[0][0]
    expect(call.where).toEqual({
      soulOnChainId: '0xsoul123',
      status: 'active',
    })
    expect(call.data.status).toBe('invalidated')
  })

  it('defaults endedAt to current time when not provided', async () => {
    mockedPrisma.soulGrantRecord.updateMany.mockResolvedValue({ count: 1 })

    const { endActiveSoulGrantProjections } = await import('../../web/lib/soulidity/mirror/upsert-grant')

    const before = new Date()
    await endActiveSoulGrantProjections({
      soulOnChainId: '0xsoul123',
      status: 'revoked',
    })
    const after = new Date()

    const call = mockedPrisma.soulGrantRecord.updateMany.mock.calls[0][0]
    const endedAt = call.data.endedAt as Date
    expect(endedAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
    expect(endedAt.getTime()).toBeLessThanOrEqual(after.getTime())
  })

  it('uses explicit endedAt when provided', async () => {
    mockedPrisma.soulGrantRecord.updateMany.mockResolvedValue({ count: 1 })

    const { endActiveSoulGrantProjections } = await import('../../web/lib/soulidity/mirror/upsert-grant')

    const endedAt = new Date('2026-03-01')
    await endActiveSoulGrantProjections({
      soulOnChainId: '0xsoul123',
      status: 'expired',
      endedAt,
    })

    const call = mockedPrisma.soulGrantRecord.updateMany.mock.calls[0][0]
    expect(call.data.endedAt).toEqual(endedAt)
  })
})

// =========================================================================
// upsertCollectionProjection
// =========================================================================
describe('upsertCollectionProjection', () => {
  beforeEach(() => vi.resetAllMocks())

  it('calls prisma.soulCollectionAsset.upsert with correct where and field mapping', async () => {
    mockedPrisma.soulAsset.count.mockResolvedValue(5)
    mockedPrisma.soulCollectionAsset.upsert.mockResolvedValue({ onChainId: '0xcol1' })

    const { upsertCollectionProjection } = await import('../../web/lib/soulidity/mirror/upsert-collection')

    await upsertCollectionProjection({
      collection: makeCollectionObject(),
      right: makeCollectionRightObject(),
      creatorMemberId: 'member-creator',
      currentHolderMemberId: 'member-holder',
    })

    expect(mockedPrisma.soulCollectionAsset.upsert).toHaveBeenCalledOnce()
    const call = mockedPrisma.soulCollectionAsset.upsert.mock.calls[0][0]

    expect(call.where).toEqual({ onChainId: '0xcol1' })
    expect(call.create.onChainId).toBe('0xcol1')
  })

  it('maps name, description, imageUrl from the right object (not collection)', async () => {
    mockedPrisma.soulAsset.count.mockResolvedValue(0)
    mockedPrisma.soulCollectionAsset.upsert.mockResolvedValue({ onChainId: '0xcol1' })

    const { upsertCollectionProjection } = await import('../../web/lib/soulidity/mirror/upsert-collection')

    const right = makeCollectionRightObject({
      name: 'Right Name',
      description: 'Right Desc',
      imageUrl: 'https://right-image.png',
    })

    await upsertCollectionProjection({
      collection: makeCollectionObject(),
      right,
    })

    const call = mockedPrisma.soulCollectionAsset.upsert.mock.calls[0][0]

    // Both create and update should use the right's fields
    for (const section of [call.create, call.update]) {
      expect(section.name).toBe('Right Name')
      expect(section.description).toBe('Right Desc')
      expect(section.imageUrl).toBe('https://right-image.png')
    }
  })

  it('counts existing souls for the collection', async () => {
    mockedPrisma.soulAsset.count.mockResolvedValue(42)
    mockedPrisma.soulCollectionAsset.upsert.mockResolvedValue({ onChainId: '0xcol1' })

    const { upsertCollectionProjection } = await import('../../web/lib/soulidity/mirror/upsert-collection')

    await upsertCollectionProjection({
      collection: makeCollectionObject(),
      right: makeCollectionRightObject(),
    })

    expect(mockedPrisma.soulAsset.count).toHaveBeenCalledWith({
      where: { collectionOnChainId: '0xcol1' },
    })

    const call = mockedPrisma.soulCollectionAsset.upsert.mock.calls[0][0]
    expect(call.create.soulCount).toBe(42)
    expect(call.update.soulCount).toBe(42)
  })

  it('converts listedPriceAtomic bigint to string', async () => {
    mockedPrisma.soulAsset.count.mockResolvedValue(0)
    mockedPrisma.soulCollectionAsset.upsert.mockResolvedValue({ onChainId: '0xcol1' })

    const { upsertCollectionProjection } = await import('../../web/lib/soulidity/mirror/upsert-collection')

    await upsertCollectionProjection({
      collection: makeCollectionObject(),
      right: makeCollectionRightObject(),
      listedPriceAtomic: 2_500_000_000n,
      listingStatus: 'listed',
      listingObjectOnChainId: '0xcolListing',
    })

    const call = mockedPrisma.soulCollectionAsset.upsert.mock.calls[0][0]
    expect(call.create.listedPriceAtomic).toBe('2500000000')
    expect(call.update.listedPriceAtomic).toBe('2500000000')
    expect(call.create.listingStatus).toBe('listed')
    expect(call.create.listingObjectOnChainId).toBe('0xcolListing')
  })

  it('maps collection structural fields correctly', async () => {
    mockedPrisma.soulAsset.count.mockResolvedValue(0)
    mockedPrisma.soulCollectionAsset.upsert.mockResolvedValue({ onChainId: '0xcol1' })

    const { upsertCollectionProjection } = await import('../../web/lib/soulidity/mirror/upsert-collection')

    await upsertCollectionProjection({
      collection: makeCollectionObject({ extraRoyaltyBps: 300, tradeable: false }),
      right: makeCollectionRightObject(),
    })

    const call = mockedPrisma.soulCollectionAsset.upsert.mock.calls[0][0]
    for (const section of [call.create, call.update]) {
      expect(section.rightOnChainId).toBe('0xright1')
      expect(section.creatorAddress).toBe('0xcreator')
      expect(section.currentHolderAddress).toBe('0xholder')
      expect(section.currentHolderKioskId).toBe('0xholderkiosk')
      expect(section.extraRoyaltyBps).toBe(300)
      expect(section.tradeable).toBe(false)
    }
  })
})

// =========================================================================
// upsertMemoryEntryProjection
// =========================================================================
describe('upsertMemoryEntryProjection', () => {
  beforeEach(() => vi.resetAllMocks())

  it('calls prisma.soulMemoryEntry.upsert with memoryOnChainId + timestampKey composite key', async () => {
    mockedPrisma.soulMemoryEntry.upsert.mockResolvedValue({ id: 'memory-entry-1' })

    const { upsertMemoryEntryProjection } = await import('../../web/lib/soulidity/mirror/upsert-memory')

    await upsertMemoryEntryProjection({
      entry: makeMemoryEntryObject(),
      sealSidecar: { version: 1, documentId: '0xmem-doc' },
    })

    expect(mockedPrisma.soulMemoryEntry.upsert).toHaveBeenCalledOnce()
    const call = mockedPrisma.soulMemoryEntry.upsert.mock.calls[0][0]

    expect(call.where).toEqual({
      memoryOnChainId_timestampKey: {
        memoryOnChainId: '0xmemory',
        timestampKey: BigInt(1710000000000),
      },
    })
  })

  it('maps timestampKey, writer fields, blob fields, and sealSidecar', async () => {
    mockedPrisma.soulMemoryEntry.upsert.mockResolvedValue({ id: 'memory-entry-1' })

    const { upsertMemoryEntryProjection } = await import('../../web/lib/soulidity/mirror/upsert-memory')

    await upsertMemoryEntryProjection({
      entry: makeMemoryEntryObject({
        memoryId: '0xmemory_fk',
        soulId: '0xsoul_abc',
        timestampKey: 1712345678000,
        writerAddress: '0xw',
        writerKind: 'granted-agent',
        blobObjectId: '0xblob_entry',
        blobId: 'entry-blob-id',
        createdAtMs: 1712345678000,
      }),
      sealSidecar: { version: 1, documentId: '0xmem-doc' },
    })

    const call = mockedPrisma.soulMemoryEntry.upsert.mock.calls[0][0]
    for (const section of [call.create, call.update]) {
      expect(section.memoryOnChainId).toBe('0xmemory_fk')
      expect(section.soulOnChainId).toBe('0xsoul_abc')
      expect(section.timestampKey).toBe(BigInt(1712345678000))
      expect(section.writerAddress).toBe('0xw')
      expect(section.writerKind).toBe('granted-agent')
      expect(section.blobObjectId).toBe('0xblob_entry')
      expect(section.blobId).toBe('entry-blob-id')
      expect(section.createdAtMs).toBe(BigInt(1712345678000))
      expect(section.sealSidecar).toEqual({ version: 1, documentId: '0xmem-doc' })
    }
  })
})

// =========================================================================
// upsertSkillVersionProjection
// =========================================================================
describe('upsertSkillVersionProjection', () => {
  beforeEach(() => vi.resetAllMocks())

  it('calls prisma.soulSkillVersionRecord.upsert with skillsOnChainId + skillName + versionIndex composite key', async () => {
    mockedPrisma.soulSkillVersionRecord.upsert.mockResolvedValue({ id: 'skill-version-1' })

    const { upsertSkillVersionProjection } = await import('../../web/lib/soulidity/mirror/upsert-skill')

    await upsertSkillVersionProjection({
      version: makeSkillVersionObject(),
      soulOnChainId: '0xsoul123',
      skillsOnChainId: '0xskills',
    })

    expect(mockedPrisma.soulSkillVersionRecord.upsert).toHaveBeenCalledOnce()
    const call = mockedPrisma.soulSkillVersionRecord.upsert.mock.calls[0][0]

    expect(call.where).toEqual({
      skillsOnChainId_skillName_versionIndex: {
        skillsOnChainId: '0xskills',
        skillName: 'reporter',
        versionIndex: 1,
      },
    })
  })

  it('maps skillName, versionIndex, visibility, and sidecar fields correctly', async () => {
    mockedPrisma.soulSkillVersionRecord.upsert.mockResolvedValue({ id: 'skill-version-1' })

    const { upsertSkillVersionProjection } = await import('../../web/lib/soulidity/mirror/upsert-skill')

    const version = makeSkillVersionObject({
      skillName: 'planner',
      versionIndex: 3,
      visibility: 'private',
      blobObjectId: '0xskillblob2',
      blobId: 'skill-blob-2',
      createdAtMs: 1711111111000,
    })

    await upsertSkillVersionProjection({
      version,
      soulOnChainId: '0xsoul_xyz',
      skillsOnChainId: '0xskills_abc',
      sealSidecar: { version: 1, documentId: '0xdoc' },
    })

    const call = mockedPrisma.soulSkillVersionRecord.upsert.mock.calls[0][0]
    for (const section of [call.create, call.update]) {
      expect(section.soulOnChainId).toBe('0xsoul_xyz')
      expect(section.skillsOnChainId).toBe('0xskills_abc')
      expect(section.skillName).toBe('planner')
      expect(section.versionIndex).toBe(3)
      expect(section.visibility).toBe('private')
      expect(section.blobObjectId).toBe('0xskillblob2')
      expect(section.blobId).toBe('skill-blob-2')
      expect(section.createdAtMs).toBe(BigInt(1711111111000))
      expect(section.sealSidecar).toEqual({ version: 1, documentId: '0xdoc' })
    }
  })

  it('handles deletedAt undefined vs null correctly', async () => {
    mockedPrisma.soulSkillVersionRecord.upsert.mockResolvedValue({ id: 'skill-version-1' })

    const { upsertSkillVersionProjection } = await import('../../web/lib/soulidity/mirror/upsert-skill')

    // When deletedAt is not provided (undefined), update should pass undefined (skip field)
    await upsertSkillVersionProjection({
      version: makeSkillVersionObject(),
      soulOnChainId: '0xsoul123',
      skillsOnChainId: '0xskills',
      // deletedAt is omitted
    })

    const call1 = mockedPrisma.soulSkillVersionRecord.upsert.mock.calls[0][0]
    expect(call1.update.deletedAt).toBeUndefined()
    // create defaults to null
    expect(call1.create.deletedAt).toBeNull()

    vi.resetAllMocks()
    mockedPrisma.soulSkillVersionRecord.upsert.mockResolvedValue({ id: 'skill-version-1' })

    // When deletedAt is explicitly null, update should pass null (clear field)
    await upsertSkillVersionProjection({
      version: makeSkillVersionObject(),
      soulOnChainId: '0xsoul123',
      skillsOnChainId: '0xskills',
      deletedAt: null,
    })

    const call2 = mockedPrisma.soulSkillVersionRecord.upsert.mock.calls[0][0]
    expect(call2.update.deletedAt).toBeNull()
    expect(call2.create.deletedAt).toBeNull()
  })

  it('passes an explicit deletedAt date', async () => {
    mockedPrisma.soulSkillVersionRecord.upsert.mockResolvedValue({ id: 'skill-version-1' })

    const { upsertSkillVersionProjection } = await import('../../web/lib/soulidity/mirror/upsert-skill')

    const deletedAt = new Date('2026-04-01')
    await upsertSkillVersionProjection({
      version: makeSkillVersionObject(),
      soulOnChainId: '0xsoul123',
      skillsOnChainId: '0xskills',
      deletedAt,
    })

    const call = mockedPrisma.soulSkillVersionRecord.upsert.mock.calls[0][0]
    expect(call.update.deletedAt).toEqual(deletedAt)
    expect(call.create.deletedAt).toEqual(deletedAt)
  })

  it('sealSidecar defaults to undefined when not provided', async () => {
    mockedPrisma.soulSkillVersionRecord.upsert.mockResolvedValue({ id: 'skill-version-1' })

    const { upsertSkillVersionProjection } = await import('../../web/lib/soulidity/mirror/upsert-skill')

    await upsertSkillVersionProjection({
      version: makeSkillVersionObject(),
      soulOnChainId: '0xsoul123',
      skillsOnChainId: '0xskills',
    })

    const call = mockedPrisma.soulSkillVersionRecord.upsert.mock.calls[0][0]
    expect(call.create.sealSidecar).toBeUndefined()
    expect(call.update.sealSidecar).toBeUndefined()
  })
})

// =========================================================================
// markSkillVersionDeleted
// =========================================================================
describe('markSkillVersionDeleted', () => {
  beforeEach(() => vi.resetAllMocks())

  it('calls prisma.soulSkillVersionRecord.updateMany with composite key and deletedAt', async () => {
    mockedPrisma.soulSkillVersionRecord.updateMany.mockResolvedValue({ count: 1 })

    const { markSkillVersionDeleted } = await import('../../web/lib/soulidity/mirror/upsert-skill')

    const deletedAt = new Date('2026-04-02')
    await markSkillVersionDeleted({
      skillsOnChainId: '0xskills',
      skillName: 'planner',
      versionIndex: 3,
      deletedAt,
    })

    expect(mockedPrisma.soulSkillVersionRecord.updateMany).toHaveBeenCalledOnce()
    const call = mockedPrisma.soulSkillVersionRecord.updateMany.mock.calls[0][0]
    expect(call.where).toEqual({
      skillsOnChainId: '0xskills',
      skillName: 'planner',
      versionIndex: 3,
    })
    expect(call.data.deletedAt).toEqual(deletedAt)
  })

  it('defaults deletedAt to current time when not provided', async () => {
    mockedPrisma.soulSkillVersionRecord.updateMany.mockResolvedValue({ count: 1 })

    const { markSkillVersionDeleted } = await import('../../web/lib/soulidity/mirror/upsert-skill')

    const before = new Date()
    await markSkillVersionDeleted({
      skillsOnChainId: '0xskills',
      skillName: 'planner',
      versionIndex: 3,
    })
    const after = new Date()

    const call = mockedPrisma.soulSkillVersionRecord.updateMany.mock.calls[0][0]
    const deletedAt = call.data.deletedAt as Date
    expect(deletedAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
    expect(deletedAt.getTime()).toBeLessThanOrEqual(after.getTime())
  })
})
