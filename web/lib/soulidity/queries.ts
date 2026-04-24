import { normalizeWalrusBlobId } from '@/lib/services/walrus'
import { suiClient } from '@/lib/sui'
import { isValidSuiAddress, normalizeSuiAddress } from '@mysten/sui/utils'
import { SOUL_GRANT_SCOPE_BITS } from '@/lib/soulidity/grant-scopes'
import type {
  ActiveGrantSlotObject,
  ResolvedPersonalKiosk,
  SoulCollectionObject,
  SoulCollectionRightObject,
  SoulGrantObject,
  SoulGrantScope,
  SoulDownloadPolicy,
  SoulMemoryObject,
  SoulMetadataBindingRecord,
  SoulMetadataObject,
  SoulObject,
  SoulProvenanceKind,
  SoulSkillVisibility,
  SoulSkillsObject,
  SoulStateObject,
  SoulidityMarketConfig,
} from '@/lib/soulidity/types'

type TransactionLike = {
  digest?: string
  effects?: { status?: { status?: string | null } | null } | null
  events?: Array<{ type?: unknown; parsedJson?: unknown }> | null
  transaction?: {
    data?: {
      sender?: unknown
    }
  } | null
}

type ObjectLike = {
  data?: {
    objectId?: unknown
    type?: unknown
    owner?: unknown
    content?: {
      dataType?: unknown
      type?: unknown
      fields?: unknown
    } | null
  } | null
}

const MAX_BPS = 10_000n
const MAX_U64 = 18_446_744_073_709_551_615n
const OPTIONAL_VECTOR_MAX_DEPTH = 4
const KIOSK_PACKAGE_ENV_KEY = 'NEXT_PUBLIC_KIOSK_PACKAGE_ID'
const MAX_KIOSK_CAP_PAGES = 5

export class OnChainVerificationError extends Error {
  constructor(message: string, readonly status = 422) {
    super(message)
    this.name = 'OnChainVerificationError'
  }
}

function isMissingObjectResponse(response: { data?: unknown; error?: { code?: string; error?: string; message?: string } | null }) {
  if (!response.data) {
    return true
  }

  const errorCode = response.error?.code ?? ''
  const errorMessage = [response.error?.error, response.error?.message, errorCode].filter(Boolean).join(' ')
  return /not.?exist|not.?found|requested entity was not found/i.test(errorMessage)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

export function normalizeSuiValue(value: string): string | null {
  const trimmed = value.trim()
  try {
    const normalized = normalizeSuiAddress(trimmed).toLowerCase()
    return isValidSuiAddress(normalized) ? normalized : null
  } catch {
    return null
  }
}

export function sameSuiValue(left: string | null | undefined, right: string | null | undefined) {
  if (!left || !right) return false
  const normalizedLeft = normalizeSuiValue(left)
  const normalizedRight = normalizeSuiValue(right)
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight)
}

function normalizePackageId(value: string) {
  const normalized = normalizeSuiValue(value)
  if (!normalized) {
    throw new OnChainVerificationError('Package address is malformed')
  }
  return normalized
}

function readPackageIdFromType(type: string): string | null {
  const packageId = type.split('::', 1)[0]
  return packageId ? normalizeSuiValue(packageId) : null
}

function readString(value: unknown, fieldName: string): string {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim()
  }

  const record = asRecord(value)
  if (record && typeof record.id === 'string' && record.id.trim().length > 0) {
    return record.id.trim()
  }

  throw new OnChainVerificationError(`${fieldName} is missing on chain`)
}

function readAddress(value: unknown, fieldName: string): string {
  const normalized = typeof value === 'string' ? normalizeSuiValue(value) : null
  if (!normalized) {
    throw new OnChainVerificationError(`${fieldName} is malformed on chain`)
  }
  return normalized
}

function readObjectId(value: unknown, fieldName: string): string {
  const record = asRecord(value)
  if (record) {
    if (typeof record.id === 'string') {
      return readAddress(record.id, fieldName)
    }
    if (typeof record.bytes === 'string') {
      return readAddress(record.bytes, fieldName)
    }
    if (record.value) {
      return readObjectId(record.value, fieldName)
    }
  }

  return readAddress(value, fieldName)
}

function readBigInt(value: unknown, fieldName: string): bigint {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number' && Number.isFinite(value)) {
    const truncatedValue = Math.trunc(value)
    if (!Number.isSafeInteger(truncatedValue) || truncatedValue < 0) {
      throw new OnChainVerificationError(`${fieldName} is out of range on chain`)
    }
    return BigInt(truncatedValue)
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return BigInt(value.trim())
  }
  throw new OnChainVerificationError(`${fieldName} is missing on chain`)
}

