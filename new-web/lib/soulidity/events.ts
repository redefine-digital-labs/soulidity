import type {
  CollectionListingObject,
  SoulCollectionObject,
  SoulGrantObject,
  SoulGrantScope,
  SoulListingObject,
  SoulMemoryObject,
} from '@/lib/soulidity/types'
import { OnChainVerificationError, getTrustedPackageIds, normalizeSuiValue, scopeMaskToScopes } from '@/lib/soulidity/queries'

type TransactionLike = {
  events?: Array<{ type?: unknown; parsedJson?: unknown }> | null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function readAddress(value: unknown, fieldName: string) {
  if (typeof value === 'string') {
    const normalized = normalizeSuiValue(value)
    if (normalized) return normalized
  }
  throw new OnChainVerificationError(`${fieldName} is malformed on chain`)
}

function readObjectId(value: unknown, fieldName: string) {
  const record = asRecord(value)
  if (record && typeof record.id === 'string') {
    return readAddress(record.id, fieldName)
  }
  return readAddress(value, fieldName)
}

function readOptionalObjectId(value: unknown, fieldName: string): string | null {
  if (value == null) return null
  if (Array.isArray(value)) {
    if (value.length === 0) return null
    return readOptionalObjectId(value[0], fieldName)
  }
  const record = asRecord(value)
  if (!record) {
    return typeof value === 'string' ? readObjectId(value, fieldName) : null
  }
  if (Array.isArray(record.vec)) {
    return readOptionalObjectId(record.vec, fieldName)
  }
  if (record.value) {
    return readOptionalObjectId(record.value, fieldName)
  }
  if (record.fields) {
    return readOptionalObjectId(record.fields, fieldName)
  }
  if (typeof record.id === 'string') {
    return readObjectId(record.id, fieldName)
  }
  return null
}

function readBigInt(value: unknown, fieldName: string) {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number' && Number.isFinite(value)) {
    return BigInt(Math.trunc(value))
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return BigInt(value.trim())
  }
  throw new OnChainVerificationError(`${fieldName} is missing on chain`)
}

function readNumber(value: unknown, fieldName: string) {
  const parsed = readBigInt(value, fieldName)
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new OnChainVerificationError(`${fieldName} exceeds the supported range on chain`)
  }
  return Number(parsed)
}

function readOptionalNumber(value: unknown, fieldName: string): number | null {
  if (value == null) return null
  if (Array.isArray(value)) {
    if (value.length === 0) return null
    return readOptionalNumber(value[0], fieldName)
  }
  const record = asRecord(value)
  if (!record) {
    return readNumber(value, fieldName)
  }
  if (Array.isArray(record.vec)) {
    return readOptionalNumber(record.vec, fieldName)
  }
  if (record.value) {
    return readOptionalNumber(record.value, fieldName)
  }
  if (record.fields) {
    return readOptionalNumber(record.fields, fieldName)
  }
  return null
}

function readPackageIdFromType(type: string) {
  const packageId = type.split('::', 1)[0]
  return packageId ? normalizeSuiValue(packageId) : null
}

function extractTypedEvent(
  transaction: TransactionLike,
  type: string,
  trustedPackageIds?: string[],
) {
  const direct = transaction.events?.find((item) => item?.type === type)
  if (direct) {
    return asRecord(direct.parsedJson)
  }

  const trustedPackages = getTrustedPackageIds(...(trustedPackageIds ?? []))
  if (trustedPackages.length === 0) return null

  const suffix = type.replace(/^0x[0-9a-fA-F]+/, '')
  const fallback = (transaction.events ?? []).find((item) => {
    if (typeof item?.type !== 'string' || !item.type.endsWith(suffix)) {
      return false
    }
    const fallbackPackageId = readPackageIdFromType(item.type)
    return fallbackPackageId ? trustedPackages.includes(fallbackPackageId) : false
  })
  return fallback ? asRecord(fallback.parsedJson) : null
}

