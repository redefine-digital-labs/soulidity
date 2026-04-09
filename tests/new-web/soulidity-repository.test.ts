import { describe, expect, it, vi } from 'vitest'

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@web/lib/prisma', () => ({
  prisma: {},
}))

vi.mock('@web/lib/is-uuid', () => ({
  isUuid: (value: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
}))

vi.mock('@web/lib/services/walrus', () => ({
  materializeWalrusBlobUrls: (values: unknown) => {
    if (!Array.isArray(values)) return []
    return values.map((v) => `https://walrus.example/${v}`)
  },
}))

// ── Imports (after mocks) ────────────────────────────────────────────────────

import {
  buildSoulRouteWhere,
  buildCollectionRouteWhere,
  parseRouteObjectId,
  toSoulAssetSummary,
  toSoulCollectionSummary,
  toSoulGrantRecord,
  toSoulMemoryEntryRecord,
  toSoulSkillVersionRecord,
  toSoulAssetDetail,
  toSoulAssetSummaryList,
  toSoulCollectionSummaryList,
  toSoulCollectionDetail,
} from '../../new-web/lib/soulidity/repository'

import {
  serializeSoulPreviewImages,
  serializeSoulPreviewImageList,
} from '../../new-web/lib/soulidity/serialization'

import {
  formatAtomicAmountForDisplay,
  parseDisplayAmountToAtomic,
} from '../../new-web/lib/soulidity/format'

// ── Test data factories ──────────────────────────────────────────────────────

const NOW = new Date('2024-06-15T12:00:00Z')
const LATER = new Date('2024-06-16T12:00:00Z')

function makeDecimal(value: string) {
  return { toString: () => value }
}

function makeSoulAssetRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    onChainId: '0x' + '11'.repeat(32),
    stateOnChainId: '0x' + '22'.repeat(32),
    memoryOnChainId: '0x' + '33'.repeat(32),
    name: 'Test Soul',
    description: 'A test soul',
    imageUrl: 'https://example.com/image.png',
    metadataRef: null,
    contentBlobId: 'blob-123',
    contentBlobObjectId: '0x' + '44'.repeat(32),
    provenanceKind: 'native',
    originRef: null,
    category: 'agents',
    tags: ['test', 'soul'],
    previewImages: ['preview-blob-1'],
    creatorAddress: '0x' + '55'.repeat(32),
    creatorRoyaltyBps: 500,
    currentOwnerAddress: '0x' + '66'.repeat(32),
    currentKioskId: '0x' + '77'.repeat(32),
    currentKioskCapOnChainId: '0x' + '88'.repeat(32),
    listingObjectOnChainId: null,
    listedPriceAtomic: null,
    listingStatus: 'held',
    collectionOnChainId: null,
    grantCapacity: 2,
    activeGrantCount: 0,
    skillsOnChainId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function makeCollectionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1c2c3c4-d5d6-7890-abcd-ef1234567890',
    onChainId: '0x' + 'aa'.repeat(32),
    rightOnChainId: '0x' + 'bb'.repeat(32),
    creatorAddress: '0x' + 'cc'.repeat(32),
    creatorMemberId: 'member-creator-1',
    currentHolderAddress: '0x' + 'dd'.repeat(32),
    currentHolderMemberId: 'member-holder-1',
    currentHolderKioskId: '0x' + 'ee'.repeat(32),
    name: 'Test Collection',
    description: 'A test collection',
    imageUrl: 'https://example.com/col.png',
    extraRoyaltyBps: 200,
    tradeable: true,
    listingObjectOnChainId: null,
    listedPriceAtomic: null,
    listingStatus: 'held',
    soulCount: 3,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function makeGrantRecordRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'grant-uuid-1',
    onChainId: '0x' + 'a1'.repeat(32),
    soulOnChainId: '0x' + '11'.repeat(32),
    issuedByAddress: '0x' + '55'.repeat(32),
    issuedByMemberId: 'member-issuer',
    granteeAddress: '0x' + '99'.repeat(32),
    granteeMemberId: 'member-grantee',
    scopes: ['seal', 'memory'],
    status: 'active',
    expiresAt: LATER,
    endedAt: null,
    replacedByGrantOnChainId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function makeMemoryEntryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mem-uuid-1',
    soulOnChainId: '0x' + '11'.repeat(32),
    memoryOnChainId: '0x' + '33'.repeat(32),
    timestampKey: BigInt(1718452800000),
    writerAddress: '0x' + '55'.repeat(32),
    writerKind: 'founder',
    blobObjectId: '0x' + 'c1'.repeat(32),
    blobId: 'mem-blob-1',
    sealSidecar: null,
    createdAtMs: 1718452800000,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function makeSkillVersionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'skill-uuid-1',
    soulOnChainId: '0x' + '11'.repeat(32),
    skillsOnChainId: '0x' + 'd1'.repeat(32),
    skillName: 'reporter',
    versionIndex: 1,
    visibility: 'public',
    deletedAt: null,
    blobObjectId: '0x' + 'f1'.repeat(32),
    blobId: 'skill-blob-1',
    sealSidecar: null,
    createdAtMs: 1718452800000,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

// ── Tests: parseRouteObjectId ────────────────────────────────────────────────

describe('parseRouteObjectId', () => {
  it('returns null for empty string', () => {
    expect(parseRouteObjectId('')).toBeNull()
    expect(parseRouteObjectId('   ')).toBeNull()
  })

  it('lowercases hex object IDs', () => {
    expect(parseRouteObjectId('0xABCD')).toBe('0xabcd')
  })

  it('passes through non-hex strings as-is', () => {
    expect(parseRouteObjectId('a1b2c3d4-e5f6-7890-abcd-ef1234567890'))
      .toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890')
  })

  it('trims whitespace', () => {
    expect(parseRouteObjectId('  0xABC  ')).toBe('0xabc')
  })
})

// ── Tests: buildSoulRouteWhere ───────────────────────────────────────────────

describe('buildSoulRouteWhere', () => {
  it('returns { id } for UUID input', () => {
    const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    expect(buildSoulRouteWhere(uuid)).toEqual({ id: uuid })
  })

  it('returns OR clause for hex object ID', () => {
    const objectId = '0xABCD1234'
    const result = buildSoulRouteWhere(objectId)
    expect(result).toEqual({
      OR: [
        { onChainId: '0xabcd1234' },
        { stateOnChainId: '0xabcd1234' },
        { memoryOnChainId: '0xabcd1234' },
      ],
    })
  })

  it('returns null for empty string', () => {
    expect(buildSoulRouteWhere('')).toBeNull()
  })

  it('returns null for whitespace-only string', () => {
    expect(buildSoulRouteWhere('   ')).toBeNull()
  })

  it('lowercases the object ID in the OR clause', () => {
    const result = buildSoulRouteWhere('0xAABBCC')
    expect(result).toHaveProperty('OR')
    const orClauses = (result as { OR: Array<Record<string, string>> }).OR
    for (const clause of orClauses) {
      const value = Object.values(clause)[0]
      expect(value).toBe(value.toLowerCase())
    }
  })
})

// ── Tests: buildCollectionRouteWhere ─────────────────────────────────────────

describe('buildCollectionRouteWhere', () => {
  it('returns { id } for UUID input', () => {
    const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    expect(buildCollectionRouteWhere(uuid)).toEqual({ id: uuid })
  })

  it('returns OR clause with onChainId and rightOnChainId for hex', () => {
    const result = buildCollectionRouteWhere('0xDEAD')
    expect(result).toEqual({
      OR: [
        { onChainId: '0xdead' },
        { rightOnChainId: '0xdead' },
      ],
    })
  })

  it('returns null for empty string', () => {
    expect(buildCollectionRouteWhere('')).toBeNull()
  })
})

// ── Tests: toSoulAssetSummary ────────────────────────────────────────────────

describe('toSoulAssetSummary', () => {
  it('transforms a full row with null price', () => {
    const row = makeSoulAssetRow()
    const result = toSoulAssetSummary(row as never)

    expect(result.id).toBe(row.id)
    expect(result.name).toBe('Test Soul')
    expect(result.listedPriceAtomic).toBeNull()
    expect(result.listingStatus).toBe('held')
    expect(result.createdAt).toBe('2024-06-15T12:00:00.000Z')
    expect(result.updatedAt).toBe('2024-06-15T12:00:00.000Z')
    expect(result.tags).toEqual(['test', 'soul'])
    expect(result.previewImages).toEqual(['preview-blob-1'])
    expect(result.provenanceKind).toBe('native')
    expect(result.grantCapacity).toBe(2)
    expect(result.activeGrantCount).toBe(0)
  })

  it('converts Decimal listedPriceAtomic to string', () => {
    const row = makeSoulAssetRow({
      listedPriceAtomic: makeDecimal('5000000'),
      listingStatus: 'listed',
      listingObjectOnChainId: '0x' + 'ff'.repeat(32),
    })
    const result = toSoulAssetSummary(row as never)

    expect(result.listedPriceAtomic).toBe('5000000')
    expect(result.listingStatus).toBe('listed')
    expect(result.listingObjectOnChainId).toBe('0x' + 'ff'.repeat(32))
  })

  it('maps provenanceKind "imported" correctly', () => {
    const row = makeSoulAssetRow({ provenanceKind: 'imported' })
    expect(toSoulAssetSummary(row as never).provenanceKind).toBe('imported')
  })

  it('maps provenanceKind "personal-join" correctly', () => {
    const row = makeSoulAssetRow({ provenanceKind: 'personal-join' })
    expect(toSoulAssetSummary(row as never).provenanceKind).toBe('personal-join')
  })

  it('defaults unknown provenanceKind to "native"', () => {
    const row = makeSoulAssetRow({ provenanceKind: 'unknown-kind' })
    expect(toSoulAssetSummary(row as never).provenanceKind).toBe('native')
  })

  it('defaults unknown listingStatus to "held"', () => {
    const row = makeSoulAssetRow({ listingStatus: 'some-other-status' })
    expect(toSoulAssetSummary(row as never).listingStatus).toBe('held')
  })

  it('preserves all on-chain IDs', () => {
    const row = makeSoulAssetRow()
    const result = toSoulAssetSummary(row as never)

    expect(result.onChainId).toBe(row.onChainId)
    expect(result.stateOnChainId).toBe(row.stateOnChainId)
    expect(result.memoryOnChainId).toBe(row.memoryOnChainId)
    expect(result.currentKioskId).toBe(row.currentKioskId)
    expect(result.currentKioskCapOnChainId).toBe(row.currentKioskCapOnChainId)
  })
})

// ── Tests: toSoulAssetSummaryList ────────────────────────────────────────────

describe('toSoulAssetSummaryList', () => {
  it('maps an array of rows to summaries', () => {
    const rows = [
      makeSoulAssetRow({ name: 'Soul A' }),
      makeSoulAssetRow({ name: 'Soul B', id: 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2' }),
    ]
    const result = toSoulAssetSummaryList(rows as never[])
    expect(result).toHaveLength(2)
    expect(result[0].name).toBe('Soul A')
    expect(result[1].name).toBe('Soul B')
  })

  it('returns empty array for empty input', () => {
    expect(toSoulAssetSummaryList([])).toEqual([])
  })
})

// ── Tests: toSoulCollectionSummary ───────────────────────────────────────────

describe('toSoulCollectionSummary', () => {
  it('transforms a collection row with null price', () => {
    const row = makeCollectionRow()
    const result = toSoulCollectionSummary(row as never)

    expect(result.id).toBe(row.id)
    expect(result.name).toBe('Test Collection')
    expect(result.listedPriceAtomic).toBeNull()
    expect(result.listingStatus).toBe('held')
    expect(result.soulCount).toBe(3)
    expect(result.tradeable).toBe(true)
    expect(result.extraRoyaltyBps).toBe(200)
    expect(result.createdAt).toBe('2024-06-15T12:00:00.000Z')
  })

  it('converts Decimal listedPriceAtomic to string', () => {
    const row = makeCollectionRow({
      listedPriceAtomic: makeDecimal('10000000'),
      listingStatus: 'listed',
    })
    const result = toSoulCollectionSummary(row as never)

    expect(result.listedPriceAtomic).toBe('10000000')
    expect(result.listingStatus).toBe('listed')
  })

  it('preserves creator and holder member IDs', () => {
    const row = makeCollectionRow()
    const result = toSoulCollectionSummary(row as never)

    expect(result.creatorMemberId).toBe('member-creator-1')
    expect(result.currentHolderMemberId).toBe('member-holder-1')
  })
})

// ── Tests: toSoulCollectionSummaryList ───────────────────────────────────────

describe('toSoulCollectionSummaryList', () => {
  it('maps an array of collection rows', () => {
    const rows = [
      makeCollectionRow({ name: 'Col A' }),
      makeCollectionRow({ name: 'Col B' }),
    ]
    const result = toSoulCollectionSummaryList(rows as never[])
    expect(result).toHaveLength(2)
    expect(result[0].name).toBe('Col A')
    expect(result[1].name).toBe('Col B')
  })
})

// ── Tests: toSoulGrantRecord ─────────────────────────────────────────────────

describe('toSoulGrantRecord', () => {
  it('transforms an active grant with expiry', () => {
    const row = makeGrantRecordRow()
    const result = toSoulGrantRecord(row as never)

    expect(result.id).toBe('grant-uuid-1')
    expect(result.status).toBe('active')
    expect(result.scopes).toEqual(['seal', 'memory'])
    expect(result.expiresAt).toBe('2024-06-16T12:00:00.000Z')
    expect(result.endedAt).toBeNull()
    expect(result.createdAt).toBe('2024-06-15T12:00:00.000Z')
  })

  it('maps "revoked" status', () => {
    const row = makeGrantRecordRow({ status: 'revoked', endedAt: LATER })
    const result = toSoulGrantRecord(row as never)
    expect(result.status).toBe('revoked')
    expect(result.endedAt).toBe('2024-06-16T12:00:00.000Z')
  })

  it('maps "expired" status', () => {
    const row = makeGrantRecordRow({ status: 'expired' })
    expect(toSoulGrantRecord(row as never).status).toBe('expired')
  })

  it('maps "superseded" status', () => {
    const row = makeGrantRecordRow({ status: 'superseded', replacedByGrantOnChainId: '0xreplacement' })
    const result = toSoulGrantRecord(row as never)
    expect(result.status).toBe('superseded')
    expect(result.replacedByGrantOnChainId).toBe('0xreplacement')
  })

  it('maps "invalidated" status', () => {
    const row = makeGrantRecordRow({ status: 'invalidated' })
    expect(toSoulGrantRecord(row as never).status).toBe('invalidated')
  })

  it('defaults unknown status to "active"', () => {
    const row = makeGrantRecordRow({ status: 'unknown-status' })
    expect(toSoulGrantRecord(row as never).status).toBe('active')
  })

  it('maps scope strings correctly', () => {
    const row = makeGrantRecordRow({ scopes: ['skills', 'memory', 'seal'] })
    const result = toSoulGrantRecord(row as never)
    expect(result.scopes).toEqual(['skills', 'memory', 'seal'])
  })

  it('defaults unknown scope to "seal"', () => {
    const row = makeGrantRecordRow({ scopes: ['unknown-scope'] })
    const result = toSoulGrantRecord(row as never)
    expect(result.scopes).toEqual(['seal'])
  })

  it('handles null expiresAt', () => {
    const row = makeGrantRecordRow({ expiresAt: null })
    expect(toSoulGrantRecord(row as never).expiresAt).toBeNull()
  })
})

// ── Tests: toSoulMemoryEntryRecord ───────────────────────────────────────────

describe('toSoulMemoryEntryRecord', () => {
  it('transforms a founder memory entry', () => {
    const row = makeMemoryEntryRow()
    const result = toSoulMemoryEntryRecord(row as never)

    expect(result.id).toBe('mem-uuid-1')
    expect(result.writerKind).toBe('founder')
    expect(result.timestampKey).toBe(1718452800000)
    expect(result.blobId).toBe('mem-blob-1')
    expect(result.createdAtMs).toBe(1718452800000)
    expect(result.createdAt).toBe('2024-06-15T12:00:00.000Z')
  })

  it('maps "granted-agent" writerKind', () => {
    const row = makeMemoryEntryRow({ writerKind: 'granted-agent' })
    expect(toSoulMemoryEntryRecord(row as never).writerKind).toBe('granted-agent')
  })

  it('maps "owner" writerKind', () => {
    const row = makeMemoryEntryRow({ writerKind: 'owner' })
    expect(toSoulMemoryEntryRecord(row as never).writerKind).toBe('owner')
  })

  it('defaults unknown writerKind to "owner"', () => {
    const row = makeMemoryEntryRow({ writerKind: 'unknown' })
    expect(toSoulMemoryEntryRecord(row as never).writerKind).toBe('owner')
  })
})

// ── Tests: toSoulSkillVersionRecord ──────────────────────────────────────────

describe('toSoulSkillVersionRecord', () => {
  it('transforms a public skill version', () => {
    const row = makeSkillVersionRow()
    const result = toSoulSkillVersionRecord(row as never)

    expect(result.id).toBe('skill-uuid-1')
    expect(result.skillName).toBe('reporter')
    expect(result.versionIndex).toBe(1)
    expect(result.visibility).toBe('public')
    expect(result.deletedAt).toBeNull()
    expect(result.sealSidecar).toBeNull()
    expect(result.createdAt).toBe('2024-06-15T12:00:00.000Z')
  })

  it('maps "private" visibility', () => {
    const row = makeSkillVersionRow({ visibility: 'private' })
    expect(toSoulSkillVersionRecord(row as never).visibility).toBe('private')
  })

  it('defaults unknown visibility to "private"', () => {
    const row = makeSkillVersionRow({ visibility: 'unknown' })
    expect(toSoulSkillVersionRecord(row as never).visibility).toBe('private')
  })

  it('converts deletedAt to ISO string', () => {
    const row = makeSkillVersionRow({ deletedAt: LATER })
    expect(toSoulSkillVersionRecord(row as never).deletedAt).toBe('2024-06-16T12:00:00.000Z')
  })

  it('preserves sealSidecar when present', () => {
    const sidecar = {
      version: 1,
      mode: 'seal-envelope',
      documentId: '0xdoc',
      encryptedDek: 'abc',
      iv: 'def',
    }
    const row = makeSkillVersionRow({ sealSidecar: sidecar })
    expect(toSoulSkillVersionRecord(row as never).sealSidecar).toEqual(sidecar)
  })

  it('preserves skillName and versionIndex for non-default slots', () => {
    const row = makeSkillVersionRow({ skillName: 'planner', versionIndex: 4 })
    const result = toSoulSkillVersionRecord(row as never)
    expect(result.skillName).toBe('planner')
    expect(result.versionIndex).toBe(4)
  })
})

// ── Tests: toSoulAssetDetail ─────────────────────────────────────────────────

describe('toSoulAssetDetail', () => {
  function makeDetailRow(overrides: Record<string, unknown> = {}) {
    return {
      ...makeSoulAssetRow(),
      creatorMemberId: 'member-creator',
      currentOwnerMemberId: 'member-owner',
      readme: '# Hello\nThis is a soul readme.',
      sealSidecar: null,
      collection: null,
      grantRecords: [],
      memoryEntries: [],
      skillVersions: [],
      ...overrides,
    }
  }

  it('computes isOwner=true when viewerMemberId matches currentOwnerMemberId', () => {
    const row = makeDetailRow()
    const result = toSoulAssetDetail(row as never, {
      viewerMemberId: 'member-owner',
    })
    expect(result.isOwner).toBe(true)
    expect(result.isCreator).toBe(false)
  })

  it('computes isOwner=true when viewerAddresses includes currentOwnerAddress', () => {
    const row = makeDetailRow()
    const result = toSoulAssetDetail(row as never, {
      viewerMemberId: null,
      viewerAddresses: [row.currentOwnerAddress.toUpperCase()],
    })
    expect(result.isOwner).toBe(true)
  })

  it('computes isCreator=true when viewerMemberId matches creatorMemberId', () => {
    const row = makeDetailRow()
    const result = toSoulAssetDetail(row as never, {
      viewerMemberId: 'member-creator',
    })
    expect(result.isCreator).toBe(true)
    expect(result.isOwner).toBe(false)
  })

  it('computes isCreator=true when viewerAddresses includes creatorAddress', () => {
    const row = makeDetailRow()
    const result = toSoulAssetDetail(row as never, {
      viewerMemberId: null,
      viewerAddresses: [row.creatorAddress],
    })
    expect(result.isCreator).toBe(true)
  })

  it('computes isGrantedAgent=true when viewer address matches an active grant', () => {
    const granteeAddress = '0x' + '99'.repeat(32)
    const row = makeDetailRow({
      grantRecords: [makeGrantRecordRow({ granteeAddress })],
    })
    const result = toSoulAssetDetail(row as never, {
      viewerMemberId: null,
      viewerAddresses: [granteeAddress],
    })
    expect(result.isGrantedAgent).toBe(true)
  })

  it('computes isGrantedAgent=false when no matching grant', () => {
    const row = makeDetailRow({
      grantRecords: [makeGrantRecordRow()],
    })
    const result = toSoulAssetDetail(row as never, {
      viewerMemberId: null,
      viewerAddresses: ['0xunrelated'],
    })
    expect(result.isGrantedAgent).toBe(false)
  })

  it('includes nested collection summary when present', () => {
    const row = makeDetailRow({
      collection: makeCollectionRow(),
    })
    const result = toSoulAssetDetail(row as never, { viewerMemberId: null })
    expect(result.collection).not.toBeNull()
    expect(result.collection!.name).toBe('Test Collection')
  })

  it('returns null collection when absent', () => {
    const row = makeDetailRow({ collection: null })
    const result = toSoulAssetDetail(row as never, { viewerMemberId: null })
    expect(result.collection).toBeNull()
  })

  it('transforms nested grantRecords, memoryEntries, and skillVersions', () => {
    const row = makeDetailRow({
      grantRecords: [makeGrantRecordRow()],
      memoryEntries: [makeMemoryEntryRow()],
      skillVersions: [makeSkillVersionRow()],
    })
    const result = toSoulAssetDetail(row as never, { viewerMemberId: null })

    expect(result.activeGrants).toHaveLength(1)
    expect(result.activeGrants[0].status).toBe('active')
    expect(result.memoryEntries).toHaveLength(1)
    expect(result.memoryEntries[0].writerKind).toBe('founder')
    expect(result.skillVersions).toHaveLength(1)
    expect(result.skillVersions[0].visibility).toBe('public')
  })

  it('passes through quote when provided', () => {
    const quote = {
      platformFeeAtomic: '50000',
      priceAtomic: '1000000',
      creatorRoyaltyAtomic: '25000',
      collectionRoyaltyAtomic: '0',
      totalAtomic: '1075000',
    }
    const row = makeDetailRow()
    const result = toSoulAssetDetail(row as never, {
      viewerMemberId: null,
      quote,
    })
    expect(result.quote).toEqual(quote)
  })

  it('defaults quote to null when not provided', () => {
    const row = makeDetailRow()
    const result = toSoulAssetDetail(row as never, { viewerMemberId: null })
    expect(result.quote).toBeNull()
  })

  it('includes readme and sealSidecar', () => {
    const row = makeDetailRow({ readme: '# README' })
    const result = toSoulAssetDetail(row as never, { viewerMemberId: null })
    expect(result.readme).toBe('# README')
    expect(result.sealSidecar).toBeNull()
  })
})

// ── Tests: toSoulCollectionDetail ────────────────────────────────────────────

describe('toSoulCollectionDetail', () => {
  it('includes nested souls as summaries', () => {
    const row = {
      ...makeCollectionRow(),
      souls: [
        makeSoulAssetRow({ name: 'Soul 1' }),
        makeSoulAssetRow({ name: 'Soul 2', id: 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2' }),
      ],
    }
    const result = toSoulCollectionDetail(row as never)

    expect(result.name).toBe('Test Collection')
    expect(result.souls).toHaveLength(2)
    expect(result.souls[0].name).toBe('Soul 1')
    expect(result.souls[1].name).toBe('Soul 2')
  })

  it('returns empty souls array when collection has no souls', () => {
    const row = { ...makeCollectionRow(), souls: [] }
    const result = toSoulCollectionDetail(row as never)
    expect(result.souls).toEqual([])
  })
})

// ── Tests: serialization.ts ──────────────────────────────────────────────────

describe('serializeSoulPreviewImages', () => {
  it('materializes preview image blob IDs to URLs', () => {
    const soul = {
      previewImages: ['blob-a', 'blob-b'],
    }
    const result = serializeSoulPreviewImages(soul)

    expect(result.previewImages).toEqual([
      'https://walrus.example/blob-a',
      'https://walrus.example/blob-b',
    ])
  })

  it('normalizes Decimal listedPriceAtomic to string', () => {
    const soul = {
      previewImages: [],
      listedPriceAtomic: makeDecimal('7500000'),
    }
    const result = serializeSoulPreviewImages(soul)
    expect(result.listedPriceAtomic).toBe('7500000')
  })

  it('normalizes numeric listedPriceAtomic to string', () => {
    const soul = {
      previewImages: [],
      listedPriceAtomic: 123456,
    }
    const result = serializeSoulPreviewImages(soul)
    expect(result.listedPriceAtomic).toBe('123456')
  })

  it('normalizes bigint listedPriceAtomic to string', () => {
    const soul = {
      previewImages: [],
      listedPriceAtomic: 9000000n,
    }
    const result = serializeSoulPreviewImages(soul)
    expect(result.listedPriceAtomic).toBe('9000000')
  })

  it('keeps null listedPriceAtomic as null', () => {
    const soul = {
      previewImages: [],
      listedPriceAtomic: null,
    }
    const result = serializeSoulPreviewImages(soul)
    expect(result.listedPriceAtomic).toBeNull()
  })

  it('preserves other soul properties', () => {
    const soul = {
      previewImages: ['blob-1'],
      name: 'Test',
      id: '123',
    }
    const result = serializeSoulPreviewImages(soul)
    expect(result.name).toBe('Test')
    expect(result.id).toBe('123')
  })
})

describe('serializeSoulPreviewImageList', () => {
  it('maps an array of souls through serializeSoulPreviewImages', () => {
    const souls = [
      { previewImages: ['blob-1'], listedPriceAtomic: makeDecimal('100') },
      { previewImages: ['blob-2'], listedPriceAtomic: null },
    ]
    const result = serializeSoulPreviewImageList(souls)

    expect(result).toHaveLength(2)
    expect(result[0].previewImages).toEqual(['https://walrus.example/blob-1'])
    expect(result[0].listedPriceAtomic).toBe('100')
    expect(result[1].listedPriceAtomic).toBeNull()
  })

  it('returns empty array for empty input', () => {
    expect(serializeSoulPreviewImageList([])).toEqual([])
  })
})

// ── Tests: format.ts ─────────────────────────────────────────────────────────

describe('formatAtomicAmountForDisplay', () => {
  it('formats atomic amount with 6 decimals (default USDC)', () => {
    expect(formatAtomicAmountForDisplay('1000000')).toBe('1 USDC')
  })

  it('formats amount with fractional part', () => {
    expect(formatAtomicAmountForDisplay('1500000')).toBe('1.5 USDC')
  })

  it('formats amount with trailing zeros trimmed', () => {
    expect(formatAtomicAmountForDisplay('1230000')).toBe('1.23 USDC')
  })

  it('formats sub-unit amount (less than 1 whole unit)', () => {
    expect(formatAtomicAmountForDisplay('500000')).toBe('0.5 USDC')
  })

  it('formats zero atomic amount', () => {
    expect(formatAtomicAmountForDisplay('0')).toBe('0 USDC')
  })

  it('formats large atomic amount', () => {
    expect(formatAtomicAmountForDisplay('123456789000000')).toBe('123456789 USDC')
  })

  it('returns "0 USDC" for null', () => {
    expect(formatAtomicAmountForDisplay(null)).toBe('0 USDC')
  })

  it('returns "0 USDC" for undefined', () => {
    expect(formatAtomicAmountForDisplay(undefined)).toBe('0 USDC')
  })

  it('uses custom symbol', () => {
    expect(formatAtomicAmountForDisplay('1000000000', { decimals: 9, symbol: 'SUI' })).toBe('1 SUI')
  })

  it('uses custom decimals', () => {
    expect(formatAtomicAmountForDisplay('100', { decimals: 2 })).toBe('1 USDC')
  })

  it('handles bigint input', () => {
    expect(formatAtomicAmountForDisplay(2000000n)).toBe('2 USDC')
  })

  it('handles number input', () => {
    expect(formatAtomicAmountForDisplay(3000000)).toBe('3 USDC')
  })

  it('formats with full fractional precision when all digits are significant', () => {
    expect(formatAtomicAmountForDisplay('1234567')).toBe('1.234567 USDC')
  })

  it('returns "0 <symbol>" for null with custom symbol', () => {
    expect(formatAtomicAmountForDisplay(null, { symbol: 'SUI' })).toBe('0 SUI')
  })
})

describe('parseDisplayAmountToAtomic', () => {
  it('parses whole number to atomic', () => {
    expect(parseDisplayAmountToAtomic('1')).toBe(1000000n)
  })

  it('parses decimal amount to atomic', () => {
    expect(parseDisplayAmountToAtomic('1.5')).toBe(1500000n)
  })

  it('parses full precision decimal', () => {
    expect(parseDisplayAmountToAtomic('1.234567')).toBe(1234567n)
  })

  it('pads short fractional part with zeros', () => {
    expect(parseDisplayAmountToAtomic('1.23')).toBe(1230000n)
  })

  it('parses zero', () => {
    expect(parseDisplayAmountToAtomic('0')).toBe(0n)
  })

  it('parses large whole number', () => {
    expect(parseDisplayAmountToAtomic('1000000')).toBe(1000000000000n)
  })

  it('trims whitespace', () => {
    expect(parseDisplayAmountToAtomic('  2.5  ')).toBe(2500000n)
  })

  it('uses custom decimals', () => {
    expect(parseDisplayAmountToAtomic('1.5', { decimals: 9 })).toBe(1500000000n)
  })

  it('throws on negative number', () => {
    expect(() => parseDisplayAmountToAtomic('-1')).toThrow('Amount must be a positive number')
  })

  it('throws on non-numeric string', () => {
    expect(() => parseDisplayAmountToAtomic('abc')).toThrow('Amount must be a positive number')
  })

  it('throws on empty string', () => {
    expect(() => parseDisplayAmountToAtomic('')).toThrow('Amount must be a positive number')
  })

  it('throws when fractional part exceeds decimal places', () => {
    expect(() => parseDisplayAmountToAtomic('1.1234567')).toThrow('at most 6 decimal places')
  })

  it('throws when fractional exceeds custom decimal places', () => {
    expect(() => parseDisplayAmountToAtomic('1.12', { decimals: 1 })).toThrow('at most 1 decimal places')
  })

  it('roundtrips with formatAtomicAmountForDisplay', () => {
    const atomic = parseDisplayAmountToAtomic('3.14')
    const display = formatAtomicAmountForDisplay(atomic.toString())
    expect(display).toBe('3.14 USDC')

    const backToAtomic = parseDisplayAmountToAtomic('3.14')
    expect(backToAtomic).toBe(atomic)
  })
})