function readNumber(value: unknown, fieldName: string) {
  const asBigInt = readBigInt(value, fieldName)
  if (asBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new OnChainVerificationError(`${fieldName} exceeds the supported range on chain`)
  }
  return Number(asBigInt)
}

function readOptionalVectorValue(value: unknown, fieldName: string, depth = 0): string | null {
  if (depth > OPTIONAL_VECTOR_MAX_DEPTH) {
    throw new OnChainVerificationError(`${fieldName} nesting exceeds the supported depth`)
  }

  if (value == null) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return null
    if (value.length !== 1) {
      throw new OnChainVerificationError(`${fieldName} is malformed on chain`)
    }
    return readOptionalVectorValue(value[0], fieldName, depth + 1)
  }

  const record = asRecord(value)
  if (!record) {
    throw new OnChainVerificationError(`${fieldName} is malformed on chain`)
  }
  if (Array.isArray(record.vec)) {
    return readOptionalVectorValue(record.vec, fieldName, depth + 1)
  }
  if (record.value) {
    return readOptionalVectorValue(record.value, fieldName, depth + 1)
  }
  if (record.fields) {
    return readOptionalVectorValue(record.fields, fieldName, depth + 1)
  }

  return null
}

function readOptionalString(value: unknown, fieldName: string): string | null {
  const resolved = readOptionalVectorValue(value, fieldName)
  return resolved?.trim() || null
}

function readOptionalAddress(value: unknown, fieldName: string): string | null {
  const resolved = readOptionalVectorValue(value, fieldName)
  if (!resolved) return null
  return readAddress(resolved, fieldName)
}

function readOptionalNumber(value: unknown, fieldName: string): number | null {
  const resolved = readOptionalVectorValue(value, fieldName)
  if (!resolved) return null
  return readNumber(resolved, fieldName)
}

function readVectorItems(value: unknown, fieldName: string, depth = 0): unknown[] {
  if (depth > OPTIONAL_VECTOR_MAX_DEPTH) {
    throw new OnChainVerificationError(`${fieldName} nesting exceeds the supported depth`)
  }
  if (value == null) return []
  if (Array.isArray(value)) return value

  const record = asRecord(value)
  if (!record) {
    throw new OnChainVerificationError(`${fieldName} is malformed on chain`)
  }
  if (Array.isArray(record.vec)) {
    return record.vec
  }
  if (record.value) {
    return readVectorItems(record.value, fieldName, depth + 1)
  }
  if (record.fields) {
    return readVectorItems(record.fields, fieldName, depth + 1)
  }

  return []
}

function readStructFields(value: unknown, fieldName: string): Record<string, unknown> {
  const record = asRecord(value)
  if (!record) {
    throw new OnChainVerificationError(`${fieldName} is malformed on chain`)
  }
  const nested = asRecord(record.fields)
  return nested ?? record
}

function readObjectIdVector(value: unknown, fieldName: string): string[] {
  return readVectorItems(value, fieldName).map((item, index) =>
    readObjectId(item, `${fieldName}[${index}]`),
  )
}

function readNestedObjectId(value: unknown, fieldName: string, depth = 0): string | null {
  if (depth > OPTIONAL_VECTOR_MAX_DEPTH) {
    throw new OnChainVerificationError(`${fieldName} nesting exceeds the supported depth`)
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    return readObjectId(value, fieldName)
  }

  const record = asRecord(value)
  if (!record) return null
  // Check `for` before `id` — KioskOwnerCap has both `for` (target kiosk ID)
  // and `id` (cap UID). The caller wants `for` when it exists.
  if ('for' in record) {
    return readObjectId(record.for, fieldName)
  }
  if ('id' in record && typeof record.id === 'string') {
    return readObjectId(record.id, fieldName)
  }
  if ('id' in record && record.id) {
    const nestedId = readNestedObjectId(record.id, fieldName, depth + 1)
    if (nestedId) {
      return nestedId
    }
  }
  if ('bytes' in record && typeof record.bytes === 'string') {
    return readObjectId(record.bytes, fieldName)
  }
  if (record.fields) {
    return readNestedObjectId(record.fields, fieldName, depth + 1)
  }
  if (Array.isArray(record.vec)) {
    if (record.vec.length === 0) return null
    if (record.vec.length !== 1) {
      throw new OnChainVerificationError(`${fieldName} is malformed on chain`)
    }
    return readNestedObjectId(record.vec[0], fieldName, depth + 1)
  }
  if (record.value) {
    return readNestedObjectId(record.value, fieldName, depth + 1)
  }
  return null
}