export function extractSoulMintedToKioskEvent(transaction: TransactionLike, packageId: string, trustedPackageIds?: string[]) {
  const event = extractTypedEvent(transaction, `${packageId}::market::SoulMintedToKiosk`, trustedPackageIds)
  if (!event) {
    throw new OnChainVerificationError('SoulMintedToKiosk event is missing from the transaction')
  }
  return {
    soulId: readObjectId(event.soul_id, 'SoulMintedToKiosk soul_id'),
    stateId: readObjectId(event.state_id, 'SoulMintedToKiosk state_id'),
    memoryId: readObjectId(event.memory_id, 'SoulMintedToKiosk memory_id'),
    kioskId: readObjectId(event.kiosk_id, 'SoulMintedToKiosk kiosk_id'),
    ownerAddress: readAddress(event.owner, 'SoulMintedToKiosk owner'),
    provenanceKind: readNumber(event.provenance_kind, 'SoulMintedToKiosk provenance_kind'),
  }
}

export function extractSoulListedEvent(transaction: TransactionLike, packageId: string, trustedPackageIds?: string[]) {
  const event = extractTypedEvent(transaction, `${packageId}::market::SoulListed`, trustedPackageIds)
  if (!event) {
    throw new OnChainVerificationError('SoulListed event is missing from the transaction')
  }
  return {
    listingId: readObjectId(event.listing_id, 'SoulListed listing_id'),
    soulId: readObjectId(event.soul_id, 'SoulListed soul_id'),
    sellerAddress: readAddress(event.seller, 'SoulListed seller'),
    kioskId: readObjectId(event.kiosk_id, 'SoulListed kiosk_id'),
    priceAtomic: readBigInt(event.price, 'SoulListed price'),
  }
}

export function extractSoulPurchasedEvent(transaction: TransactionLike, packageId: string, trustedPackageIds?: string[]) {
  const event = extractTypedEvent(transaction, `${packageId}::market::SoulPurchased`, trustedPackageIds)
  if (!event) {
    throw new OnChainVerificationError('SoulPurchased event is missing from the transaction')
  }
  return {
    listingId: readObjectId(event.listing_id, 'SoulPurchased listing_id'),
    soulId: readObjectId(event.soul_id, 'SoulPurchased soul_id'),
    sellerAddress: readAddress(event.seller, 'SoulPurchased seller'),
    buyerAddress: readAddress(event.buyer, 'SoulPurchased buyer'),
    priceAtomic: readBigInt(event.price, 'SoulPurchased price'),
    platformFeeAtomic: readBigInt(event.platform_fee, 'SoulPurchased platform_fee'),
    creatorRoyaltyAtomic: readBigInt(event.creator_royalty, 'SoulPurchased creator_royalty'),
    collectionRoyaltyAtomic: readBigInt(event.collection_royalty, 'SoulPurchased collection_royalty'),
  }
}

export function extractSoulListingCancelledEvent(transaction: TransactionLike, packageId: string, trustedPackageIds?: string[]) {
  const event = extractTypedEvent(transaction, `${packageId}::market::SoulListingCancelled`, trustedPackageIds)
  if (!event) {
    throw new OnChainVerificationError('SoulListingCancelled event is missing from the transaction')
  }
  return {
    listingId: readObjectId(event.listing_id, 'SoulListingCancelled listing_id'),
    soulId: readObjectId(event.soul_id, 'SoulListingCancelled soul_id'),
    sellerAddress: readAddress(event.seller, 'SoulListingCancelled seller'),
  }
}

export function extractCollectionMintedToKioskEvent(transaction: TransactionLike, packageId: string, trustedPackageIds?: string[]) {
  const event = extractTypedEvent(transaction, `${packageId}::market::CollectionMintedToKiosk`, trustedPackageIds)
  if (!event) {
    throw new OnChainVerificationError('CollectionMintedToKiosk event is missing from the transaction')
  }
  return {
    collectionId: readObjectId(event.collection_id, 'CollectionMintedToKiosk collection_id'),
    rightId: readObjectId(event.right_id, 'CollectionMintedToKiosk right_id'),
    ownerAddress: readAddress(event.owner, 'CollectionMintedToKiosk owner'),
    kioskId: readObjectId(event.kiosk_id, 'CollectionMintedToKiosk kiosk_id'),
    tradeable: Boolean(event.tradeable),
  }
}

