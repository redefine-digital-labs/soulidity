import type {
  CollectionListingObject,
  SoulCollectionObject,
  SoulDownloadPolicy,
  SoulGrantObject,
  SoulGrantScope,
  SoulListingObject,
} from './types'
import { OnChainVerificationError, getTrustedPackageIds, normalizeSuiValue, scopeMaskToScopes } from './queries'

/**
 * Phase 2 writer-kind enum mirrored from `content.move`. Phase 1 emitted this
 * on every `MemoryEntryAppended` event; the Phase 2 `ContentVersionAppended`
 * struct dropped the field, so this stays here for legacy mirror callers that
 * still need to label appends. Keep `'owner' | 'granted-agent'` as the
 * canonical TS form to mirror the on-chain `u8` (0 = owner, 1 = granted_agent).
 */
export type SoulWriterKind = 'owner' | 'granted-agent'

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

/**
 * Returns all parsed event payloads matching `type` (preserving emission
 * order). Used by the collection-publish flow where one PTB mints N souls
 * and emits N copies of each per-soul event.
 */
function extractAllTypedEvents(
  transaction: TransactionLike,
  type: string,
  trustedPackageIds?: string[],
): Array<Record<string, unknown>> {
  const direct = (transaction.events ?? []).filter((item) => item?.type === type)
  if (direct.length > 0) {
    return direct
      .map((item) => asRecord(item.parsedJson))
      .filter((value): value is Record<string, unknown> => value !== null)
  }

  const trustedPackages = getTrustedPackageIds(...(trustedPackageIds ?? []))
  if (trustedPackages.length === 0) return []

  const suffix = type.replace(/^0x[0-9a-fA-F]+/, '')
  const fallback = (transaction.events ?? []).filter((item) => {
    if (typeof item?.type !== 'string' || !item.type.endsWith(suffix)) {
      return false
    }
    const fallbackPackageId = readPackageIdFromType(item.type)
    return fallbackPackageId ? trustedPackages.includes(fallbackPackageId) : false
  })
  return fallback
    .map((item) => asRecord(item.parsedJson))
    .filter((value): value is Record<string, unknown> => value !== null)
}

// ── Helpers shared by multiple parsers ────────────────────────────────

/**
 * Phase 2 download-policy enum on the wire. Mirrors `content.move`:
 *   0 = DOWNLOAD_POLICY_PUBLIC
 *   1 = DOWNLOAD_POLICY_OWNER_ONLY
 *   2 = DOWNLOAD_POLICY_ALLOWLIST
 * Anything else is rejected — the chain only ever emits one of these three.
 */
function mapDownloadPolicy(value: number, fieldName: string): SoulDownloadPolicy {
  switch (value) {
    case 0: return 'public'
    case 1: return 'owner_only'
    case 2: return 'allowlist'
    default:
      throw new OnChainVerificationError(`${fieldName} has an unsupported value (${value})`)
  }
}

/**
 * Map the on-chain `u8` writer-kind to its TS form. Only used by callers that
 * still need to label appends (paid-access purchase mirror, legacy logs).
 * 0 = owner, 1 = granted_agent. Unknown values fall back to `'owner'` because
 * the contract only emits these two and we'd rather not throw on a future
 * additive change.
 */
export function mapWriterKind(value: number): SoulWriterKind {
  return value === 1 ? 'granted-agent' : 'owner'
}

// ── soul.move ─────────────────────────────────────────────────────────

export function extractSoulOwnershipRotatedEvent(
  transaction: TransactionLike,
  packageId: string,
  trustedPackageIds?: string[],
) {
  const event = extractTypedEvent(transaction, `${packageId}::soul::SoulOwnershipRotated`, trustedPackageIds)
  if (!event) {
    throw new OnChainVerificationError('SoulOwnershipRotated event is missing from the transaction')
  }
  return {
    soulId: readObjectId(event.soul_id, 'SoulOwnershipRotated soul_id'),
    previousOwnerAddress: readAddress(event.previous_owner, 'SoulOwnershipRotated previous_owner'),
    newOwnerAddress: readAddress(event.new_owner, 'SoulOwnershipRotated new_owner'),
    ownershipEpoch: readNumber(event.ownership_epoch, 'SoulOwnershipRotated ownership_epoch'),
  }
}