function readWalrusBlobId(value: unknown, fieldName: string): string | null {
  const record = asRecord(value)
  if (record) {
    if (typeof record.blob_id === 'string') {
      return normalizeWalrusBlobId(record.blob_id)
    }
    if (typeof record.blobId === 'string') {
      return normalizeWalrusBlobId(record.blobId)
    }
    if (record.fields) {
      return readWalrusBlobId(record.fields, fieldName)
    }
  }

  const normalized = typeof value === 'string' ? normalizeWalrusBlobId(value) : null
  if (normalized == null && value != null) {
    return null
  }
  return normalized
}

/**
 * Read a Walrus Blob object on-chain and return its blob_id (content hash).
 * Returns null if the object doesn't have a parseable blob_id field.
 */
export async function resolveWalrusBlobId(blobObjectId: string): Promise<string | null> {
  const response = await suiClient.getObject({
    id: blobObjectId,
    options: { showContent: true },
  })
  const content = response.data?.content
  if (!content || content.dataType !== 'moveObject') return null
  const fields = (content as { fields?: unknown }).fields
  return readWalrusBlobId(fields, 'Walrus Blob blob_id')
}

function getObjectOwnerKind(owner: unknown): 'address' | 'object' | 'shared' | 'immutable' | 'unknown' {
  const ownerRecord = asRecord(owner)
  if (!ownerRecord) return 'unknown'
  if (typeof ownerRecord.AddressOwner === 'string') return 'address'
  if (typeof ownerRecord.ObjectOwner === 'string') return 'object'
  if (ownerRecord.Shared) return 'shared'
  if (ownerRecord.Immutable) return 'immutable'
  return 'unknown'
}

function getObjectOwnerAddress(owner: unknown): string | null {
  const ownerRecord = asRecord(owner)
  if (!ownerRecord || typeof ownerRecord.AddressOwner !== 'string') return null
  return readAddress(ownerRecord.AddressOwner, 'Object owner')
}

function getObjectOwnerObjectId(owner: unknown): string | null {
  const ownerRecord = asRecord(owner)
  if (!ownerRecord || typeof ownerRecord.ObjectOwner !== 'string') return null
  return readObjectId(ownerRecord.ObjectOwner, 'Object owner object')
}

function typeMatchesPrefix(type: string, expectedTypePrefix: string) {
  if (type.startsWith(expectedTypePrefix)) return true
  const suffix = expectedTypePrefix.replace(/^0x[0-9a-fA-F]+/, '')
  return type.endsWith(suffix)
}

function expectMoveObject(response: ObjectLike, objectId: string, expectedTypePrefix: string) {
  const object = response.data
  if (!object || typeof object.objectId !== 'string' || object.objectId !== objectId) {
    throw new OnChainVerificationError('On-chain object was not found')
  }
  if (typeof object.type !== 'string' || !typeMatchesPrefix(object.type, expectedTypePrefix)) {
    throw new OnChainVerificationError('On-chain object type does not match the expected package')
  }
  const content = object.content
  if (!content || content.dataType !== 'moveObject' || typeof content.type !== 'string' || !typeMatchesPrefix(content.type, expectedTypePrefix)) {
    throw new OnChainVerificationError('On-chain object content is not a move object')
  }
  const fields = asRecord(content.fields)
  if (!fields) {
    throw new OnChainVerificationError('On-chain object fields are missing')
  }
  return {
    object,
    fields,
    packageId: readPackageIdFromType(content.type) ?? normalizePackageId(expectedTypePrefix.split('::', 1)[0] ?? expectedTypePrefix),
  }
}

export function getVendoredKioskPackageAddress() {
  const configuredPackageAddress = process.env[KIOSK_PACKAGE_ENV_KEY]?.trim()
  if (!configuredPackageAddress) {
    throw new Error(`${KIOSK_PACKAGE_ENV_KEY} must be set`)
  }

  const normalized = normalizeSuiValue(configuredPackageAddress)
  if (!normalized) {
    throw new Error(`${KIOSK_PACKAGE_ENV_KEY} contains an invalid kiosk package address`)
  }
  return normalized
}

export function getTrustedPackageIds(...packageIds: Array<string | null | undefined>) {
  const trustedPackageIds = new Set<string>()
  for (const packageId of packageIds) {
    if (typeof packageId !== 'string' || packageId.trim().length === 0) continue
    trustedPackageIds.add(normalizePackageId(packageId))
  }
  return [...trustedPackageIds]
}

