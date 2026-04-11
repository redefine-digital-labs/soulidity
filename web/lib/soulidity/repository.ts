import type { Prisma } from '../../../generated/prisma/client'
import { prisma } from '@web/lib/prisma'
import { isUuid } from '@web/lib/is-uuid'
import { toProjectionNumber } from '@/lib/soulidity/projection-scalars'
import { encodeSkillVersionCursor, parseSkillVersionCursor } from '@/lib/soulidity/skill-version-pagination'
import type {
  SoulAssetDetail,
  SoulAssetSummary,
  SoulCollectionAssetDetail,
  SoulCollectionAssetSummary,
  SoulGrantRecord,
  SoulListingStatus,
  SoulMemoryEntryRecord,
  SoulSkillVersionRecord,
  SoulQuoteBreakdown,
} from '@/lib/soulidity/types'

const SOUL_SKILL_VERSION_PREVIEW_LIMIT = 24

function asIso(value: Date) {
  return value.toISOString()
}

function asAtomicString(value: { toString(): string } | null | undefined) {
  return value ? value.toString() : null
}

function asListingStatus(value: string): SoulListingStatus {
  return value === 'listed' ? 'listed' : value === 'floor-violation' ? 'floor-violation' : 'held'
}

export function parseRouteObjectId(id: string) {
  const trimmed = id.trim()
  if (!trimmed) return null
  return trimmed.startsWith('0x') ? trimmed.toLowerCase() : trimmed
}

export function buildSoulRouteWhere(id: string) {
  if (isUuid(id)) {
    return { id }
  }

  const objectId = parseRouteObjectId(id)
  if (!objectId) return null

  return {
    OR: [
      { onChainId: objectId },
      { stateOnChainId: objectId },
      { memoryOnChainId: objectId },
    ],
  } satisfies Prisma.SoulAssetWhereInput
}

export function buildCollectionRouteWhere(id: string) {
  if (isUuid(id)) {
    return { id }
  }

  const objectId = parseRouteObjectId(id)
  if (!objectId) return null

  return {
    OR: [
      { onChainId: objectId },
      { rightOnChainId: objectId },
    ],
  } satisfies Prisma.SoulCollectionAssetWhereInput
}

export const soulAssetSummarySelect = {
  id: true,
  onChainId: true,
  stateOnChainId: true,
  memoryOnChainId: true,
  name: true,
  description: true,
  imageUrl: true,
  metadataRef: true,
  contentBlobId: true,
  contentBlobObjectId: true,
  provenanceKind: true,
  originRef: true,
  category: true,
  tags: true,
  previewImages: true,
  creatorAddress: true,
  creatorRoyaltyBps: true,
  currentOwnerAddress: true,
  currentKioskId: true,
  currentKioskCapOnChainId: true,
  listingObjectOnChainId: true,
  listedPriceAtomic: true,
  listingStatus: true,
  collectionOnChainId: true,
  grantCapacity: true,
  activeGrantCount: true,
  skillsOnChainId: true,
  assetsOnChainId: true,
  accessListOnChainId: true,
  createdAt: true,
  updatedAt: true,
} as const

export const soulGrantRecordSelect = {
  id: true,
  onChainId: true,
  soulOnChainId: true,
  issuedByAddress: true,
  issuedByMemberId: true,
  granteeAddress: true,
  granteeMemberId: true,
  scopes: true,
  status: true,
  expiresAt: true,
  endedAt: true,
  replacedByGrantOnChainId: true,
  createdAt: true,
  updatedAt: true,
} as const

export const soulMemoryEntrySelect = {
  id: true,
  soulOnChainId: true,
  memoryOnChainId: true,
  timestampKey: true,
  writerAddress: true,
  writerKind: true,
  blobObjectId: true,
  blobId: true,
  sealSidecar: true,
  createdAtMs: true,
  createdAt: true,
  updatedAt: true,
} as const

export const soulSkillVersionSelect = {
  id: true,
  soulOnChainId: true,
  skillsOnChainId: true,
  skillName: true,
  versionIndex: true,
  visibility: true,
  deletedAt: true,
  blobObjectId: true,
  blobId: true,
  sealSidecar: true,
  createdAtMs: true,
  createdAt: true,
  updatedAt: true,
} as const