function parseSoulStateConfigUpsertedEvent(event: Record<string, unknown>) {
  return {
    stateId: readObjectId(event.state_id, 'SoulStateConfigUpserted state_id'),
    soulId: readObjectId(event.soul_id, 'SoulStateConfigUpserted soul_id'),
    updaterAddress: readAddress(event.updater, 'SoulStateConfigUpserted updater'),
    key: readString(event.key, 'SoulStateConfigUpserted key'),
  }
}

export function extractSoulStateConfigUpsertedEvent(
  transaction: TransactionLike,
  packageId: string,
  trustedPackageIds?: string[],
) {
  const event = extractTypedEvent(transaction, `${packageId}::soul::SoulStateConfigUpserted`, trustedPackageIds)
  if (!event) {
    throw new OnChainVerificationError('SoulStateConfigUpserted event is missing from the transaction')
  }
  return parseSoulStateConfigUpsertedEvent(event)
}

/**
 * Extracts every `SoulStateConfigUpserted` event in emission order. Owner-driven
 * batch config writes (sprite_config_json + voice_config_json + persona tags)
 * may emit multiple per PTB; mirror routes pair by `key`.
 */
export function extractAllSoulStateConfigUpsertedEvents(
  transaction: TransactionLike,
  packageId: string,
  trustedPackageIds?: string[],
) {
  const events = extractAllTypedEvents(transaction, `${packageId}::soul::SoulStateConfigUpserted`, trustedPackageIds)
  return events.map(parseSoulStateConfigUpsertedEvent)
}

export function extractSoulStateConfigDeletedEvent(
  transaction: TransactionLike,
  packageId: string,
  trustedPackageIds?: string[],
) {
  const event = extractTypedEvent(transaction, `${packageId}::soul::SoulStateConfigDeleted`, trustedPackageIds)
  if (!event) {
    throw new OnChainVerificationError('SoulStateConfigDeleted event is missing from the transaction')
  }
  return {
    stateId: readObjectId(event.state_id, 'SoulStateConfigDeleted state_id'),
    soulId: readObjectId(event.soul_id, 'SoulStateConfigDeleted soul_id'),
    updaterAddress: readAddress(event.updater, 'SoulStateConfigDeleted updater'),
    key: readString(event.key, 'SoulStateConfigDeleted key'),
  }
}

// ── market.move (mint / list / purchase) ──────────────────────────────

function parseSoulMintedToKioskEvent(event: Record<string, unknown>) {
  return {
    soulId: readObjectId(event.soul_id, 'SoulMintedToKiosk soul_id'),
    stateId: readObjectId(event.state_id, 'SoulMintedToKiosk state_id'),
    contentId: readObjectId(event.content_id, 'SoulMintedToKiosk content_id'),
    kioskId: readObjectId(event.kiosk_id, 'SoulMintedToKiosk kiosk_id'),
    ownerAddress: readAddress(event.owner, 'SoulMintedToKiosk owner'),
    provenanceKind: readNumber(event.provenance_kind, 'SoulMintedToKiosk provenance_kind'),
  }
}

export function extractSoulMintedToKioskEvent(transaction: TransactionLike, packageId: string, trustedPackageIds?: string[]) {
  const event = extractTypedEvent(transaction, `${packageId}::market::SoulMintedToKiosk`, trustedPackageIds)
  if (!event) {
    throw new OnChainVerificationError('SoulMintedToKiosk event is missing from the transaction')
  }
  return parseSoulMintedToKioskEvent(event)
}

/**
 * Extracts every `SoulMintedToKiosk` event in emission order. Used when one
 * PTB batches N mints — caller pairs each event with the corresponding soul
 * by `soul_id` (mint events are emitted in moveCall order).
 */
export function extractAllSoulMintedToKioskEvents(transaction: TransactionLike, packageId: string, trustedPackageIds?: string[]) {
  const events = extractAllTypedEvents(transaction, `${packageId}::market::SoulMintedToKiosk`, trustedPackageIds)
  return events.map(parseSoulMintedToKioskEvent)
}