export function ensureTransactionSucceeded(transaction: TransactionLike) {
  if (transaction.effects?.status?.status !== 'success') {
    throw new OnChainVerificationError('On-chain transaction did not succeed')
  }
}

export async function getSuccessfulTransactionBlock(txDigest: string) {
  const transaction = await suiClient.getTransactionBlock({
    digest: txDigest,
    options: {
      showEffects: true,
      showEvents: true,
      showInput: true,
      showObjectChanges: true,
    },
  })

  ensureTransactionSucceeded(transaction)
  return transaction
}

export function readTransactionSender(transaction: TransactionLike | null | undefined) {
  if (typeof transaction?.transaction?.data?.sender !== 'string') return null
  return normalizeSuiValue(transaction.transaction.data.sender)
}

export async function waitForTransactionBestEffort(digest: string) {
  try {
    await suiClient.waitForTransaction({ digest })
  } catch (error) {
    console.warn('[sui] Transaction confirmation polling failed', { digest, error })
  }
}

export async function getMarketConfig(configId: string, packageId: string): Promise<SoulidityMarketConfig> {
  const response = await suiClient.getObject({
    id: configId,
    options: {
      showContent: true,
      showType: true,
    },
  })
  const expectedTypePrefix = `${normalizePackageId(packageId)}::market::MarketConfig`
  const { fields, packageId: resolvedPackageId } = expectMoveObject(response, configId, expectedTypePrefix)
  return {
    objectId: configId,
    packageId: resolvedPackageId,
    feeRecipient: readAddress(fields.fee_recipient, 'MarketConfig fee_recipient'),
    platformFeeBps: readNumber(fields.platform_fee_bps, 'MarketConfig platform_fee_bps'),
    paused: Boolean(fields.paused),
  }
}

function bpsAmount(price: bigint, bps: bigint) {
  return (price * bps) / MAX_BPS
}

export function quoteSoulPurchase(config: SoulidityMarketConfig, params: {
  priceAtomic: bigint
  creatorRoyaltyBps: number
  collectionRoyaltyBps: number
}) {
  const platformFee = bpsAmount(params.priceAtomic, BigInt(config.platformFeeBps))
  const creatorRoyalty = bpsAmount(params.priceAtomic, BigInt(params.creatorRoyaltyBps))
  const collectionRoyalty = bpsAmount(params.priceAtomic, BigInt(params.collectionRoyaltyBps))
  const total = params.priceAtomic + platformFee + creatorRoyalty + collectionRoyalty
  if (total > MAX_U64) {
    throw new OnChainVerificationError('Soul purchase quote exceeds the supported range')
  }

  return {
    platformFeeAtomic: platformFee.toString(),
    priceAtomic: params.priceAtomic.toString(),
    creatorRoyaltyAtomic: creatorRoyalty.toString(),
    collectionRoyaltyAtomic: collectionRoyalty.toString(),
    totalAtomic: total.toString(),
  }
}

export function quoteCollectionPurchase(config: SoulidityMarketConfig, params: {
  priceAtomic: bigint
}) {
  const platformFee = bpsAmount(params.priceAtomic, BigInt(config.platformFeeBps))
  const total = params.priceAtomic + platformFee
  if (total > MAX_U64) {
    throw new OnChainVerificationError('Collection purchase quote exceeds the supported range')
  }

  return {
    platformFeeAtomic: platformFee.toString(),
    priceAtomic: params.priceAtomic.toString(),
    totalAtomic: total.toString(),
  }
}

function readSoulProvenanceKind(value: unknown, fieldName: string): SoulProvenanceKind {
  const rawValue = readNumber(value, fieldName)
  if (rawValue === 1) return 'imported'
  if (rawValue === 2) return 'personal-join'
  return 'native'
}

function readWriterKind(value: unknown, fieldName: string) {
  const rawValue = readNumber(value, fieldName)
  if (rawValue === 0) return 'founder' as const
  if (rawValue === 2) return 'granted-agent' as const
  return 'owner' as const
}

export function scopeMaskToScopes(scopeMask: number): SoulGrantScope[] {
  return SOUL_GRANT_SCOPE_BITS
    .filter(({ mask }) => (scopeMask & mask) === mask)
    .map(({ scope }) => scope)
}

function readSkillVisibility(value: unknown, fieldName: string): SoulSkillVisibility {
  return Boolean(value) ? 'public' : 'private'
}

function readSoulDownloadPolicy(value: unknown, fieldName: string): SoulDownloadPolicy {
  const rawValue = readNumber(value, fieldName)
  if (rawValue === 0) return 'public'
  if (rawValue === 1) return 'owner_only'
  if (rawValue === 2) return 'allowlist'
  throw new OnChainVerificationError(`${fieldName} contains an unknown download policy`)
}