export function extractCollectionListedEvent(transaction: TransactionLike, packageId: string, trustedPackageIds?: string[]) {
  const event = extractTypedEvent(transaction, `${packageId}::market::CollectionListed`, trustedPackageIds)
  if (!event) {
    throw new OnChainVerificationError('CollectionListed event is missing from the transaction')
  }
  return {
    listingId: readObjectId(event.listing_id, 'CollectionListed listing_id'),
    collectionId: readObjectId(event.collection_id, 'CollectionListed collection_id'),
    rightId: readObjectId(event.right_id, 'CollectionListed right_id'),
    sellerAddress: readAddress(event.seller, 'CollectionListed seller'),
    kioskId: readObjectId(event.kiosk_id, 'CollectionListed kiosk_id'),
    priceAtomic: readBigInt(event.price, 'CollectionListed price'),
  }
}

export function extractCollectionPurchasedEvent(transaction: TransactionLike, packageId: string, trustedPackageIds?: string[]) {
  const event = extractTypedEvent(transaction, `${packageId}::market::CollectionPurchased`, trustedPackageIds)
  if (!event) {
    throw new OnChainVerificationError('CollectionPurchased event is missing from the transaction')
  }
  return {
    listingId: readObjectId(event.listing_id, 'CollectionPurchased listing_id'),
    collectionId: readObjectId(event.collection_id, 'CollectionPurchased collection_id'),
    rightId: readObjectId(event.right_id, 'CollectionPurchased right_id'),
    sellerAddress: readAddress(event.seller, 'CollectionPurchased seller'),
    buyerAddress: readAddress(event.buyer, 'CollectionPurchased buyer'),
    priceAtomic: readBigInt(event.price, 'CollectionPurchased price'),
    platformFeeAtomic: readBigInt(event.platform_fee, 'CollectionPurchased platform_fee'),
  }
}

export function extractCollectionListingCancelledEvent(transaction: TransactionLike, packageId: string, trustedPackageIds?: string[]) {
  const event = extractTypedEvent(transaction, `${packageId}::market::CollectionListingCancelled`, trustedPackageIds)
  if (!event) {
    throw new OnChainVerificationError('CollectionListingCancelled event is missing from the transaction')
  }
  return {
    listingId: readObjectId(event.listing_id, 'CollectionListingCancelled listing_id'),
    collectionId: readObjectId(event.collection_id, 'CollectionListingCancelled collection_id'),
    sellerAddress: readAddress(event.seller, 'CollectionListingCancelled seller'),
  }
}

export function extractSoulGrantIssuedEvent(transaction: TransactionLike, packageId: string, trustedPackageIds?: string[]) {
  const event = extractTypedEvent(transaction, `${packageId}::grant::SoulGrantIssued`, trustedPackageIds)
  if (!event) {
    throw new OnChainVerificationError('SoulGrantIssued event is missing from the transaction')
  }
  const scopeMask = readNumber(event.scope_mask, 'SoulGrantIssued scope_mask')
  return {
    grantId: readObjectId(event.grant_id, 'SoulGrantIssued grant_id'),
    soulId: readObjectId(event.soul_id, 'SoulGrantIssued soul_id'),
    issuedByAddress: readAddress(event.issued_by, 'SoulGrantIssued issued_by'),
    granteeAddress: readAddress(event.grantee, 'SoulGrantIssued grantee'),
    scopeMask,
    scopes: scopeMaskToScopes(scopeMask),
    expiresAtMs: readOptionalNumber(event.expires_at_ms, 'SoulGrantIssued expires_at_ms'),
  }
}

