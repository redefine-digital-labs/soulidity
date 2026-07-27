/**
 * Soulidity Phase 2 repository helpers.
 *
 * Mirrors the unified `SoulContent` typed-content root and the per-Soul
 * `SoulPaidAccessList` shared object. All legacy memory / skills / assets /
 * metadata / content-access projections have been hard-cut from Prisma —
 * `repository.ts` therefore exposes a single `SoulContentVersionRecord` view
 * plus the new paid-access mirrors.
 *
 * Naming pipeline reminders:
 * - Move `SoulCollection.{max_supply,current_supply}` ↔ Prisma
 *   `SoulCollectionAsset.{maxSoulSupply,soulCount}` ↔ API
 *   `{maxSoulSupply,currentSoulSupply}`. `soulCount` is preserved as a legacy
 *   alias of `currentSoulSupply`, NOT a separate truth.
 * - Active sprite/voice fields cache `SoulContent.active_table[kind]` and are
 *   mirror-only; access decisions must read the canonical slot from
 *   `SoulContentVersionRecord`.
 */
import type { Prisma } from '@db/prisma-client'
import { prisma } from '@/lib/prisma'
import { isUuid } from '@/lib/is-uuid'
import { toProjectionNumber } from '@soulidity/sdk'
import {
  clampContentVersionPageSize,
  decodeContentVersionCursor,
  encodeContentVersionCursor,
} from '@soulidity/sdk'
import {
  KIND_AUDIO,
  KIND_MEMORY,
  KIND_SKILL,
  KIND_SOUL_DOC,
  KIND_SPRITE,
  downloadPolicyFromU8,
} from '@soulidity/sdk'
import { parseSealEnvelopeSidecar } from '@/lib/services/seal-crypto'
import type {
  ContentReadMode,
  SoulAssetDetail,
  SoulAssetSummary,
  SoulCollectionAssetDetail,
  SoulCollectionAssetSummary,
  SoulContentVersionRecord,
  SoulDownloadPolicy,
  SoulGrantRecord,
  SoulGrantScope,
  SoulListingStatus,
  SoulPaidAccessEntryRecord,
  SoulPaidAccessKindConfigRecord,
  SoulPersonaKind,
  SoulProvenanceKind,
  SoulQuoteBreakdown,
} from '@soulidity/sdk'

// ── Constants ─────────────────────────────────────────────────────────────

/**
 * Soul detail preview window per kind. Full pagination uses
 * `findContentVersionsByKind` / `paginateSoulContentVersions`.
 */
const CONTENT_PREVIEW_PER_KIND = 24

// ── Scalar / enum helpers ────────────────────────────────────────────────

function asIso(value: Date) {
  return value.toISOString()
}

function asAtomicString(value: { toString(): string } | null | undefined) {
  return value ? value.toString() : null
}

function asListingStatus(value: string): SoulListingStatus {
  return value === 'listed' ? 'listed' : value === 'floor-violation' ? 'floor-violation' : 'held'
}

function asProvenanceKind(value: string): SoulProvenanceKind {
  if (value === 'imported') return 'imported'
  if (value === 'personal-join') return 'personal-join'
  if (value === 'animacraft') return 'animacraft'
  return 'native'
}

function asPersonaKind(value: string): SoulPersonaKind {
  return value === 'trainers' ? 'trainers' : 'characters'
}

function asDownloadPolicyOrNull(value: string | null | undefined): SoulDownloadPolicy | null {
  if (value === 'public' || value === 'owner_only' || value === 'allowlist') return value
  return null
}

function safeDownloadPolicyFromU8(value: number): SoulDownloadPolicy {
  try {
    return downloadPolicyFromU8(value)
  } catch {
    // Fallback for forward-compat: any unknown value is treated as the most
    // restrictive policy so callers fail closed.
    return 'owner_only'
  }
}