function readOptionalMetadataBinding(value: unknown, fieldName: string): SoulMetadataBindingRecord | null {
  const directRecord = asRecord(value)
  const directFields = directRecord ? asRecord(directRecord.fields) ?? directRecord : null
  if (
    directFields
    && 'asset_name' in directFields
    && 'version_index' in directFields
    && 'download_policy' in directFields
  ) {
    return {
      assetName: readString(directFields.asset_name, `${fieldName}.asset_name`),
      versionIndex: readNumber(directFields.version_index, `${fieldName}.version_index`),
      downloadPolicy: readSoulDownloadPolicy(directFields.download_policy, `${fieldName}.download_policy`),
    }
  }

  const items = readVectorItems(value, fieldName)
  if (items.length === 0) {
    return null
  }
  const fields = readStructFields(items[0], `${fieldName}[0]`)
  return {
    assetName: readString(fields.asset_name, `${fieldName}.asset_name`),
    versionIndex: readNumber(fields.version_index, `${fieldName}.version_index`),
    downloadPolicy: readSoulDownloadPolicy(fields.download_policy, `${fieldName}.download_policy`),
  }
}

function readUtf8StringFromBytes(value: unknown, fieldName: string): string | null {
  if (typeof value === 'string') {
    return value
  }
  if (Array.isArray(value)) {
    if (value.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)) {
      return new TextDecoder().decode(Uint8Array.from(value as number[]))
    }
    if (value.length === 1) {
      return readUtf8StringFromBytes(value[0], fieldName)
    }
    throw new OnChainVerificationError(`${fieldName} is malformed on chain`)
  }

  const record = asRecord(value)
  if (!record) {
    return null
  }
  if (Array.isArray(record.vec)) {
    return readUtf8StringFromBytes(record.vec, fieldName)
  }
  if (Array.isArray(record.contents)) {
    return readUtf8StringFromBytes(record.contents, fieldName)
  }
  if (record.value != null) {
    return readUtf8StringFromBytes(record.value, fieldName)
  }
  if (record.fields != null) {
    return readUtf8StringFromBytes(record.fields, fieldName)
  }
  if (typeof record.bytes === 'string') {
    return record.bytes
  }
  return null
}

export async function getSoulObject(objectId: string, packageId: string): Promise<SoulObject> {
  const response = await suiClient.getObject({
    id: objectId,
    options: {
      showContent: true,
      showType: true,
    },
  })
  const expectedTypePrefix = `${normalizePackageId(packageId)}::soul::Soul`
  const { fields, packageId: resolvedPackageId } = expectMoveObject(response, objectId, expectedTypePrefix)

  return {
    objectId,
    packageId: resolvedPackageId,
    creatorAddress: readAddress(fields.creator, 'Soul creator'),
    name: readString(fields.name, 'Soul name'),
    description: readString(fields.description, 'Soul description'),
    imageUrl: readString(fields.image_url, 'Soul image_url'),
    protectedBlobId: readWalrusBlobId(fields.protected_blob, 'Soul protected_blob'),
    protectedBlobObjectId: readNestedObjectId(fields.protected_blob, 'Soul protected_blob') ?? objectId,
    provenanceKind: readSoulProvenanceKind(fields.provenance_kind, 'Soul provenance_kind'),
    originRef: readOptionalString(fields.origin_ref, 'Soul origin_ref'),
  }
}