export function extractSoulGrantRevokedEvent(transaction: TransactionLike, packageId: string, trustedPackageIds?: string[]) {
  const event = extractTypedEvent(transaction, `${packageId}::grant::SoulGrantRevoked`, trustedPackageIds)
  if (!event) {
    throw new OnChainVerificationError('SoulGrantRevoked event is missing from the transaction')
  }
  return {
    grantId: readObjectId(event.grant_id, 'SoulGrantRevoked grant_id'),
    soulId: readObjectId(event.soul_id, 'SoulGrantRevoked soul_id'),
    revokedByAddress: readAddress(event.revoked_by, 'SoulGrantRevoked revoked_by'),
    granteeAddress: readAddress(event.grantee, 'SoulGrantRevoked grantee'),
  }
}

export function extractSoulGrantSupersededEvent(transaction: TransactionLike, packageId: string, trustedPackageIds?: string[]) {
  const event = extractTypedEvent(transaction, `${packageId}::grant::SoulGrantSuperseded`, trustedPackageIds)
  if (!event) {
    throw new OnChainVerificationError('SoulGrantSuperseded event is missing from the transaction')
  }
  return {
    oldGrantId: readObjectId(event.old_grant_id, 'SoulGrantSuperseded old_grant_id'),
    newGrantId: readObjectId(event.new_grant_id, 'SoulGrantSuperseded new_grant_id'),
    soulId: readObjectId(event.soul_id, 'SoulGrantSuperseded soul_id'),
    granteeAddress: readAddress(event.grantee, 'SoulGrantSuperseded grantee'),
    supersededByAddress: readAddress(event.superseded_by, 'SoulGrantSuperseded superseded_by'),
  }
}

export function extractSoulGrantExpiredEvent(transaction: TransactionLike, packageId: string, trustedPackageIds?: string[]) {
  const event = extractTypedEvent(transaction, `${packageId}::grant::SoulGrantExpired`, trustedPackageIds)
  if (!event) {
    throw new OnChainVerificationError('SoulGrantExpired event is missing from the transaction')
  }
  return {
    grantId: readObjectId(event.grant_id, 'SoulGrantExpired grant_id'),
    soulId: readObjectId(event.soul_id, 'SoulGrantExpired soul_id'),
    granteeAddress: readAddress(event.grantee, 'SoulGrantExpired grantee'),
  }
}

export function extractSoulGrantInvalidatedEvent(transaction: TransactionLike, packageId: string, trustedPackageIds?: string[]) {
  const event = extractTypedEvent(transaction, `${packageId}::grant::SoulGrantInvalidated`, trustedPackageIds)
  if (!event) {
    throw new OnChainVerificationError('SoulGrantInvalidated event is missing from the transaction')
  }
  return {
    grantId: readObjectId(event.grant_id, 'SoulGrantInvalidated grant_id'),
    soulId: readObjectId(event.soul_id, 'SoulGrantInvalidated soul_id'),
    granteeAddress: readAddress(event.grantee, 'SoulGrantInvalidated grantee'),
    invalidatedByAddress: readAddress(event.invalidated_by, 'SoulGrantInvalidated invalidated_by'),
    newOwnerAddress: readAddress(event.new_owner, 'SoulGrantInvalidated new_owner'),
  }
}

export function extractSoulMemoryCreatedEvent(transaction: TransactionLike, packageId: string, trustedPackageIds?: string[]) {
  const event = extractTypedEvent(transaction, `${packageId}::memory::SoulMemoryCreated`, trustedPackageIds)
  if (!event) {
    throw new OnChainVerificationError('SoulMemoryCreated event is missing from the transaction')
  }
  return {
    memoryId: readObjectId(event.memory_id, 'SoulMemoryCreated memory_id'),
    soulId: readObjectId(event.soul_id, 'SoulMemoryCreated soul_id'),
  }
}

