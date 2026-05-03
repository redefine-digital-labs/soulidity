import type {
  AssetType,
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
  if (record.value !== undefined) {
    return readOptionalObjectId(record.value, fieldName)
  }
  if (record.fields !== undefined) {
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
  if (record.value !== undefined) {
    return readOptionalNumber(record.value, fieldName)
  }
  if (record.fields !== undefined) {
    return readOptionalNumber(record.fields, fieldName)
  }
  return null
}

// Parse a Move `Option<u64>` payload.
//
// Move Option serialises as a vector of length 0 (None) or 1 (Some).
// Parser shape examples returned by the SDK:
//   None              -> [] | { vec: [] } | null
//   Some(0)           -> [0] | { vec: [0] } | { vec: ["0"] } | { value: 0 }
//   Some(3)           -> [3] | { vec: ["3"] } | { value: "3" }
//
// We must distinguish `Some(0)` from `None`; truthy fallback (`if (record.value)`)
// would erase Some(0). All branches use explicit `!== undefined` checks.
function readOptionalBigInt(value: unknown, fieldName: string): bigint | null {
  if (value == null) return null
  if (Array.isArray(value)) {
    if (value.length === 0) return null
    return readOptionalBigInt(value[0], fieldName)
  }
  const record = asRecord(value)
  if (!record) {
    return readBigInt(value, fieldName)
  }
  if (Array.isArray(record.vec)) {
    return readOptionalBigInt(record.vec, fieldName)
  }
  if (record.value !== undefined) {
    return readOptionalBigInt(record.value, fieldName)
  }
  if (record.fields !== undefined) {
    return readOptionalBigInt(record.fields, fieldName)
  }
  return null
}

function readString(value: unknown, fieldName: string) {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim()
  }
  throw new OnChainVerificationError(`${fieldName} is missing on chain`)
}