export async function getSoulStateObject(objectId: string, packageId: string): Promise<SoulStateObject> {
  const response = await suiClient.getObject({
    id: objectId,
    options: {
      showContent: true,
      showType: true,
    },
  })
  const expectedTypePrefix = `${normalizePackageId(packageId)}::soul::SoulState`
  const { fields, packageId: resolvedPackageId } = expectMoveObject(response, objectId, expectedTypePrefix)
  const activeGrants: ActiveGrantSlotObject[] = readVectorItems(fields.active_grants, 'SoulState active_grants').map((item, index) => {
    const slot = readStructFields(item, `SoulState active_grants[${index}]`)
    const scopeMask = readNumber(slot.scope_mask, `SoulState active_grants[${index}].scope_mask`)
    return {
      grantId: readObjectId(slot.grant_id, `SoulState active_grants[${index}].grant_id`),
      granteeAddress: readAddress(slot.grantee, `SoulState active_grants[${index}].grantee`),
      scopeMask,
      scopes: scopeMaskToScopes(scopeMask),
      expiresAtMs: readOptionalNumber(slot.expires_at_ms, `SoulState active_grants[${index}].expires_at_ms`),
    }
  })
  return {
    objectId,
    packageId: resolvedPackageId,
    soulId: readObjectId(fields.soul_id, 'SoulState soul_id'),
    creatorAddress: readAddress(fields.creator, 'SoulState creator'),
    creatorRoyaltyBps: readNumber(fields.creator_royalty_bps, 'SoulState creator_royalty_bps'),
    currentOwnerAddress: readAddress(fields.current_owner, 'SoulState current_owner'),
    currentKioskId: readObjectId(fields.current_kiosk_id, 'SoulState current_kiosk_id'),
    ownershipEpoch: readNumber(fields.ownership_epoch, 'SoulState ownership_epoch'),
    grantCapacity: readNumber(fields.grant_capacity, 'SoulState grant_capacity'),
    activeGrantCount: activeGrants.length,
    activeGrants,
    memoryId: readNestedObjectId(fields.memory_id, 'SoulState memory_id'),
    metadataId: readNestedObjectId(fields.metadata_id, 'SoulState metadata_id'),
    skillsId: readNestedObjectId(fields.skills_id, 'SoulState skills_id'),
    assetsId: readNestedObjectId(fields.assets_id, 'SoulState assets_id'),
    accessListId: readNestedObjectId(fields.access_list_id, 'SoulState access_list_id'),
    collectionId: readOptionalString(fields.collection_id, 'SoulState collection_id'),
  }
}

const MOVE_STRING_TYPE = '0x1::string::String'
const SPRITE_CONFIG_METADATA_KEY = 'sprite.config.v1'
const SPRITE_MOOD_MAP_METADATA_KEY = 'sprite.mood_map.v1'
const VOICE_CONFIG_METADATA_KEY = 'voice.config.v1'

async function getOptionalMetadataBlobValue(parentId: string, key: string): Promise<string | null> {
  try {
    const response = await suiClient.getDynamicFieldObject({
      parentId,
      name: {
        type: MOVE_STRING_TYPE,
        value: key,
      },
    })
    const content = response.data?.content
    const fields = content && 'fields' in content ? (content.fields as unknown) : null
    const record = asRecord(fields)
    const rawValue = record?.value ?? record?.fields ?? fields
    return readUtf8StringFromBytes(rawValue, `SoulMetadata ext ${key}`)
  } catch (error) {
    if (isDynamicFieldNotFound(error)) {
      return null
    }
    throw error
  }
}

export async function getSoulMetadataObject(objectId: string, packageId: string): Promise<SoulMetadataObject> {
  const response = await suiClient.getObject({
    id: objectId,
    options: {
      showContent: true,
      showType: true,
    },
  })
  const expectedTypePrefix = `${normalizePackageId(packageId)}::metadata::SoulMetadata`
  const { fields, packageId: resolvedPackageId } = expectMoveObject(response, objectId, expectedTypePrefix)
  const extTableId =
    readNestedObjectId(fields.ext, 'SoulMetadata ext')
    ?? readObjectId(fields.ext, 'SoulMetadata ext')

  const [spriteConfigJson, spriteMoodMapJson, voiceConfigJson] = await Promise.all([
    getOptionalMetadataBlobValue(extTableId, SPRITE_CONFIG_METADATA_KEY),
    getOptionalMetadataBlobValue(extTableId, SPRITE_MOOD_MAP_METADATA_KEY),
    getOptionalMetadataBlobValue(extTableId, VOICE_CONFIG_METADATA_KEY),
  ])

  return {
    objectId,
    packageId: resolvedPackageId,
    soulId: readObjectId(fields.soul_id, 'SoulMetadata soul_id'),
    activeSprite: readOptionalMetadataBinding(fields.active_sprite, 'SoulMetadata active_sprite'),
    activeVoice: readOptionalMetadataBinding(fields.active_voice, 'SoulMetadata active_voice'),
    extTableId,
    spriteConfigJson,
    spriteMoodMapJson,
    voiceConfigJson,
  }
}

export async function getSoulCollectionObject(objectId: string, packageId: string): Promise<SoulCollectionObject> {
  const response = await suiClient.getObject({
    id: objectId,
    options: {
      showContent: true,
      showType: true,
    },
  })
  const expectedTypePrefix = `${normalizePackageId(packageId)}::collection::SoulCollection`
  const { fields, packageId: resolvedPackageId } = expectMoveObject(response, objectId, expectedTypePrefix)
  return {
    objectId,
    packageId: resolvedPackageId,
    creatorAddress: readAddress(fields.creator, 'SoulCollection creator'),
    extraRoyaltyBps: readNumber(fields.extra_royalty_bps, 'SoulCollection extra_royalty_bps'),
    tradeable: Boolean(fields.tradeable),
    currentHolderAddress: readAddress(fields.current_holder, 'SoulCollection current_holder'),
    currentHolderKioskId: readObjectId(fields.current_holder_kiosk_id, 'SoulCollection current_holder_kiosk_id'),
    rightId: readObjectId(fields.right_id, 'SoulCollection right_id'),
  }
}