function safeParseSealSidecar(
  value: Prisma.JsonValue | null | undefined,
  context: { kind: number; name: string; versionIndex: number; soulOnChainId: string },
): SoulContentVersionRecord['sealSidecar'] {
  if (value == null) return null
  try {
    return parseSealEnvelopeSidecar(value)
  } catch (error) {
    console.warn('[soulidity-repository] Failed to parse Seal sidecar — falling back to null', {
      ...context,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

function bigIntToAtomicString(value: bigint | null | undefined): string | null {
  if (value == null) return null
  return value.toString()
}

// ── Route-id helpers ─────────────────────────────────────────────────────

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
      { contentOnChainId: objectId },
      { paidAccessListOnChainId: objectId },
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

// ── Prisma `select` shapes ───────────────────────────────────────────────

export const soulAssetSummarySelect = {
  id: true,
  onChainId: true,
  stateOnChainId: true,
  contentOnChainId: true,
  paidAccessListOnChainId: true,
  name: true,
  description: true,
  imageUrl: true,
  activeSpriteName: true,
  activeSpriteVersionIndex: true,
  activeSpriteDownloadPolicy: true,
  activeVoiceName: true,
  activeVoiceVersionIndex: true,
  activeVoiceDownloadPolicy: true,
  spriteConfigJson: true,
  voiceConfigJson: true,
  provenanceKind: true,
  personaKind: true,
  originRef: true,
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

export const soulContentVersionSelect = {
  id: true,
  soulOnChainId: true,
  contentOnChainId: true,
  kind: true,
  kindName: true,
  name: true,
  versionIndex: true,
  blobObjectId: true,
  blobId: true,
  readModeMask: true,
  opMask: true,
  grantScopeMask: true,
  isPublic: true,
  sealEncrypted: true,
  downloadPolicy: true,
  sealSidecar: true,
  deletedAt: true,
  purgedAt: true,
  createdAtMs: true,
  createdAt: true,
  updatedAt: true,
} as const

export const soulPaidAccessKindConfigSelect = {
  id: true,
  soulOnChainId: true,
  paidAccessListOnChainId: true,
  kind: true,
  version: true,
  priceAtomic: true,
  scopeMask: true,
  durationMs: true,
  ownershipEpochSnapshot: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} as const

export const soulPaidAccessEntrySelect = {
  id: true,
  soulOnChainId: true,
  paidAccessListOnChainId: true,
  buyerAddress: true,
  kind: true,
  version: true,
  scopeMask: true,
  pricePaidAtomic: true,
  expiresAtMs: true,
  ownershipEpochSnapshot: true,
  revokedAt: true,
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
  maxSoulSupply: true,
  createdAt: true,
  updatedAt: true,
} as const

export const soulAssetDetailSelect = {
  ...soulAssetSummarySelect,
  creatorMemberId: true,
  currentOwnerMemberId: true,
  readme: true,
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
  /**
   * Detail-route preview of `soul_content_version_records`. Per kind we keep
   * the latest `CONTENT_PREVIEW_PER_KIND` (24) rows ordered by createdAtMs
   * desc. Full pagination is served by `findContentVersionsByKind` (or the
   * dedicated `/api/souls/[id]/content` endpoints). Soft-deleted rows are
   * retained — surfaces decide whether to filter on `deletedAt` / `purgedAt`.
   */
  contentVersions: {
    select: soulContentVersionSelect,
    orderBy: [
      { kind: 'asc' as const },
      { name: 'asc' as const },
      { versionIndex: 'desc' as const },
    ] as Prisma.SoulContentVersionRecordOrderByWithRelationInput[],
  },
  paidAccessKindConfigs: {
    select: soulPaidAccessKindConfigSelect,
    orderBy: [
      { kind: 'asc' as const },
      { version: 'desc' as const },
    ] as Prisma.SoulPaidAccessKindConfigOrderByWithRelationInput[],
  },
  paidAccessEntries: {
    select: soulPaidAccessEntrySelect,
    orderBy: { createdAtMs: 'desc' as const },
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

// ── Prisma payload types ─────────────────────────────────────────────────

type SoulAssetSummaryRecord = Prisma.SoulAssetGetPayload<{
  select: typeof soulAssetSummarySelect
}>
type SoulGrantRecordRow = Prisma.SoulGrantRecordGetPayload<{
  select: typeof soulGrantRecordSelect
}>
type SoulContentVersionRow = Prisma.SoulContentVersionRecordGetPayload<{
  select: typeof soulContentVersionSelect
}>
type SoulPaidAccessKindConfigRow = Prisma.SoulPaidAccessKindConfigGetPayload<{
  select: typeof soulPaidAccessKindConfigSelect
}>
type SoulPaidAccessEntryRow = Prisma.SoulPaidAccessEntryGetPayload<{
  select: typeof soulPaidAccessEntrySelect
}>
type SoulCollectionSummaryRecord = Prisma.SoulCollectionAssetGetPayload<{
  select: typeof soulCollectionSummarySelect
}>
type SoulAssetDetailRecord = Prisma.SoulAssetGetPayload<{
  select: typeof soulAssetDetailSelect
}>
type SoulCollectionDetailRecord = Prisma.SoulCollectionAssetGetPayload<{
  select: typeof soulCollectionDetailSelect
}>

// ── Mappers: simple records ──────────────────────────────────────────────

export function toSoulGrantScopes(scopes: string[]): SoulGrantScope[] {
  return scopes.filter((scope): scope is SoulGrantScope =>
    scope === 'seal' || scope === 'memory' || scope === 'skills' || scope === 'assets',
  )
}

export function toSoulGrantRecord(record: SoulGrantRecordRow): SoulGrantRecord {
  return {
    id: record.id,
    onChainId: record.onChainId,
    soulOnChainId: record.soulOnChainId,
    issuedByAddress: record.issuedByAddress,
    issuedByMemberId: record.issuedByMemberId,
    granteeAddress: record.granteeAddress,
    granteeMemberId: record.granteeMemberId,
    scopes: toSoulGrantScopes(record.scopes),
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

export function toSoulContentVersionRecord(row: SoulContentVersionRow): SoulContentVersionRecord {
  return {
    id: row.id,
    soulOnChainId: row.soulOnChainId,
    contentOnChainId: row.contentOnChainId,
    kind: row.kind,
    kindName: row.kindName,
    name: row.name,
    versionIndex: row.versionIndex,
    blobObjectId: row.blobObjectId,
    blobId: row.blobId,
    readModeMask: row.readModeMask,
    opMask: row.opMask,
    grantScopeMask: row.grantScopeMask,
    isPublic: row.isPublic,
    sealEncrypted: row.sealEncrypted,
    downloadPolicy: safeDownloadPolicyFromU8(row.downloadPolicy),
    sealSidecar: safeParseSealSidecar(row.sealSidecar, {
      kind: row.kind,
      name: row.name,
      versionIndex: row.versionIndex,
      soulOnChainId: row.soulOnChainId,
    }),
    deletedAt: row.deletedAt ? asIso(row.deletedAt) : null,
    purgedAt: row.purgedAt ? asIso(row.purgedAt) : null,
    createdAtMs: toProjectionNumber(row.createdAtMs, 'SoulContentVersionRecord.createdAtMs'),
    createdAt: asIso(row.createdAt),
    updatedAt: asIso(row.updatedAt),
  }
}

export function toSoulPaidAccessKindConfigRecord(
  row: SoulPaidAccessKindConfigRow,
): SoulPaidAccessKindConfigRecord {
  return {
    id: row.id,
    soulOnChainId: row.soulOnChainId,
    paidAccessListOnChainId: row.paidAccessListOnChainId,
    kind: row.kind,
    version: row.version,
    priceAtomic: row.priceAtomic.toString(),
    scopeMask: row.scopeMask,
    durationMs: bigIntToAtomicString(row.durationMs),
    ownershipEpochSnapshot: row.ownershipEpochSnapshot,
    deletedAt: row.deletedAt ? asIso(row.deletedAt) : null,
    createdAt: asIso(row.createdAt),
    updatedAt: asIso(row.updatedAt),
  }
}

export function toSoulPaidAccessEntryRecord(
  row: SoulPaidAccessEntryRow,
): SoulPaidAccessEntryRecord {
  return {
    id: row.id,
    soulOnChainId: row.soulOnChainId,
    paidAccessListOnChainId: row.paidAccessListOnChainId,
    buyerAddress: row.buyerAddress,
    kind: row.kind,
    version: row.version,
    scopeMask: row.scopeMask,
    pricePaidAtomic: row.pricePaidAtomic.toString(),
    expiresAtMs: bigIntToAtomicString(row.expiresAtMs),
    ownershipEpochSnapshot: row.ownershipEpochSnapshot,
    revokedAt: row.revokedAt ? asIso(row.revokedAt) : null,
    createdAtMs: toProjectionNumber(row.createdAtMs, 'SoulPaidAccessEntry.createdAtMs'),
    createdAt: asIso(row.createdAt),
    updatedAt: asIso(row.updatedAt),
  }
}

// ── Mappers: collection / asset summary ──────────────────────────────────

export function toSoulCollectionSummary(
  record: SoulCollectionSummaryRecord,
): SoulCollectionAssetSummary {
  // Naming pipeline: Move `max_supply / current_supply` ↔ Prisma
  // `maxSoulSupply / soulCount` ↔ API `maxSoulSupply / currentSoulSupply`.
  // soulCount is preserved as a legacy alias of currentSoulSupply, NOT a
  // separate truth.
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
    currentSoulSupply: record.soulCount,
    maxSoulSupply: record.maxSoulSupply == null ? null : record.maxSoulSupply.toString(),
    createdAt: asIso(record.createdAt),
    updatedAt: asIso(record.updatedAt),
  }
}

export function toSoulAssetSummary(record: SoulAssetSummaryRecord): SoulAssetSummary {
  return {
    id: record.id,
    onChainId: record.onChainId,
    stateOnChainId: record.stateOnChainId,
    contentOnChainId: record.contentOnChainId,
    paidAccessListOnChainId: record.paidAccessListOnChainId,
    name: record.name,
    description: record.description,
    imageUrl: record.imageUrl,
    activeSpriteName: record.activeSpriteName,
    activeSpriteVersionIndex: record.activeSpriteVersionIndex == null
      ? null
      : toProjectionNumber(
          record.activeSpriteVersionIndex,
          'SoulAsset.activeSpriteVersionIndex',
        ),
    activeSpriteDownloadPolicy: asDownloadPolicyOrNull(record.activeSpriteDownloadPolicy),
    activeVoiceName: record.activeVoiceName,
    activeVoiceVersionIndex: record.activeVoiceVersionIndex == null
      ? null
      : toProjectionNumber(
          record.activeVoiceVersionIndex,
          'SoulAsset.activeVoiceVersionIndex',
        ),
    activeVoiceDownloadPolicy: asDownloadPolicyOrNull(record.activeVoiceDownloadPolicy),
    spriteConfigJson: record.spriteConfigJson,
    voiceConfigJson: record.voiceConfigJson,
    provenanceKind: asProvenanceKind(record.provenanceKind),
    personaKind: asPersonaKind(record.personaKind),
    originRef: record.originRef,
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
    createdAt: asIso(record.createdAt),
    updatedAt: asIso(record.updatedAt),
  }
}

export function toSoulAssetSummaryList(records: SoulAssetSummaryRecord[]): SoulAssetSummary[] {
  return records.map(toSoulAssetSummary)
}

export function toSoulCollectionSummaryList(
  records: SoulCollectionSummaryRecord[],
): SoulCollectionAssetSummary[] {
  return records.map(toSoulCollectionSummary)
}

// ── Detail mapper helpers ────────────────────────────────────────────────

/**
 * Trim the `soul_content_version_records` preview window to a sane subset:
 *   - SOUL_DOC: latest CANONICAL slot only (versionIndex desc) — keeps the
 *     newest revision plus the seed v0.
 *   - MEMORY: latest CANONICAL slot, capped to `CONTENT_PREVIEW_PER_KIND`.
 *   - SKILL: per skill name, top `CONTENT_PREVIEW_PER_KIND` versions.
 *   - SPRITE / AUDIO: per name, top `CONTENT_PREVIEW_PER_KIND` versions.
 *   - Custom kinds: per name, top `CONTENT_PREVIEW_PER_KIND` versions.
 *
 * The detail select already orders by (kind asc, name asc, versionIndex desc);
 * this function applies the per-(kind,name) cap in TS.
 */
function trimContentPreview(rows: SoulContentVersionRow[]): SoulContentVersionRow[] {
  const counters = new Map<string, number>()
  const out: SoulContentVersionRow[] = []
  for (const row of rows) {
    const key = `${row.kind}::${row.name}`
    const seen = counters.get(key) ?? 0
    if (seen >= CONTENT_PREVIEW_PER_KIND) continue
    counters.set(key, seen + 1)
    out.push(row)
  }
  return out
}

function filterPaidEntriesForViewer(
  rows: SoulPaidAccessEntryRow[],
  viewerAddresses: Set<string>,
  isOwner: boolean,
): SoulPaidAccessEntryRow[] {
  // Owner sees every entry (active + revoked) for management / audit.
  // Non-owners — including the creator after sale and anonymous callers —
  // only see entries whose buyer address matches one of their wallets.
  // SoulPaidAccessList is public on-chain, but exposing the full buyer list
  // via the mirror would leak who else purchased; this filter is the UI/API
  // privacy seam.
  if (isOwner) return rows
  if (viewerAddresses.size === 0) return []
  return rows.filter((row) => viewerAddresses.has(row.buyerAddress.toLowerCase()))
}

// ── Detail mappers ───────────────────────────────────────────────────────

export function toSoulAssetDetail(
  record: SoulAssetDetailRecord,
  params: {
    viewerMemberId: string | null
    viewerAddresses?: string[]
    currentOwnershipEpoch?: number | null
    quote?: SoulQuoteBreakdown | null
    platformFeeBps?: number | null
    animacraftProvenance?: SoulAssetDetail['animacraftProvenance']
  },
): SoulAssetDetail {
  const viewerAddresses = new Set(
    (params.viewerAddresses ?? []).map((value) => value.toLowerCase()),
  )
  const currentOwnerAddress = record.currentOwnerAddress.toLowerCase()
  const creatorAddress = record.creatorAddress.toLowerCase()
  const activeGrants = record.grantRecords.map(toSoulGrantRecord)
  const isOwner =
    record.currentOwnerMemberId === params.viewerMemberId
    || viewerAddresses.has(currentOwnerAddress)
  const isCreator =
    record.creatorMemberId === params.viewerMemberId
    || viewerAddresses.has(creatorAddress)
  const isGrantedAgent = activeGrants.some((grant) =>
    viewerAddresses.has(grant.granteeAddress.toLowerCase()),
  )

  const contentVersions = trimContentPreview(record.contentVersions).map(
    toSoulContentVersionRecord,
  )
  const paidAccessKindConfigs = record.paidAccessKindConfigs.map(
    toSoulPaidAccessKindConfigRecord,
  )
  const paidAccessEntries = filterPaidEntriesForViewer(
    record.paidAccessEntries,
    viewerAddresses,
    isOwner,
  ).map(toSoulPaidAccessEntryRecord)

  return {
    ...toSoulAssetSummary(record),
    creatorMemberId: record.creatorMemberId,
    currentOwnerMemberId: record.currentOwnerMemberId,
    currentOwnershipEpoch: params.currentOwnershipEpoch ?? null,
    readme: record.readme,
    collection: record.collection ? toSoulCollectionSummary(record.collection) : null,
    activeGrants,
    contentVersions,
    paidAccessKindConfigs,
    paidAccessEntries,
    isOwner,
    isCreator,
    isGrantedAgent,
    quote: params.quote ?? null,
    platformFeeBps: params.platformFeeBps ?? null,
    animacraftProvenance: params.animacraftProvenance ?? null,
  }
}

export function toSoulCollectionDetail(
  record: SoulCollectionDetailRecord,
): SoulCollectionAssetDetail {
  return {
    ...toSoulCollectionSummary(record),
    souls: record.souls.map(toSoulAssetSummary),
  }
}

// ── Lookups ──────────────────────────────────────────────────────────────

export async function findSoulAssetByRouteId(id: string) {
  const where = buildSoulRouteWhere(id)
  if (!where) return null

  return prisma.soulAsset.findFirst({
    where,
    select: soulAssetSummarySelect,
  })
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

/**
 * Lookup all Soul summaries owned by an address. Returns the canonical
 * `SoulAssetSummary` shape so callers can paginate / filter further.
 */
export async function findSoulAssetSummariesByOwner(
  ownerAddress: string,
  options: { listingStatus?: SoulListingStatus; limit?: number; cursor?: string | null } = {},
): Promise<{ items: SoulAssetSummary[]; nextCursor: string | null }> {
  const limit = options.limit && options.limit > 0 ? Math.min(options.limit, 100) : 50

  const rows = await prisma.soulAsset.findMany({
    where: {
      currentOwnerAddress: ownerAddress.toLowerCase(),
      ...(options.listingStatus ? { listingStatus: options.listingStatus } : {}),
    },
    select: soulAssetSummarySelect,
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  })

  const pageRows = rows.slice(0, limit)
  const nextCursor = rows.length > limit ? rows[limit - 1]!.id : null
  return {
    items: pageRows.map(toSoulAssetSummary),
    nextCursor,
  }
}

/**
 * Generic Soul summary pagination. Accepts an arbitrary
 * `Prisma.SoulAssetWhereInput` so callers (search, agent, marketplace) can
 * compose their own filter without re-implementing the select / mapper.
 */
export async function paginateSoulAssetSummaries(params: {
  where: Prisma.SoulAssetWhereInput
  orderBy?: Prisma.SoulAssetOrderByWithRelationInput | Prisma.SoulAssetOrderByWithRelationInput[]
  limit: number
  cursor?: string | null
}): Promise<{ items: SoulAssetSummary[]; nextCursor: string | null; total: number }> {
  const limit = Math.max(1, Math.min(params.limit, 200))

  const [rows, total] = await Promise.all([
    prisma.soulAsset.findMany({
      where: params.where,
      orderBy: params.orderBy ?? { createdAt: 'desc' },
      select: soulAssetSummarySelect,
      take: limit + 1,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
    }),
    prisma.soulAsset.count({ where: params.where }),
  ])

  const pageRows = rows.slice(0, limit)
  const nextCursor = rows.length > limit ? rows[limit - 1]!.id : null
  return {
    items: pageRows.map(toSoulAssetSummary),
    nextCursor,
    total,
  }
}

// ── Content-version helpers ──────────────────────────────────────────────

export interface FindContentVersionsByKindOptions {
  /** Optional slot name filter (`'soul'`, `'default'`, a skill name, etc.). */
  name?: string | null
  /**
   * When true, soft-deleted (`deletedAt != null`) and purged
   * (`purgedAt != null`) rows are excluded. Default `false`: callers
   * receive every projection so they can audit history.
   */
  excludeDeleted?: boolean
  /** Page size (default = `DEFAULT_CONTENT_VERSION_PAGE_SIZE`). */
  limit?: number | null
  /** Cursor encoded by `encodeContentVersionCursor`. */
  cursor?: string | null
}

export interface FindContentVersionsByKindResult {
  soulOnChainId: string
  contentOnChainId: string | null
  kind: number
  name: string | null
  items: SoulContentVersionRecord[]
  nextCursor: string | null
  total: number
}

/**
 * Paginate `soul_content_version_records` for a single (Soul, kind) pair.
 * Replaces the legacy `findSoulSkillVersionsPageByRouteId` — this works for
 * any kind (SOUL_DOC, MEMORY, SKILL, SPRITE, AUDIO, custom).
 *
 * Ordering: `(name asc, versionIndex desc)` so the cursor advances to the
 * next `(name, versionIndex)` lexicographically. When `options.name` is set,
 * the result is a single skill / slot's version history.
 */
export async function findContentVersionsByKind(
  soulOnChainId: string,
  kind: number,
  options: FindContentVersionsByKindOptions = {},
): Promise<FindContentVersionsByKindResult | null> {
  const soul = await prisma.soulAsset.findUnique({
    where: { onChainId: soulOnChainId },
    select: { onChainId: true, contentOnChainId: true },
  })
  if (!soul) return null

  const limit = clampContentVersionPageSize(options.limit ?? null)
  const cursor = decodeContentVersionCursor(options.cursor ?? null)

  const baseWhere: Prisma.SoulContentVersionRecordWhereInput = {
    soulOnChainId: soul.onChainId,
    kind,
    ...(options.name ? { name: options.name } : {}),
    ...(options.excludeDeleted ? { deletedAt: null, purgedAt: null } : {}),
  }

  const cursorWhere: Prisma.SoulContentVersionRecordWhereInput = cursor
    ? {
        OR: [
          { name: { gt: cursor.name } },
          {
            AND: [
              { name: cursor.name },
              { versionIndex: { lt: cursor.versionIndex } },
            ],
          },
        ],
      }
    : {}

  const where: Prisma.SoulContentVersionRecordWhereInput = cursor
    ? { AND: [baseWhere, cursorWhere] }
    : baseWhere

  const [rows, total] = await Promise.all([
    prisma.soulContentVersionRecord.findMany({
      where,
      select: soulContentVersionSelect,
      orderBy: [
        { name: 'asc' },
        { versionIndex: 'desc' },
      ],
      take: limit + 1,
    }),
    prisma.soulContentVersionRecord.count({ where: baseWhere }),
  ])

  const pageRows = rows.slice(0, limit)
  const nextCursor =
    rows.length > limit
      ? encodeContentVersionCursor({
          name: rows[limit - 1]!.name,
          versionIndex: rows[limit - 1]!.versionIndex,
        })
      : null

  return {
    soulOnChainId: soul.onChainId,
    contentOnChainId: soul.contentOnChainId,
    kind,
    name: options.name ?? null,
    items: pageRows.map(toSoulContentVersionRecord),
    nextCursor,
    total,
  }
}

/**
 * Convenience wrapper that resolves the Soul by route id (uuid / on-chain id /
 * content id / paid-access list id) before delegating to
 * `findContentVersionsByKind`.
 */
export async function findContentVersionsByRouteId(
  routeId: string,
  kind: number,
  options: FindContentVersionsByKindOptions = {},
): Promise<FindContentVersionsByKindResult | null> {
  const where = buildSoulRouteWhere(routeId)
  if (!where) return null

  const soul = await prisma.soulAsset.findFirst({
    where,
    select: { onChainId: true },
  })
  if (!soul) return null

  return findContentVersionsByKind(soul.onChainId, kind, options)
}

export async function findContentVersionByRouteId(
  routeId: string,
  kind: number,
  name: string,
  versionIndex: number,
): Promise<SoulContentVersionRecord | null> {
  const where = buildSoulRouteWhere(routeId)
  if (!where) return null

  const soul = await prisma.soulAsset.findFirst({
    where,
    select: { onChainId: true, contentOnChainId: true },
  })
  if (!soul?.contentOnChainId) return null

  const row = await prisma.soulContentVersionRecord.findUnique({
    where: {
      contentOnChainId_kind_name_versionIndex: {
        contentOnChainId: soul.contentOnChainId,
        kind,
        name,
        versionIndex,
      },
    },
    select: soulContentVersionSelect,
  })

  return row ? toSoulContentVersionRecord(row) : null
}

// ── Deprecated phase-1 shims ─────────────────────────────────────────────

/**
 * @deprecated Phase-1 helper preserved for callers that still pass
 * `findSoulSkillVersionsPageByRouteId`. Translates the request to the new
 * `findContentVersionsByKind(soulOnChainId, KIND_SKILL)` query so existing
 * `/api/souls/[id]/skill-versions` consumers keep working until they migrate
 * to the unified content endpoints.
 */
export async function findSoulSkillVersionsPageByRouteId(params: {
  id: string
  limit: number
  cursor: string | null
}) {
  const result = await findContentVersionsByRouteId(params.id, KIND_SKILL, {
    limit: params.limit,
    cursor: params.cursor,
  })
  if (!result) return null

  return {
    soulOnChainId: result.soulOnChainId,
    /**
     * Phase 2 collapses the per-kind shared object into one `SoulContent`
     * root. The legacy field name is preserved for compatibility — readers
     * should treat this as `contentOnChainId`.
     */
    skillsOnChainId: result.contentOnChainId,
    items: result.items,
    nextCursor: result.nextCursor,
    total: result.total,
  }
}

// ── Re-exports kept for callers ──────────────────────────────────────────

export {
  CONTENT_PREVIEW_PER_KIND,
  KIND_AUDIO,
  KIND_MEMORY,
  KIND_SKILL,
  KIND_SOUL_DOC,
  KIND_SPRITE,
}

export type { ContentReadMode }