function readOptionalString(value: unknown, fieldName: string): string | null {
  if (value == null) return null
  if (Array.isArray(value)) {
    if (value.length === 0) return null
    return readOptionalString(value[0], fieldName)
  }
  const record = asRecord(value)
  if (!record) {
    return typeof value === 'string' ? readString(value, fieldName) : null
  }
  if (Array.isArray(record.vec)) {
    return readOptionalString(record.vec, fieldName)
  }
  if (record.value !== undefined) {
    return readOptionalString(record.value, fieldName)
  }
  if (record.fields !== undefined) {
    return readOptionalString(record.fields, fieldName)
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
    metadataId: readObjectId(event.metadata_id, 'SoulMintedToKiosk metadata_id'),
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

export function extractSoulMetadataMutationEvent(transaction: TransactionLike, packageId: string, trustedPackageIds?: string[]) {
  const candidates = [
    {
      type: `${packageId}::metadata::SoulMetadataSpriteUpdated`,
      label: 'SoulMetadataSpriteUpdated',
      kind: 'sprite' as const,
    },
    {
      type: `${packageId}::metadata::SoulMetadataVoiceUpdated`,
      label: 'SoulMetadataVoiceUpdated',
      kind: 'voice' as const,
    },
    {
      type: `${packageId}::metadata::SoulMetadataBlobUpserted`,
      label: 'SoulMetadataBlobUpserted',
      kind: 'blob_upserted' as const,
    },
    {
      type: `${packageId}::metadata::SoulMetadataBlobDeleted`,
      label: 'SoulMetadataBlobDeleted',
      kind: 'blob_deleted' as const,
    },
  ]

  for (const candidate of candidates) {
    const event = extractTypedEvent(transaction, candidate.type, trustedPackageIds)
    if (!event) {
      continue
    }
    return {
      kind: candidate.kind,
      soulId: readObjectId(event.soul_id, `${candidate.label} soul_id`),
      metadataId: readObjectId(event.metadata_id, `${candidate.label} metadata_id`),
      updaterAddress: readAddress(event.updater, `${candidate.label} updater`),
      key: 'key' in event ? readOptionalString(event.key, `${candidate.label} key`) : null,
    }
  }

  throw new OnChainVerificationError('Soul metadata mutation event is missing from the transaction')
}

export function extractSoulAddedToCollectionEvent(transaction: TransactionLike, packageId: string, trustedPackageIds?: string[]) {
  const event = extractTypedEvent(transaction, `${packageId}::collection::SoulAddedToCollection`, trustedPackageIds)
  if (!event) {
    throw new OnChainVerificationError('SoulAddedToCollection event is missing from the transaction')
  }
  return {
    collectionId: readObjectId(event.collection_id, 'SoulAddedToCollection collection_id'),
    soulId: readObjectId(event.soul_id, 'SoulAddedToCollection soul_id'),
    currentSupply: readBigInt(event.current_supply, 'SoulAddedToCollection current_supply'),
    maxSupply: readOptionalBigInt(event.max_supply, 'SoulAddedToCollection max_supply'),
  }
}

export function extractSoulCollectionCreatedEvent(transaction: TransactionLike, packageId: string, trustedPackageIds?: string[]) {
  const event = extractTypedEvent(transaction, `${packageId}::collection::SoulCollectionCreated`, trustedPackageIds)
  if (!event) {
    throw new OnChainVerificationError('SoulCollectionCreated event is missing from the transaction')
  }
  return {
    collectionId: readObjectId(event.collection_id, 'SoulCollectionCreated collection_id'),
    rightId: readObjectId(event.right_id, 'SoulCollectionCreated right_id'),
    creatorAddress: readAddress(event.creator, 'SoulCollectionCreated creator'),
    currentHolderAddress: readAddress(event.current_holder, 'SoulCollectionCreated current_holder'),
    tradeable: Boolean(event.tradeable),
    maxSupply: readOptionalBigInt(event.max_supply, 'SoulCollectionCreated max_supply'),
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
    soulId: readObjectId(event.soul_id, 'MemoryEntryAppended soul_id'),
    timestampKey: readNumber(event.timestamp_key, 'MemoryEntryAppended timestamp_key'),
    writerAddress: readAddress(event.writer, 'MemoryEntryAppended writer'),
    writerKind: readNumber(event.writer_kind, 'MemoryEntryAppended writer_kind'),
    createdAtMs: readNumber(event.created_at_ms, 'MemoryEntryAppended created_at_ms'),
    blobObjectId: readObjectId(event.blob_object_id, 'MemoryEntryAppended blob_object_id'),
  }
}

export function tryExtractMemoryEntryAppendedEvent(transaction: TransactionLike, packageId: string, trustedPackageIds?: string[]) {
  const event = extractTypedEvent(transaction, `${packageId}::memory::MemoryEntryAppended`, trustedPackageIds)
  if (!event) return null
  return {
    memoryId: readObjectId(event.memory_id, 'MemoryEntryAppended memory_id'),
    soulId: readObjectId(event.soul_id, 'MemoryEntryAppended soul_id'),
    timestampKey: readNumber(event.timestamp_key, 'MemoryEntryAppended timestamp_key'),
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
    skillName: readString(event.skill_name, 'SkillVersionAppended skill_name'),
    versionIndex: readNumber(event.version_index, 'SkillVersionAppended version_index'),
    visibility: Boolean(event.is_public) ? 'public' as const : 'private' as const,
    createdAtMs: readNumber(event.created_at_ms, 'SkillVersionAppended created_at_ms'),
    blobObjectId: readObjectId(event.blob_object_id, 'SkillVersionAppended blob_object_id'),
  }
}

export function tryExtractSkillVersionAppendedEvent(transaction: TransactionLike, packageId: string, trustedPackageIds?: string[]) {
  const event = extractTypedEvent(transaction, `${packageId}::skills::SkillVersionAppended`, trustedPackageIds)
  if (!event) return null
  return {
    skillsId: readObjectId(event.skills_id, 'SkillVersionAppended skills_id'),
    soulId: readObjectId(event.soul_id, 'SkillVersionAppended soul_id'),
    skillName: readString(event.skill_name, 'SkillVersionAppended skill_name'),
    versionIndex: readNumber(event.version_index, 'SkillVersionAppended version_index'),
    visibility: Boolean(event.is_public) ? 'public' as const : 'private' as const,
    createdAtMs: readNumber(event.created_at_ms, 'SkillVersionAppended created_at_ms'),
    blobObjectId: readObjectId(event.blob_object_id, 'SkillVersionAppended blob_object_id'),
  }
}

function mapAssetType(value: number): AssetType {
  switch (value) {
    case 0: return 'sprite'
    case 1: return 'live2d'
    case 2: return 'audio'
    default: return 'sprite'
  }
}

export function extractAssetVersionAppendedEvent(
  transaction: TransactionLike,
  packageId: string,
  trustedPackageIds?: string[],
) {
  const event = extractTypedEvent(transaction, `${packageId}::assets::AssetVersionAppended`, trustedPackageIds)
  if (!event) {
    throw new OnChainVerificationError('AssetVersionAppended event is missing from the transaction')
  }
  return {
    assetsId: readObjectId(event.assets_id, 'AssetVersionAppended assets_id'),
    soulId: readObjectId(event.soul_id, 'AssetVersionAppended soul_id'),
    assetName: readString(event.asset_name, 'AssetVersionAppended asset_name'),
    versionIndex: readNumber(event.version_index, 'AssetVersionAppended version_index'),
    visibility: Boolean(event.is_public) ? 'public' as const : 'private' as const,
    assetType: mapAssetType(readNumber(event.asset_type, 'AssetVersionAppended asset_type')),
    createdAtMs: readNumber(event.created_at_ms, 'AssetVersionAppended created_at_ms'),
    blobObjectId: readObjectId(event.blob_object_id, 'AssetVersionAppended blob_object_id'),
  }
}

export function tryExtractAssetVersionAppendedEvent(
  transaction: TransactionLike,
  packageId: string,
  trustedPackageIds?: string[],
) {
  const event = extractTypedEvent(transaction, `${packageId}::assets::AssetVersionAppended`, trustedPackageIds)
  if (!event) return null
  return {
    assetsId: readObjectId(event.assets_id, 'AssetVersionAppended assets_id'),
    soulId: readObjectId(event.soul_id, 'AssetVersionAppended soul_id'),
    assetName: readString(event.asset_name, 'AssetVersionAppended asset_name'),
    versionIndex: readNumber(event.version_index, 'AssetVersionAppended version_index'),
    visibility: Boolean(event.is_public) ? 'public' as const : 'private' as const,
    assetType: mapAssetType(readNumber(event.asset_type, 'AssetVersionAppended asset_type')),
    createdAtMs: readNumber(event.created_at_ms, 'AssetVersionAppended created_at_ms'),
    blobObjectId: readObjectId(event.blob_object_id, 'AssetVersionAppended blob_object_id'),
  }
}

export function extractAssetVersionDeletedEvent(
  transaction: TransactionLike,
  packageId: string,
  trustedPackageIds?: string[],
) {
  const event = extractTypedEvent(transaction, `${packageId}::assets::AssetVersionDeleted`, trustedPackageIds)
  if (!event) {
    throw new OnChainVerificationError('AssetVersionDeleted event is missing from the transaction')
  }
  return {
    assetsId: readObjectId(event.assets_id, 'AssetVersionDeleted assets_id'),
    soulId: readObjectId(event.soul_id, 'AssetVersionDeleted soul_id'),
    assetName: readString(event.asset_name, 'AssetVersionDeleted asset_name'),
    versionIndex: readNumber(event.version_index, 'AssetVersionDeleted version_index'),
    deletedBy: readObjectId(event.deleted_by, 'AssetVersionDeleted deleted_by'),
  }
}

export function extractContentAccessListCreatedEvent(
  transaction: TransactionLike,
  packageId: string,
  trustedPackageIds?: string[],
) {
  const event = extractTypedEvent(transaction, `${packageId}::content_access::ContentAccessListCreated`, trustedPackageIds)
  if (!event) {
    throw new OnChainVerificationError('ContentAccessListCreated event is missing from the transaction')
  }
  return {
    accessListId: readObjectId(event.access_list_id, 'ContentAccessListCreated access_list_id'),
    soulId: readObjectId(event.soul_id, 'ContentAccessListCreated soul_id'),
    creator: readAddress(event.creator, 'ContentAccessListCreated creator'),
    priceAtomic: readNumber(event.price_atomic, 'ContentAccessListCreated price_atomic'),
    defaultScopeMask: readNumber(event.default_scope_mask, 'ContentAccessListCreated default_scope_mask'),
    defaultAccessDurationMs: readOptionalNumber(
      event.default_access_duration_ms,
      'ContentAccessListCreated default_access_duration_ms',
    ),
  }
}

export function tryExtractContentAccessListCreatedEvent(
  transaction: TransactionLike,
  packageId: string,
  trustedPackageIds?: string[],
) {
  const event = extractTypedEvent(transaction, `${packageId}::content_access::ContentAccessListCreated`, trustedPackageIds)
  if (!event) return null
  return {
    accessListId: readObjectId(event.access_list_id, 'ContentAccessListCreated access_list_id'),
    soulId: readObjectId(event.soul_id, 'ContentAccessListCreated soul_id'),
    creator: readAddress(event.creator, 'ContentAccessListCreated creator'),
    priceAtomic: readNumber(event.price_atomic, 'ContentAccessListCreated price_atomic'),
    defaultScopeMask: readNumber(event.default_scope_mask, 'ContentAccessListCreated default_scope_mask'),
    defaultAccessDurationMs: readOptionalNumber(
      event.default_access_duration_ms,
      'ContentAccessListCreated default_access_duration_ms',
    ),
  }
}

export function extractContentAccessGrantedEvent(
  transaction: TransactionLike,
  packageId: string,
  trustedPackageIds?: string[],
) {
  const event = extractTypedEvent(transaction, `${packageId}::content_access::ContentAccessGranted`, trustedPackageIds)
  if (!event) {
    throw new OnChainVerificationError('ContentAccessGranted event is missing from the transaction')
  }
  return {
    soulId: readObjectId(event.soul_id, 'ContentAccessGranted soul_id'),
    accessListId: readObjectId(event.access_list_id, 'ContentAccessGranted access_list_id'),
    grantee: readAddress(event.grantee, 'ContentAccessGranted grantee'),
    scopeMask: readNumber(event.scope_mask, 'ContentAccessGranted scope_mask'),
    pricePaidAtomic: readNumber(event.price_paid_atomic, 'ContentAccessGranted price_paid_atomic'),
    expiresAtMs: readOptionalNumber(event.expires_at_ms, 'ContentAccessGranted expires_at_ms'),
    ownershipEpochSnapshot: readNumber(
      event.ownership_epoch_snapshot,
      'ContentAccessGranted ownership_epoch_snapshot',
    ),
  }
}

/**
 * Find the ContentAccessGranted event that matches a specific access_list_id and grantee.
 * Used by the purchase mirror route to pair the grant event with the purchase event
 * in multi-call PTBs where multiple ContentAccessGranted events may exist.
 */
export function extractMatchedContentAccessGrantedEvent(
  transaction: TransactionLike,
  packageId: string,
  matchAccessListId: string,
  matchGrantee: string,
  trustedPackageIds?: string[],
) {
  const type = `${packageId}::content_access::ContentAccessGranted`
  const suffix = type.replace(/^0x[0-9a-fA-F]+/, '')
  const trustedPackages = getTrustedPackageIds(...(trustedPackageIds ?? []))

  const candidates = (transaction.events ?? []).filter((item) => {
    if (item?.type === type) return true
    if (typeof item?.type !== 'string' || !item.type.endsWith(suffix)) return false
    if (trustedPackages.length === 0) return false
    const fallbackPackageId = readPackageIdFromType(item.type)
    return fallbackPackageId ? trustedPackages.includes(fallbackPackageId) : false
  })

  for (const candidate of candidates) {
    const parsed = asRecord(candidate.parsedJson)
    if (!parsed) continue
    try {
      const accessListId = readObjectId(parsed.access_list_id, 'ContentAccessGranted access_list_id')
      const grantee = readAddress(parsed.grantee, 'ContentAccessGranted grantee')
      if (accessListId === matchAccessListId && grantee === matchGrantee) {
        return {
          soulId: readObjectId(parsed.soul_id, 'ContentAccessGranted soul_id'),
          accessListId,
          grantee,
          scopeMask: readNumber(parsed.scope_mask, 'ContentAccessGranted scope_mask'),
          pricePaidAtomic: readNumber(parsed.price_paid_atomic, 'ContentAccessGranted price_paid_atomic'),
          expiresAtMs: readOptionalNumber(parsed.expires_at_ms, 'ContentAccessGranted expires_at_ms'),
          ownershipEpochSnapshot: readNumber(
            parsed.ownership_epoch_snapshot,
            'ContentAccessGranted ownership_epoch_snapshot',
          ),
        }
      }
    } catch {
      continue
    }
  }

  throw new OnChainVerificationError('No ContentAccessGranted event matches the purchase (access_list_id + grantee)')
}

export function extractContentAccessRevokedEvent(
  transaction: TransactionLike,
  packageId: string,
  trustedPackageIds?: string[],
) {
  const event = extractTypedEvent(transaction, `${packageId}::content_access::ContentAccessRevoked`, trustedPackageIds)
  if (!event) {
    throw new OnChainVerificationError('ContentAccessRevoked event is missing from the transaction')
  }
  return {
    soulId: readObjectId(event.soul_id, 'ContentAccessRevoked soul_id'),
    accessListId: readObjectId(event.access_list_id, 'ContentAccessRevoked access_list_id'),
    grantee: readAddress(event.grantee, 'ContentAccessRevoked grantee'),
  }
}

export function extractContentAccessPurchasedEvent(
  transaction: TransactionLike,
  packageId: string,
  trustedPackageIds?: string[],
) {
  const event = extractTypedEvent(transaction, `${packageId}::market::ContentAccessPurchased`, trustedPackageIds)
  if (!event) {
    throw new OnChainVerificationError('ContentAccessPurchased event is missing from the transaction')
  }
  return {
    soulId: readObjectId(event.soul_id, 'ContentAccessPurchased soul_id'),
    accessListId: readObjectId(event.access_list_id, 'ContentAccessPurchased access_list_id'),
    buyer: readAddress(event.buyer, 'ContentAccessPurchased buyer'),
    priceAtomic: readBigInt(event.price, 'ContentAccessPurchased price'),
    platformFeeAtomic: readBigInt(event.platform_fee, 'ContentAccessPurchased platform_fee'),
    paymentRecipient: readAddress(event.payment_recipient, 'ContentAccessPurchased payment_recipient'),
  }
}

export function tryExtractContentAccessPurchasedEvent(
  transaction: TransactionLike,
  packageId: string,
  trustedPackageIds?: string[],
) {
  const event = extractTypedEvent(transaction, `${packageId}::market::ContentAccessPurchased`, trustedPackageIds)
  if (!event) return null
  return {
    soulId: readObjectId(event.soul_id, 'ContentAccessPurchased soul_id'),
    accessListId: readObjectId(event.access_list_id, 'ContentAccessPurchased access_list_id'),
    buyer: readAddress(event.buyer, 'ContentAccessPurchased buyer'),
    priceAtomic: readBigInt(event.price, 'ContentAccessPurchased price'),
    platformFeeAtomic: readBigInt(event.platform_fee, 'ContentAccessPurchased platform_fee'),
    paymentRecipient: readAddress(event.payment_recipient, 'ContentAccessPurchased payment_recipient'),
  }
}

export function extractGrantCapacityUpdatedEvent(
  transaction: TransactionLike,
  packageId: string,
  trustedPackageIds?: string[],
) {
  const event = extractTypedEvent(transaction, `${packageId}::grant::GrantCapacityUpdated`, trustedPackageIds)
  if (!event) {
    throw new OnChainVerificationError('GrantCapacityUpdated event is missing from the transaction')
  }
  return {
    soulId: readObjectId(event.soul_id, 'GrantCapacityUpdated soul_id'),
    oldCapacity: readNumber(event.old_capacity, 'GrantCapacityUpdated old_capacity'),
    newCapacity: readNumber(event.new_capacity, 'GrantCapacityUpdated new_capacity'),
  }
}

export function tryExtractGrantCapacityUpdatedEvent(
  transaction: TransactionLike,
  packageId: string,
  trustedPackageIds?: string[],
) {
  const event = extractTypedEvent(transaction, `${packageId}::grant::GrantCapacityUpdated`, trustedPackageIds)
  if (!event) return null
  return {
    soulId: readObjectId(event.soul_id, 'GrantCapacityUpdated soul_id'),
    oldCapacity: readNumber(event.old_capacity, 'GrantCapacityUpdated old_capacity'),
    newCapacity: readNumber(event.new_capacity, 'GrantCapacityUpdated new_capacity'),
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
    skillName: readString(event.skill_name, 'SkillVersionDeleted skill_name'),
    versionIndex: readNumber(event.version_index, 'SkillVersionDeleted version_index'),
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