export async function getSoulCollectionRightObject(objectId: string, packageId: string): Promise<SoulCollectionRightObject> {
  const response = await suiClient.getObject({
    id: objectId,
    options: {
      showContent: true,
      showType: true,
    },
  })
  const expectedTypePrefix = `${normalizePackageId(packageId)}::collection::SoulCollectionRight`
  const { fields, packageId: resolvedPackageId } = expectMoveObject(response, objectId, expectedTypePrefix)
  return {
    objectId,
    packageId: resolvedPackageId,
    collectionId: readObjectId(fields.collection_id, 'SoulCollectionRight collection_id'),
    creatorAddress: readAddress(fields.creator, 'SoulCollectionRight creator'),
    name: readString(fields.name, 'SoulCollectionRight name'),
    description: readString(fields.description, 'SoulCollectionRight description'),
    imageUrl: readString(fields.image_url, 'SoulCollectionRight image_url'),
    extraRoyaltyBps: readNumber(fields.extra_royalty_bps, 'SoulCollectionRight extra_royalty_bps'),
    tradeable: Boolean(fields.tradeable),
  }
}

export async function getSoulGrantObject(objectId: string, packageId: string): Promise<SoulGrantObject> {
  const response = await suiClient.getObject({
    id: objectId,
    options: {
      showContent: true,
      showType: true,
    },
  })
  const expectedTypePrefix = `${normalizePackageId(packageId)}::grant::SoulGrant`
  const { fields, packageId: resolvedPackageId } = expectMoveObject(response, objectId, expectedTypePrefix)
  return {
    objectId,
    packageId: resolvedPackageId,
    soulId: readObjectId(fields.soul_id, 'SoulGrant soul_id'),
    granteeAddress: readAddress(fields.grantee, 'SoulGrant grantee'),
    issuedByAddress: readAddress(fields.issued_by, 'SoulGrant issued_by'),
    ownershipEpochSnapshot: readNumber(fields.ownership_epoch_snapshot, 'SoulGrant ownership_epoch_snapshot'),
    scopeMask: readNumber(fields.scope_mask, 'SoulGrant scope_mask'),
    scopes: scopeMaskToScopes(readNumber(fields.scope_mask, 'SoulGrant scope_mask')),
    expiresAtMs: readOptionalNumber(fields.expires_at_ms, 'SoulGrant expires_at_ms'),
  }
}

export async function getSoulMemoryObject(objectId: string, packageId: string): Promise<SoulMemoryObject> {
  const response = await suiClient.getObject({
    id: objectId,
    options: {
      showContent: true,
      showType: true,
    },
  })
  const expectedTypePrefix = `${normalizePackageId(packageId)}::memory::SoulMemory`
  const { fields, packageId: resolvedPackageId } = expectMoveObject(response, objectId, expectedTypePrefix)
  return {
    objectId,
    packageId: resolvedPackageId,
    soulId: readObjectId(fields.soul_id, 'SoulMemory soul_id'),
    entryCount: readNumber(fields.entry_count, 'SoulMemory entry_count'),
    entriesTableId:
      readNestedObjectId(fields.entries, 'SoulMemory entries')
      ?? readObjectId(fields.entries, 'SoulMemory entries'),
  }
}

export async function getSoulSkillsObject(objectId: string, packageId: string): Promise<SoulSkillsObject> {
  const response = await suiClient.getObject({
    id: objectId,
    options: {
      showContent: true,
      showType: true,
    },
  })
  const expectedTypePrefix = `${normalizePackageId(packageId)}::skills::SoulSkills`
  const { fields, packageId: resolvedPackageId } = expectMoveObject(response, objectId, expectedTypePrefix)
  return {
    objectId,
    packageId: resolvedPackageId,
    soulId: readObjectId(fields.soul_id, 'SoulSkills soul_id'),
    skillCount: readNumber(fields.skill_count, 'SoulSkills skill_count'),
    skillsTableId:
      readNestedObjectId(fields.skills, 'SoulSkills skills')
      ?? readObjectId(fields.skills, 'SoulSkills skills'),
  }
}