export const soulCollectionSummarySelect = {
  id: true,
  onChainId: true,
  rightOnChainId: true,
  creatorAddress: true,
  creatorMemberId: true,
  currentHolderAddress: true,
  currentHolderMemberId: true,
  currentHolderKioskId: true,
  name: true,
  description: true,
  imageUrl: true,
  extraRoyaltyBps: true,
  floorPriceAtomic: true,
  tradeable: true,
  listingObjectOnChainId: true,
  listedPriceAtomic: true,
  listingStatus: true,
  soulCount: true,
  createdAt: true,
  updatedAt: true,
} as const

export const soulAssetDetailSelect = {
  ...soulAssetSummarySelect,
  creatorMemberId: true,
  currentOwnerMemberId: true,
  readme: true,
  sealSidecar: true,
  collection: {
    select: soulCollectionSummarySelect,
  },
  grantRecords: {
    select: soulGrantRecordSelect,
    where: {
      status: 'active',
    },
    orderBy: {
      createdAt: 'desc',
    },
  },
  memoryEntries: {
    select: soulMemoryEntrySelect,
    orderBy: {
      timestampKey: 'desc',
    },
    take: 20,
  },
  skillVersions: {
    select: soulSkillVersionSelect,
    orderBy: [
      { skillName: 'asc' as const },
      { versionIndex: 'desc' as const },
    ] as Prisma.SoulSkillVersionRecordOrderByWithRelationInput[],
    take: SOUL_SKILL_VERSION_PREVIEW_LIMIT,
  },
  _count: {
    select: {
      skillVersions: true,
    },
  },
} as const

export const soulCollectionDetailSelect = {
  ...soulCollectionSummarySelect,
  souls: {
    select: soulAssetSummarySelect,
    orderBy: {
      createdAt: 'desc',
    },
  },
} as const

type SoulAssetSummaryRecord = Prisma.SoulAssetGetPayload<{ select: typeof soulAssetSummarySelect }>
type SoulGrantRecordRecord = Prisma.SoulGrantRecordGetPayload<{ select: typeof soulGrantRecordSelect }>
type SoulMemoryEntryRecordRow = Prisma.SoulMemoryEntryGetPayload<{ select: typeof soulMemoryEntrySelect }>
type SoulSkillVersionRecordRow = Prisma.SoulSkillVersionRecordGetPayload<{ select: typeof soulSkillVersionSelect }>
type SoulCollectionSummaryRecord = Prisma.SoulCollectionAssetGetPayload<{ select: typeof soulCollectionSummarySelect }>
type SoulAssetDetailRecord = Prisma.SoulAssetGetPayload<{ select: typeof soulAssetDetailSelect }>
type SoulCollectionDetailRecord = Prisma.SoulCollectionAssetGetPayload<{ select: typeof soulCollectionDetailSelect }>

export function toSoulGrantRecord(record: SoulGrantRecordRecord): SoulGrantRecord {
  return {
    id: record.id,
    onChainId: record.onChainId,
    soulOnChainId: record.soulOnChainId,
    issuedByAddress: record.issuedByAddress,
    issuedByMemberId: record.issuedByMemberId,
    granteeAddress: record.granteeAddress,
    granteeMemberId: record.granteeMemberId,
    scopes: record.scopes.map((scope) => scope === 'skills' ? 'skills' : scope === 'memory' ? 'memory' : 'seal'),
    status: record.status === 'revoked'
      ? 'revoked'
      : record.status === 'expired'
        ? 'expired'
        : record.status === 'superseded'
          ? 'superseded'
          : record.status === 'invalidated'
            ? 'invalidated'
            : 'active',
    expiresAt: record.expiresAt ? asIso(record.expiresAt) : null,
    endedAt: record.endedAt ? asIso(record.endedAt) : null,
    replacedByGrantOnChainId: record.replacedByGrantOnChainId,
    createdAt: asIso(record.createdAt),
    updatedAt: asIso(record.updatedAt),
  }
}