function parseSoulListedEvent(event: Record<string, unknown>) {
  return {
    listingId: readObjectId(event.listing_id, 'SoulListed listing_id'),
    soulId: readObjectId(event.soul_id, 'SoulListed soul_id'),
    sellerAddress: readAddress(event.seller, 'SoulListed seller'),
    kioskId: readObjectId(event.kiosk_id, 'SoulListed kiosk_id'),
    priceAtomic: readBigInt(event.price, 'SoulListed price'),
  }
}

export function extractSoulListedEvent(transaction: TransactionLike, packageId: string, trustedPackageIds?: string[]) {
  const event = extractTypedEvent(transaction, `${packageId}::market::SoulListed`, trustedPackageIds)
  if (!event) {
    throw new OnChainVerificationError('SoulListed event is missing from the transaction')
  }
  return parseSoulListedEvent(event)
}

/**
 * Extracts every `SoulListed` event in emission order. Used when one PTB
 * combines mint + bind + list (or mint + list, or chunked mint+list batches),
 * so a route mirroring a specific soul's listing must filter by `soulId`
 * rather than picking the first event in the digest.
 */
export function extractAllSoulListedEvents(transaction: TransactionLike, packageId: string, trustedPackageIds?: string[]) {
  const events = extractAllTypedEvents(transaction, `${packageId}::market::SoulListed`, trustedPackageIds)
  return events.map(parseSoulListedEvent)
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

// ── content.move ──────────────────────────────────────────────────────

function parseSoulContentCreatedEvent(event: Record<string, unknown>) {
  return {
    contentId: readObjectId(event.content_id, 'SoulContentCreated content_id'),
    soulId: readObjectId(event.soul_id, 'SoulContentCreated soul_id'),
  }
}

export function extractSoulContentCreatedEvent(
  transaction: TransactionLike,
  packageId: string,
  trustedPackageIds?: string[],
) {
  const event = extractTypedEvent(transaction, `${packageId}::content::SoulContentCreated`, trustedPackageIds)
  if (!event) {
    throw new OnChainVerificationError('SoulContentCreated event is missing from the transaction')
  }
  return parseSoulContentCreatedEvent(event)
}

/**
 * Extracts every `SoulContentCreated` event in emission order. Batched mint
 * PTBs emit one per soul. Caller pairs events to souls by `soulId`.
 */
export function extractAllSoulContentCreatedEvents(
  transaction: TransactionLike,
  packageId: string,
  trustedPackageIds?: string[],
) {
  const events = extractAllTypedEvents(transaction, `${packageId}::content::SoulContentCreated`, trustedPackageIds)
  return events.map(parseSoulContentCreatedEvent)
}

function parseContentVersionAppendedEvent(event: Record<string, unknown>) {
  return {
    contentId: readObjectId(event.content_id, 'ContentVersionAppended content_id'),
    soulId: readObjectId(event.soul_id, 'ContentVersionAppended soul_id'),
    kind: readNumber(event.kind, 'ContentVersionAppended kind'),
    kindName: readString(event.kind_name, 'ContentVersionAppended kind_name'),
    name: readString(event.name, 'ContentVersionAppended name'),
    versionIndex: readNumber(event.version_index, 'ContentVersionAppended version_index'),
    isPublic: Boolean(event.is_public),
    downloadPolicy: mapDownloadPolicy(
      readNumber(event.download_policy, 'ContentVersionAppended download_policy'),
      'ContentVersionAppended download_policy',
    ),
    grantScopeMask: readNumber(event.grant_scope_mask, 'ContentVersionAppended grant_scope_mask'),
    readModeMask: readNumber(event.read_mode_mask, 'ContentVersionAppended read_mode_mask'),
    opMask: readNumber(event.op_mask, 'ContentVersionAppended op_mask'),
    sealEncrypted: Boolean(event.seal_encrypted),
    blobObjectId: readObjectId(event.blob_object_id, 'ContentVersionAppended blob_object_id'),
    createdAtMs: readNumber(event.created_at_ms, 'ContentVersionAppended created_at_ms'),
  }
}

export function extractContentVersionAppendedEvent(
  transaction: TransactionLike,
  packageId: string,
  trustedPackageIds?: string[],
) {
  const event = extractTypedEvent(transaction, `${packageId}::content::ContentVersionAppended`, trustedPackageIds)
  if (!event) {
    throw new OnChainVerificationError('ContentVersionAppended event is missing from the transaction')
  }
  return parseContentVersionAppendedEvent(event)
}

export function tryExtractContentVersionAppendedEvent(
  transaction: TransactionLike,
  packageId: string,
  trustedPackageIds?: string[],
) {
  const event = extractTypedEvent(transaction, `${packageId}::content::ContentVersionAppended`, trustedPackageIds)
  if (!event) return null
  return parseContentVersionAppendedEvent(event)
}

/**
 * Extracts every `ContentVersionAppended` event in emission order. Mint PTBs
 * emit one per `(kind, name)` initial slot (SOUL_DOC v0 + MEMORY v0 + any
 * persona / skill seeds). Caller pairs events to souls by `soulId` and to
 * slots by `(kind, name, versionIndex)`.
 */
export function extractAllContentVersionAppendedEvents(
  transaction: TransactionLike,
  packageId: string,
  trustedPackageIds?: string[],
) {
  const events = extractAllTypedEvents(transaction, `${packageId}::content::ContentVersionAppended`, trustedPackageIds)
  return events.map(parseContentVersionAppendedEvent)
}

function parseContentVersionDeletedEvent(event: Record<string, unknown>) {
  return {
    contentId: readObjectId(event.content_id, 'ContentVersionDeleted content_id'),
    soulId: readObjectId(event.soul_id, 'ContentVersionDeleted soul_id'),
    kind: readNumber(event.kind, 'ContentVersionDeleted kind'),
    kindName: readString(event.kind_name, 'ContentVersionDeleted kind_name'),
    name: readString(event.name, 'ContentVersionDeleted name'),
    versionIndex: readNumber(event.version_index, 'ContentVersionDeleted version_index'),
    deletedByAddress: readAddress(event.deleted_by, 'ContentVersionDeleted deleted_by'),
  }
}

export function extractContentVersionDeletedEvent(
  transaction: TransactionLike,
  packageId: string,
  trustedPackageIds?: string[],
) {
  const event = extractTypedEvent(transaction, `${packageId}::content::ContentVersionDeleted`, trustedPackageIds)
  if (!event) {
    throw new OnChainVerificationError('ContentVersionDeleted event is missing from the transaction')
  }
  return parseContentVersionDeletedEvent(event)
}

export function extractAllContentVersionDeletedEvents(
  transaction: TransactionLike,
  packageId: string,
  trustedPackageIds?: string[],
) {
  const events = extractAllTypedEvents(transaction, `${packageId}::content::ContentVersionDeleted`, trustedPackageIds)
  return events.map(parseContentVersionDeletedEvent)
}

function parseContentVersionPurgedEvent(event: Record<string, unknown>) {
  return {
    contentId: readObjectId(event.content_id, 'ContentVersionPurged content_id'),
    soulId: readObjectId(event.soul_id, 'ContentVersionPurged soul_id'),
    kind: readNumber(event.kind, 'ContentVersionPurged kind'),
    kindName: readString(event.kind_name, 'ContentVersionPurged kind_name'),
    name: readString(event.name, 'ContentVersionPurged name'),
    versionIndex: readNumber(event.version_index, 'ContentVersionPurged version_index'),
    purgedByAddress: readAddress(event.purged_by, 'ContentVersionPurged purged_by'),
  }
}

export function extractContentVersionPurgedEvent(
  transaction: TransactionLike,
  packageId: string,
  trustedPackageIds?: string[],
) {
  const event = extractTypedEvent(transaction, `${packageId}::content::ContentVersionPurged`, trustedPackageIds)
  if (!event) {
    throw new OnChainVerificationError('ContentVersionPurged event is missing from the transaction')
  }
  return parseContentVersionPurgedEvent(event)
}

export function extractAllContentVersionPurgedEvents(
  transaction: TransactionLike,
  packageId: string,
  trustedPackageIds?: string[],
) {
  const events = extractAllTypedEvents(transaction, `${packageId}::content::ContentVersionPurged`, trustedPackageIds)
  return events.map(parseContentVersionPurgedEvent)
}

/**
 * Parse the inner `ActiveBinding` struct nested inside `Option<ActiveBinding>`.
 * Mirrors `content.move::ActiveBinding { kind, name, version_index, download_policy }`.
 */
function parseActiveBindingPayload(value: Record<string, unknown>) {
  // The SDK may unwrap the struct directly or via a `fields` shim.
  const fields = (() => {
    const maybeFields = asRecord(value.fields)
    return maybeFields ?? value
  })()
  return {
    kind: readNumber(fields.kind, 'ActiveBinding kind'),
    name: readString(fields.name, 'ActiveBinding name'),
    versionIndex: readNumber(fields.version_index, 'ActiveBinding version_index'),
    downloadPolicy: mapDownloadPolicy(
      readNumber(fields.download_policy, 'ActiveBinding download_policy'),
      'ActiveBinding download_policy',
    ),
  }
}

/**
 * Read the `Option<ActiveBinding>` payload off an `ActiveBindingUpdated` event.
 * Returns `null` for `None` (`clear_active`) and the parsed binding for `Some`
 * (`set_active`). Walks the same Option shapes as `readOptionalBigInt` so the
 * SDK's varying serialisations all collapse to one path.
 */
function readOptionalActiveBinding(value: unknown, fieldName: string) {
  if (value == null) return null
  if (Array.isArray(value)) {
    if (value.length === 0) return null
    return readOptionalActiveBinding(value[0], fieldName)
  }
  const record = asRecord(value)
  if (!record) {
    throw new OnChainVerificationError(`${fieldName} is malformed on chain`)
  }
  if (Array.isArray(record.vec)) {
    return readOptionalActiveBinding(record.vec, fieldName)
  }
  if (record.value !== undefined) {
    return readOptionalActiveBinding(record.value, fieldName)
  }
  // Direct struct shape: { kind, name, version_index, download_policy }.
  if ('kind' in record && 'name' in record && 'version_index' in record && 'download_policy' in record) {
    return parseActiveBindingPayload(record)
  }
  // Wrapped struct shape: { fields: { ... } } — SDK unwraps to fields.
  if (asRecord(record.fields)) {
    return parseActiveBindingPayload(record)
  }
  throw new OnChainVerificationError(`${fieldName} is malformed on chain`)
}

function parseActiveBindingUpdatedEvent(event: Record<string, unknown>) {
  return {
    contentId: readObjectId(event.content_id, 'ActiveBindingUpdated content_id'),
    soulId: readObjectId(event.soul_id, 'ActiveBindingUpdated soul_id'),
    kind: readNumber(event.kind, 'ActiveBindingUpdated kind'),
    kindName: readString(event.kind_name, 'ActiveBindingUpdated kind_name'),
    binding: readOptionalActiveBinding(event.binding, 'ActiveBindingUpdated binding'),
    updaterAddress: readAddress(event.updater, 'ActiveBindingUpdated updater'),
  }
}

export function extractActiveBindingUpdatedEvent(
  transaction: TransactionLike,
  packageId: string,
  trustedPackageIds?: string[],
) {
  const event = extractTypedEvent(transaction, `${packageId}::content::ActiveBindingUpdated`, trustedPackageIds)
  if (!event) {
    throw new OnChainVerificationError('ActiveBindingUpdated event is missing from the transaction')
  }
  return parseActiveBindingUpdatedEvent(event)
}

export function extractAllActiveBindingUpdatedEvents(
  transaction: TransactionLike,
  packageId: string,
  trustedPackageIds?: string[],
) {
  const events = extractAllTypedEvents(transaction, `${packageId}::content::ActiveBindingUpdated`, trustedPackageIds)
  return events.map(parseActiveBindingUpdatedEvent)
}

// ── paid_access.move ──────────────────────────────────────────────────

function parseSoulPaidAccessListCreatedEvent(event: Record<string, unknown>) {
  return {
    paidAccessListId: readObjectId(event.paid_access_list_id, 'SoulPaidAccessListCreated paid_access_list_id'),
    soulId: readObjectId(event.soul_id, 'SoulPaidAccessListCreated soul_id'),
    creatorAddress: readAddress(event.creator, 'SoulPaidAccessListCreated creator'),
  }
}

export function extractSoulPaidAccessListCreatedEvent(
  transaction: TransactionLike,
  packageId: string,
  trustedPackageIds?: string[],
) {
  const event = extractTypedEvent(transaction, `${packageId}::paid_access::SoulPaidAccessListCreated`, trustedPackageIds)
  if (!event) {
    throw new OnChainVerificationError('SoulPaidAccessListCreated event is missing from the transaction')
  }
  return parseSoulPaidAccessListCreatedEvent(event)
}

export function tryExtractSoulPaidAccessListCreatedEvent(
  transaction: TransactionLike,
  packageId: string,
  trustedPackageIds?: string[],
) {
  const event = extractTypedEvent(transaction, `${packageId}::paid_access::SoulPaidAccessListCreated`, trustedPackageIds)
  if (!event) return null
  return parseSoulPaidAccessListCreatedEvent(event)
}

/**
 * Extracts every `SoulPaidAccessListCreated` event in emission order. Mint
 * PTBs emit one per soul. Caller pairs events to souls by `soulId`.
 */
export function extractAllSoulPaidAccessListCreatedEvents(
  transaction: TransactionLike,
  packageId: string,
  trustedPackageIds?: string[],
) {
  const events = extractAllTypedEvents(
    transaction,
    `${packageId}::paid_access::SoulPaidAccessListCreated`,
    trustedPackageIds,
  )
  return events.map(parseSoulPaidAccessListCreatedEvent)
}

function parseSoulPaidAccessKindConfiguredEvent(event: Record<string, unknown>) {
  return {
    soulId: readObjectId(event.soul_id, 'SoulPaidAccessKindConfigured soul_id'),
    paidAccessListId: readObjectId(
      event.paid_access_list_id,
      'SoulPaidAccessKindConfigured paid_access_list_id',
    ),
    kind: readNumber(event.kind, 'SoulPaidAccessKindConfigured kind'),
    priceAtomic: readBigInt(event.price_atomic, 'SoulPaidAccessKindConfigured price_atomic'),
    scopeMask: readNumber(event.scope_mask, 'SoulPaidAccessKindConfigured scope_mask'),
    durationMs: readOptionalBigInt(event.duration_ms, 'SoulPaidAccessKindConfigured duration_ms'),
    ownershipEpochSnapshot: readNumber(
      event.ownership_epoch_snapshot,
      'SoulPaidAccessKindConfigured ownership_epoch_snapshot',
    ),
  }
}

export function extractSoulPaidAccessKindConfiguredEvent(
  transaction: TransactionLike,
  packageId: string,
  trustedPackageIds?: string[],
) {
  const event = extractTypedEvent(transaction, `${packageId}::paid_access::SoulPaidAccessKindConfigured`, trustedPackageIds)
  if (!event) {
    throw new OnChainVerificationError('SoulPaidAccessKindConfigured event is missing from the transaction')
  }
  return parseSoulPaidAccessKindConfiguredEvent(event)
}

export function extractAllSoulPaidAccessKindConfiguredEvents(
  transaction: TransactionLike,
  packageId: string,
  trustedPackageIds?: string[],
) {
  const events = extractAllTypedEvents(
    transaction,
    `${packageId}::paid_access::SoulPaidAccessKindConfigured`,
    trustedPackageIds,
  )
  return events.map(parseSoulPaidAccessKindConfiguredEvent)
}

export function extractSoulPaidAccessKindUpdatedEvent(
  transaction: TransactionLike,
  packageId: string,
  trustedPackageIds?: string[],
) {
  const event = extractTypedEvent(transaction, `${packageId}::paid_access::SoulPaidAccessKindUpdated`, trustedPackageIds)
  if (!event) {
    throw new OnChainVerificationError('SoulPaidAccessKindUpdated event is missing from the transaction')
  }
  return {
    soulId: readObjectId(event.soul_id, 'SoulPaidAccessKindUpdated soul_id'),
    paidAccessListId: readObjectId(
      event.paid_access_list_id,
      'SoulPaidAccessKindUpdated paid_access_list_id',
    ),
    kind: readNumber(event.kind, 'SoulPaidAccessKindUpdated kind'),
    oldPriceAtomic: readBigInt(event.old_price_atomic, 'SoulPaidAccessKindUpdated old_price_atomic'),
    newPriceAtomic: readBigInt(event.new_price_atomic, 'SoulPaidAccessKindUpdated new_price_atomic'),
    oldScopeMask: readNumber(event.old_scope_mask, 'SoulPaidAccessKindUpdated old_scope_mask'),
    newScopeMask: readNumber(event.new_scope_mask, 'SoulPaidAccessKindUpdated new_scope_mask'),
    oldDurationMs: readOptionalBigInt(event.old_duration_ms, 'SoulPaidAccessKindUpdated old_duration_ms'),
    newDurationMs: readOptionalBigInt(event.new_duration_ms, 'SoulPaidAccessKindUpdated new_duration_ms'),
    ownershipEpochSnapshot: readNumber(
      event.ownership_epoch_snapshot,
      'SoulPaidAccessKindUpdated ownership_epoch_snapshot',
    ),
  }
}

export function extractSoulPaidAccessKindDeletedEvent(
  transaction: TransactionLike,
  packageId: string,
  trustedPackageIds?: string[],
) {
  const event = extractTypedEvent(transaction, `${packageId}::paid_access::SoulPaidAccessKindDeleted`, trustedPackageIds)
  if (!event) {
    throw new OnChainVerificationError('SoulPaidAccessKindDeleted event is missing from the transaction')
  }
  return {
    soulId: readObjectId(event.soul_id, 'SoulPaidAccessKindDeleted soul_id'),
    paidAccessListId: readObjectId(
      event.paid_access_list_id,
      'SoulPaidAccessKindDeleted paid_access_list_id',
    ),
    kind: readNumber(event.kind, 'SoulPaidAccessKindDeleted kind'),
  }
}

function parseSoulPaidAccessGrantedEvent(event: Record<string, unknown>) {
  return {
    soulId: readObjectId(event.soul_id, 'SoulPaidAccessGranted soul_id'),
    paidAccessListId: readObjectId(
      event.paid_access_list_id,
      'SoulPaidAccessGranted paid_access_list_id',
    ),
    granteeAddress: readAddress(event.grantee, 'SoulPaidAccessGranted grantee'),
    kind: readNumber(event.kind, 'SoulPaidAccessGranted kind'),
    scopeMask: readNumber(event.scope_mask, 'SoulPaidAccessGranted scope_mask'),
    pricePaidAtomic: readBigInt(event.price_paid_atomic, 'SoulPaidAccessGranted price_paid_atomic'),
    expiresAtMs: readOptionalBigInt(event.expires_at_ms, 'SoulPaidAccessGranted expires_at_ms'),
    ownershipEpochSnapshot: readNumber(
      event.ownership_epoch_snapshot,
      'SoulPaidAccessGranted ownership_epoch_snapshot',
    ),
  }
}

export function extractSoulPaidAccessGrantedEvent(
  transaction: TransactionLike,
  packageId: string,
  trustedPackageIds?: string[],
) {
  const event = extractTypedEvent(transaction, `${packageId}::paid_access::SoulPaidAccessGranted`, trustedPackageIds)
  if (!event) {
    throw new OnChainVerificationError('SoulPaidAccessGranted event is missing from the transaction')
  }
  return parseSoulPaidAccessGrantedEvent(event)
}

export function extractAllSoulPaidAccessGrantedEvents(
  transaction: TransactionLike,
  packageId: string,
  trustedPackageIds?: string[],
) {
  const events = extractAllTypedEvents(
    transaction,
    `${packageId}::paid_access::SoulPaidAccessGranted`,
    trustedPackageIds,
  )
  return events.map(parseSoulPaidAccessGrantedEvent)
}

export function extractSoulPaidAccessRevokedEvent(
  transaction: TransactionLike,
  packageId: string,
  trustedPackageIds?: string[],
) {
  const event = extractTypedEvent(transaction, `${packageId}::paid_access::SoulPaidAccessRevoked`, trustedPackageIds)
  if (!event) {
    throw new OnChainVerificationError('SoulPaidAccessRevoked event is missing from the transaction')
  }
  return {
    soulId: readObjectId(event.soul_id, 'SoulPaidAccessRevoked soul_id'),
    paidAccessListId: readObjectId(
      event.paid_access_list_id,
      'SoulPaidAccessRevoked paid_access_list_id',
    ),
    granteeAddress: readAddress(event.grantee, 'SoulPaidAccessRevoked grantee'),
    kind: readNumber(event.kind, 'SoulPaidAccessRevoked kind'),
  }
}

// ── collection.move / market.move (collection) ────────────────────────

function parseSoulAddedToCollectionEvent(event: Record<string, unknown>) {
  return {
    collectionId: readObjectId(event.collection_id, 'SoulAddedToCollection collection_id'),
    soulId: readObjectId(event.soul_id, 'SoulAddedToCollection soul_id'),
    currentSupply: readBigInt(event.current_supply, 'SoulAddedToCollection current_supply'),
    maxSupply: readOptionalBigInt(event.max_supply, 'SoulAddedToCollection max_supply'),
  }
}

export function extractSoulAddedToCollectionEvent(transaction: TransactionLike, packageId: string, trustedPackageIds?: string[]) {
  const event = extractTypedEvent(transaction, `${packageId}::collection::SoulAddedToCollection`, trustedPackageIds)
  if (!event) {
    throw new OnChainVerificationError('SoulAddedToCollection event is missing from the transaction')
  }
  return parseSoulAddedToCollectionEvent(event)
}

/**
 * Extracts every `SoulAddedToCollection` event in emission order. Used when
 * one PTB chains N add_soul calls — caller pairs each event with the
 * corresponding soul by `soulId`.
 */
export function extractAllSoulAddedToCollectionEvents(transaction: TransactionLike, packageId: string, trustedPackageIds?: string[]) {
  const events = extractAllTypedEvents(transaction, `${packageId}::collection::SoulAddedToCollection`, trustedPackageIds)
  return events.map(parseSoulAddedToCollectionEvent)
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

function parseCollectionListedEvent(event: Record<string, unknown>) {
  return {
    listingId: readObjectId(event.listing_id, 'CollectionListed listing_id'),
    collectionId: readObjectId(event.collection_id, 'CollectionListed collection_id'),
    rightId: readObjectId(event.right_id, 'CollectionListed right_id'),
    sellerAddress: readAddress(event.seller, 'CollectionListed seller'),
    kioskId: readObjectId(event.kiosk_id, 'CollectionListed kiosk_id'),
    priceAtomic: readBigInt(event.price, 'CollectionListed price'),
  }
}

/**
 * Extracts every `CollectionListed` event in emission order. Used when one
 * PTB combines create_collection + list_collection_right (collection
 * launch fast path), so a mirror route must filter by `collectionId`
 * rather than picking the first event in the digest.
 */
export function extractAllCollectionListedEvents(transaction: TransactionLike, packageId: string, trustedPackageIds?: string[]) {
  const events = extractAllTypedEvents(transaction, `${packageId}::market::CollectionListed`, trustedPackageIds)
  return events.map(parseCollectionListedEvent)
}

export function extractCollectionListedEvent(transaction: TransactionLike, packageId: string, trustedPackageIds?: string[]) {
  const event = extractTypedEvent(transaction, `${packageId}::market::CollectionListed`, trustedPackageIds)
  if (!event) {
    throw new OnChainVerificationError('CollectionListed event is missing from the transaction')
  }
  return parseCollectionListedEvent(event)
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

// ── grant.move ────────────────────────────────────────────────────────

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

// ── Helpers (unchanged) ───────────────────────────────────────────────

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