function readRegisteredPersonalKiosk(value: unknown): { kioskId: string; kioskCapOnChainId: string } | null {
  const record = asRecord(value)
  if (!record) return null

  const kioskId = typeof record.kiosk_id === 'string'
    ? record.kiosk_id
    : typeof record.kioskId === 'string'
      ? record.kioskId
      : null
  const kioskCapId = typeof record.kiosk_cap_id === 'string'
    ? record.kiosk_cap_id
    : typeof record.kiosk_cap_on_chain_id === 'string'
      ? record.kiosk_cap_on_chain_id
      : typeof record.kioskCapOnChainId === 'string'
        ? record.kioskCapOnChainId
        : null

  if (kioskId && kioskCapId) {
    return {
      kioskId: readObjectId(kioskId, 'PersonalKioskRegistration kiosk_id'),
      kioskCapOnChainId: readObjectId(kioskCapId, 'PersonalKioskRegistration kiosk_cap_id'),
    }
  }

  return readRegisteredPersonalKiosk(record.fields) ?? readRegisteredPersonalKiosk(record.value)
}

function isDynamicFieldNotFound(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : ''
  return (message.includes('dynamic field') && message.includes('not found'))
    || message.includes('no dynamic field found')
}

export async function getRegisteredPersonalKiosk(params: {
  marketConfigId: string
  marketPackageId: string
  ownerAddress: string
  kioskRegistryId?: string
}) {
  const parentId = params.kioskRegistryId ?? params.marketConfigId
  try {
    const response = await suiClient.getDynamicFieldObject({
      parentId,
      name: {
        type: `${normalizePackageId(params.marketPackageId)}::market::PersonalKioskOwnerKey`,
        value: { owner: params.ownerAddress },
      },
    })
    const content = response.data?.content
    return readRegisteredPersonalKiosk(content && 'fields' in content ? content.fields : null)
  } catch (error) {
    if (isDynamicFieldNotFound(error)) {
      return null
    }
    throw error
  }
}

export async function listOwnedPersonalKioskCaps(ownerAddress: string): Promise<ResolvedPersonalKiosk[]> {
  const personalKioskCapType = `${getVendoredKioskPackageAddress()}::personal_kiosk::PersonalKioskCap`
  const kiosks: ResolvedPersonalKiosk[] = []
  let cursor: string | null | undefined = undefined
  let pagesRead = 0

  do {
    const page = await suiClient.getOwnedObjects({
      owner: ownerAddress,
      ...(cursor ? { cursor } : {}),
      filter: { StructType: personalKioskCapType },
      options: {
        showOwner: true,
        showContent: true,
        showType: true,
      },
    })

    kiosks.push(...page.data.flatMap((entry) => {
      try {
        const objectId = typeof entry.data?.objectId === 'string' ? entry.data.objectId : null
        if (!objectId) return []
        const { fields } = expectMoveObject(
          { data: entry.data ?? null } as ObjectLike,
          objectId,
          personalKioskCapType,
        )
        const kioskId = readNestedObjectId(fields.cap, 'PersonalKioskCap cap.for')
        const resolvedOwnerAddress = getObjectOwnerAddress(entry.data?.owner)
        const normalizedObjectId = readObjectId(objectId, 'PersonalKioskCap objectId')
        if (!kioskId || !resolvedOwnerAddress) return []
        return [{
          ownerAddress: resolvedOwnerAddress,
          currentKioskId: kioskId,
          currentKioskCapOnChainId: normalizedObjectId,
        }]
      } catch {
        return []
      }
    }))

    pagesRead++
    if (pagesRead >= MAX_KIOSK_CAP_PAGES) break
    cursor = page.hasNextPage ? page.nextCursor : null
  } while (cursor)

  return kiosks
}

export async function filterExistingPersonalKiosks(kiosks: ResolvedPersonalKiosk[]): Promise<ResolvedPersonalKiosk[]> {
  if (kiosks.length === 0) {
    return []
  }

  const ids = [...new Set(kiosks.flatMap((kiosk) => [
    kiosk.currentKioskId,
    kiosk.currentKioskCapOnChainId,
  ]))]
  const responses = await suiClient.multiGetObjects({
    ids,
    options: { showType: true },
  })
  const existingIds = new Set(
    responses.flatMap((response, index) => (
      isMissingObjectResponse(response) ? [] : [ids[index]!]
    )),
  )

  return kiosks.filter((kiosk) => (
    existingIds.has(kiosk.currentKioskId)
    && existingIds.has(kiosk.currentKioskCapOnChainId)
  ))
}