export function toSoulMemoryEntryRecord(record: SoulMemoryEntryRecordRow): SoulMemoryEntryRecord {
  return {
    id: record.id,
    soulOnChainId: record.soulOnChainId,
    memoryOnChainId: record.memoryOnChainId,
    timestampKey: toProjectionNumber(record.timestampKey, 'SoulMemoryEntry.timestampKey'),
    writerAddress: record.writerAddress,
    writerKind: record.writerKind === 'founder' ? 'founder' : record.writerKind === 'granted-agent' ? 'granted-agent' : 'owner',
    blobObjectId: record.blobObjectId,
    blobId: record.blobId,
    sealSidecar: (record.sealSidecar ?? null) as SoulMemoryEntryRecord['sealSidecar'],
    createdAtMs: toProjectionNumber(record.createdAtMs, 'SoulMemoryEntry.createdAtMs'),
    createdAt: asIso(record.createdAt),
    updatedAt: asIso(record.updatedAt),
  }
}

export function toSoulSkillVersionRecord(record: SoulSkillVersionRecordRow): SoulSkillVersionRecord {
  return {
    id: record.id,
    soulOnChainId: record.soulOnChainId,
    skillsOnChainId: record.skillsOnChainId,
    skillName: record.skillName,
    versionIndex: record.versionIndex,
    visibility: record.visibility === 'public' ? 'public' : 'private',
    deletedAt: record.deletedAt ? asIso(record.deletedAt) : null,
    blobObjectId: record.blobObjectId,
    blobId: record.blobId,
    sealSidecar: (record.sealSidecar ?? null) as SoulSkillVersionRecord['sealSidecar'],
    createdAtMs: toProjectionNumber(record.createdAtMs, 'SoulSkillVersionRecord.createdAtMs'),
    createdAt: asIso(record.createdAt),
    updatedAt: asIso(record.updatedAt),
  }
}

export function toSoulCollectionSummary(record: SoulCollectionSummaryRecord): SoulCollectionAssetSummary {
  return {
    id: record.id,
    onChainId: record.onChainId,
    rightOnChainId: record.rightOnChainId,
    creatorAddress: record.creatorAddress,
    creatorMemberId: record.creatorMemberId,
    currentHolderAddress: record.currentHolderAddress,
    currentHolderMemberId: record.currentHolderMemberId,
    currentHolderKioskId: record.currentHolderKioskId,
    name: record.name,
    description: record.description,
    imageUrl: record.imageUrl,
    extraRoyaltyBps: record.extraRoyaltyBps,
    floorPriceAtomic: asAtomicString(record.floorPriceAtomic),
    tradeable: record.tradeable,
    listingObjectOnChainId: record.listingObjectOnChainId,
    listedPriceAtomic: asAtomicString(record.listedPriceAtomic),
    listingStatus: asListingStatus(record.listingStatus),
    soulCount: record.soulCount,
    createdAt: asIso(record.createdAt),
    updatedAt: asIso(record.updatedAt),
  }
}

export function toSoulAssetSummaryList(records: SoulAssetSummaryRecord[]): SoulAssetSummary[] {
  return records.map(toSoulAssetSummary)
}

export function toSoulCollectionSummaryList(records: SoulCollectionSummaryRecord[]): SoulCollectionAssetSummary[] {
  return records.map(toSoulCollectionSummary)
}

export function toSoulAssetSummary(record: SoulAssetSummaryRecord): SoulAssetSummary {
  return {
    id: record.id,
    onChainId: record.onChainId,
    stateOnChainId: record.stateOnChainId,
    memoryOnChainId: record.memoryOnChainId,
    name: record.name,
    description: record.description,
    imageUrl: record.imageUrl,
    metadataRef: record.metadataRef,
    contentBlobId: record.contentBlobId,
    contentBlobObjectId: record.contentBlobObjectId,
    provenanceKind: record.provenanceKind === 'imported'
      ? 'imported'
      : record.provenanceKind === 'personal-join'
        ? 'personal-join'
        : 'native',
    originRef: record.originRef,
    category: record.category,
    tags: record.tags,
    previewImages: record.previewImages,
    creatorAddress: record.creatorAddress,
    creatorRoyaltyBps: record.creatorRoyaltyBps,
    currentOwnerAddress: record.currentOwnerAddress,
    currentKioskId: record.currentKioskId,
    currentKioskCapOnChainId: record.currentKioskCapOnChainId,
    listingObjectOnChainId: record.listingObjectOnChainId,
    listedPriceAtomic: asAtomicString(record.listedPriceAtomic),
    listingStatus: asListingStatus(record.listingStatus),
    collectionOnChainId: record.collectionOnChainId,
    grantCapacity: record.grantCapacity,
    activeGrantCount: record.activeGrantCount,
    skillsOnChainId: record.skillsOnChainId,
    assetsOnChainId: record.assetsOnChainId,
    accessListOnChainId: record.accessListOnChainId,
    createdAt: asIso(record.createdAt),
    updatedAt: asIso(record.updatedAt),
  }
}