export function extractMemoryEntryAppendedEvent(transaction: TransactionLike, packageId: string, trustedPackageIds?: string[]) {
  const event = extractTypedEvent(transaction, `${packageId}::memory::MemoryEntryAppended`, trustedPackageIds)
  if (!event) {
    throw new OnChainVerificationError('MemoryEntryAppended event is missing from the transaction')
  }
  return {
    memoryId: readObjectId(event.memory_id, 'MemoryEntryAppended memory_id'),
    entryId: readObjectId(event.entry_id, 'MemoryEntryAppended entry_id'),
    soulId: readObjectId(event.soul_id, 'MemoryEntryAppended soul_id'),
    index: readNumber(event.index, 'MemoryEntryAppended index'),
    writerAddress: readAddress(event.writer, 'MemoryEntryAppended writer'),
    writerKind: readNumber(event.writer_kind, 'MemoryEntryAppended writer_kind'),
    createdAtMs: readNumber(event.created_at_ms, 'MemoryEntryAppended created_at_ms'),
    blobObjectId: readObjectId(event.blob_object_id, 'MemoryEntryAppended blob_object_id'),
  }
}

export function extractSkillVersionAppendedEvent(transaction: TransactionLike, packageId: string, trustedPackageIds?: string[]) {
  const event = extractTypedEvent(transaction, `${packageId}::skills::SkillVersionAppended`, trustedPackageIds)
  if (!event) {
    throw new OnChainVerificationError('SkillVersionAppended event is missing from the transaction')
  }
  return {
    skillsId: readObjectId(event.skills_id, 'SkillVersionAppended skills_id'),
    soulId: readObjectId(event.soul_id, 'SkillVersionAppended soul_id'),
    versionId: readObjectId(event.version_id, 'SkillVersionAppended version_id'),
    versionNumber: readNumber(event.version, 'SkillVersionAppended version'),
    previousVersionId: readOptionalObjectId(event.previous_version_id, 'SkillVersionAppended previous_version_id'),
    visibility: Boolean(event.is_public) ? 'public' as const : 'private' as const,
    createdAtMs: readNumber(event.created_at_ms, 'SkillVersionAppended created_at_ms'),
    blobObjectId: readObjectId(event.blob_object_id, 'SkillVersionAppended blob_object_id'),
  }
}

export function extractSkillVersionDeletedEvent(transaction: TransactionLike, packageId: string, trustedPackageIds?: string[]) {
  const event = extractTypedEvent(transaction, `${packageId}::skills::SkillVersionDeleted`, trustedPackageIds)
  if (!event) {
    throw new OnChainVerificationError('SkillVersionDeleted event is missing from the transaction')
  }
  return {
    skillsId: readObjectId(event.skills_id, 'SkillVersionDeleted skills_id'),
    soulId: readObjectId(event.soul_id, 'SkillVersionDeleted soul_id'),
    versionId: readObjectId(event.version_id, 'SkillVersionDeleted version_id'),
    deletedByAddress: readAddress(event.deleted_by, 'SkillVersionDeleted deleted_by'),
  }
}

export function deriveCollectionRoyaltyBps(collection: SoulCollectionObject | null, listing: SoulListingObject) {
  if (!collection || !listing.collectionId) return 0
  return collection.extraRoyaltyBps
}

export function isGrantActive(params: {
  state: { activeGrants: Array<{ grantId: string; granteeAddress: string; scopeMask: number; expiresAtMs: number | null }>; ownershipEpoch: number }
  grant: SoulGrantObject | null
  nowMs: number
  requiredScope?: SoulGrantScope
}) {
  if (!params.grant) return false
  if (params.grant.ownershipEpochSnapshot !== params.state.ownershipEpoch) return false
  const activeSlot = params.state.activeGrants.find((slot) => slot.grantId === params.grant?.objectId)
  if (!activeSlot) return false
  if (activeSlot.granteeAddress !== params.grant.granteeAddress) return false
  if (params.grant.expiresAtMs != null && params.grant.expiresAtMs < params.nowMs) return false
  if (params.requiredScope && !params.grant.scopes.includes(params.requiredScope)) return false
  return true
}

export function isCollectionListingActive(listing: CollectionListingObject) {
  return listing.active
}