export function toSoulAssetDetail(
  record: SoulAssetDetailRecord,
  params: {
    viewerMemberId: string | null
    viewerAddresses?: string[]
    quote?: SoulQuoteBreakdown | null
    platformFeeBps?: number | null
  },
): SoulAssetDetail {
  const viewerAddresses = new Set((params.viewerAddresses ?? []).map((value) => value.toLowerCase()))
  const currentOwnerAddress = record.currentOwnerAddress.toLowerCase()
  const creatorAddress = record.creatorAddress.toLowerCase()
  const activeGrants = record.grantRecords.map(toSoulGrantRecord)
  const isOwner = record.currentOwnerMemberId === params.viewerMemberId || viewerAddresses.has(currentOwnerAddress)
  const isCreator = record.creatorMemberId === params.viewerMemberId || viewerAddresses.has(creatorAddress)
  const isGrantedAgent = activeGrants.some((grant) => viewerAddresses.has(grant.granteeAddress.toLowerCase()))

  return {
    ...toSoulAssetSummary(record),
    creatorMemberId: record.creatorMemberId,
    currentOwnerMemberId: record.currentOwnerMemberId,
    readme: record.readme,
    sealSidecar: (record.sealSidecar ?? null) as SoulAssetDetail['sealSidecar'],
    collection: record.collection ? toSoulCollectionSummary(record.collection) : null,
    activeGrants,
    memoryEntries: record.memoryEntries.map(toSoulMemoryEntryRecord),
    skillVersions: record.skillVersions.map(toSoulSkillVersionRecord),
    skillVersionCount: record._count.skillVersions,
    isOwner,
    isCreator,
    isGrantedAgent,
    quote: params.quote ?? null,
    platformFeeBps: params.platformFeeBps ?? null,
  }
}

export function toSoulCollectionDetail(record: SoulCollectionDetailRecord): SoulCollectionAssetDetail {
  return {
    ...toSoulCollectionSummary(record),
    souls: record.souls.map(toSoulAssetSummary),
  }
}

export async function findSoulAssetDetailByRouteId(id: string) {
  const where = buildSoulRouteWhere(id)
  if (!where) return null

  return prisma.soulAsset.findFirst({
    where,
    select: soulAssetDetailSelect,
  })
}

export async function findSoulCollectionDetailByRouteId(id: string) {
  const where = buildCollectionRouteWhere(id)
  if (!where) return null

  return prisma.soulCollectionAsset.findFirst({
    where,
    select: soulCollectionDetailSelect,
  })
}

export async function findSoulSkillVersionsPageByRouteId(params: {
  id: string
  limit: number
  cursor: string | null
}) {
  const where = buildSoulRouteWhere(params.id)
  if (!where) return null

  const soul = await prisma.soulAsset.findFirst({
    where,
    select: {
      onChainId: true,
      skillsOnChainId: true,
      _count: {
        select: {
          skillVersions: true,
        },
      },
    },
  })

  if (!soul) {
    return null
  }

  const cursor = parseSkillVersionCursor(params.cursor)
  const rows = await prisma.soulSkillVersionRecord.findMany({
    where: {
      soulOnChainId: soul.onChainId,
      ...(cursor
        ? {
            OR: [
              { skillName: { gt: cursor.skillName } },
              {
                AND: [
                  { skillName: cursor.skillName },
                  { versionIndex: { lt: cursor.versionIndex } },
                ],
              },
            ],
          }
        : {}),
    },
    select: soulSkillVersionSelect,
    orderBy: [
      { skillName: 'asc' },
      { versionIndex: 'desc' },
    ],
    take: params.limit + 1,
  })

  const pageRows = rows.slice(0, params.limit)
  const nextCursor = rows.length > params.limit
    ? encodeSkillVersionCursor(rows[params.limit - 1]!)
    : null

  return {
    soulOnChainId: soul.onChainId,
    skillsOnChainId: soul.skillsOnChainId,
    items: pageRows.map(toSoulSkillVersionRecord),
    nextCursor,
    total: soul._count.skillVersions,
  }
}
