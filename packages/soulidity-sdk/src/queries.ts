import { normalizeWalrusBlobId } from './walrus'
import { suiClient } from './sui-client'
import { isValidSuiAddress, normalizeSuiAddress } from '@mysten/sui/utils'
import { SOUL_GRANT_SCOPE_BITS } from './grant-scopes'
import {
  getKioskPackageAddress,
  getPersonalKioskCapStructType,
} from './kiosk'
import type {
  ActiveGrantSlotObject,
  AnimacraftProvenanceObject,
  ResolvedPersonalKiosk,
  SoulCollectionObject,
  SoulCollectionRightObject,
  SoulContentObject,
  SoulGrantObject,
  SoulGrantScope,
  SoulObject,
  SoulPaidAccessListObject,
  SoulProvenanceKind,
  SoulStateObject,
  SoulidityMarketConfig,
} from './types'

export { getPersonalKioskCapTypePackageAddress } from './kiosk'

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
const MAX_KIOSK_CAP_PAGES = 5
const ACTIVE_GRANT_TABLE_PAGE_LIMIT = 50

type SoulStateReadOptions = {
  includeActiveGrants?: boolean
}

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

function readMoveStructFields(value: unknown, fieldName: string): Record<string, unknown> {
  const record = asRecord(value)
  if (!record) {
    throw new OnChainVerificationError(`${fieldName} is malformed on chain`)
  }
  return asRecord(record.fields) ?? record
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

function readOptionalBigInt(value: unknown, fieldName: string): bigint | null {
  const resolved = readOptionalVectorValue(value, fieldName)
  if (!resolved) return null
  return readBigInt(resolved, fieldName)
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

function readActiveGrantSlot(value: unknown, fieldName: string): ActiveGrantSlotObject {
  const slot = readStructFields(value, fieldName)
  const scopeMask = readNumber(slot.scope_mask, `${fieldName}.scope_mask`)
  return {
    grantId: readObjectId(slot.grant_id, `${fieldName}.grant_id`),
    granteeAddress: readAddress(slot.grantee, `${fieldName}.grantee`),
    scopeMask,
    scopes: scopeMaskToScopes(scopeMask),
    expiresAtMs: readOptionalNumber(slot.expires_at_ms, `${fieldName}.expires_at_ms`),
    ownershipEpochSnapshot: slot.ownership_epoch_snapshot == null
      ? null
      : readNumber(slot.ownership_epoch_snapshot, `${fieldName}.ownership_epoch_snapshot`),
  }
}

function isCurrentOwnershipGrantSlot(slot: ActiveGrantSlotObject, ownershipEpoch: number) {
  return slot.ownershipEpochSnapshot == null || slot.ownershipEpochSnapshot === ownershipEpoch
}

function readActiveGrantSlotFromDynamicFieldContent(
  content: unknown,
  fieldName: string,
): ActiveGrantSlotObject | null {
  const dynamicFields = content && typeof content === 'object' && 'fields' in content
    ? asRecord((content as { fields?: unknown }).fields)
    : null
  const dynamicInnerFields = dynamicFields ? asRecord(dynamicFields.fields) : null
  const rawValue = dynamicFields?.value ?? dynamicInnerFields?.value
  if (rawValue == null) return null
  return readActiveGrantSlot(rawValue, fieldName)
}

async function readActiveGrantSlotsFromTable(
  tableId: string,
  ownershipEpoch: number,
  expectedActiveGrantCount: number,
): Promise<ActiveGrantSlotObject[]> {
  if (expectedActiveGrantCount <= 0) {
    return []
  }

  const slots: ActiveGrantSlotObject[] = []
  let cursor: string | null | undefined = null
  let slotIndex = 0

  do {
    const page = await suiClient.getDynamicFields({
      parentId: tableId,
      cursor: cursor ?? undefined,
      limit: ACTIVE_GRANT_TABLE_PAGE_LIMIT,
    })

    for (const field of page.data ?? []) {
      const fieldObject = await suiClient.getDynamicFieldObject({
        parentId: tableId,
        name: field.name,
      })
      const slot = readActiveGrantSlotFromDynamicFieldContent(
        fieldObject.data?.content,
        `SoulState active_grants table ${slotIndex}`,
      )
      if (!slot) continue
      slotIndex += 1
      if (isCurrentOwnershipGrantSlot(slot, ownershipEpoch)) {
        slots.push(slot)
        if (slots.length >= expectedActiveGrantCount) {
          break
        }
      }
    }

    cursor = page.hasNextPage ? page.nextCursor : null
  } while (cursor && slots.length < expectedActiveGrantCount)

  return slots
}

async function readActiveGrantSlots(
  fields: Record<string, unknown>,
  ownershipEpoch: number,
  activeGrantCount: number | null,
): Promise<ActiveGrantSlotObject[]> {
  if (!('active_grant_count' in fields)) {
    return readVectorItems(fields.active_grants, 'SoulState active_grants')
      .map((item, index) => readActiveGrantSlot(item, `SoulState active_grants[${index}]`))
      .filter((slot) => isCurrentOwnershipGrantSlot(slot, ownershipEpoch))
  }

  const tableId = readNestedObjectId(fields.active_grants, 'SoulState active_grants')
  if (!tableId) {
    return []
  }
  return readActiveGrantSlotsFromTable(tableId, ownershipEpoch, activeGrantCount ?? 0)
}

async function readActiveGrantSlotFromTableByGrantee(
  tableId: string,
  ownershipEpoch: number,
  granteeAddress: string,
): Promise<ActiveGrantSlotObject | null> {
  try {
    const fieldObject = await suiClient.getDynamicFieldObject({
      parentId: tableId,
      name: {
        type: 'address',
        value: granteeAddress,
      },
    })
    if (isMissingObjectResponse(fieldObject)) {
      return null
    }
    const slot = readActiveGrantSlotFromDynamicFieldContent(
      fieldObject.data?.content,
      `SoulState active_grants[${granteeAddress}]`,
    )
    return slot && isCurrentOwnershipGrantSlot(slot, ownershipEpoch) ? slot : null
  } catch (error) {
    if (isDynamicFieldNotFound(error)) {
      return null
    }
    throw error
  }
}

export async function getActiveGrantSlotForGrantee(
  state: SoulStateObject,
  granteeAddress: string,
): Promise<ActiveGrantSlotObject | null> {
  const normalizedGrantee = normalizeSuiValue(granteeAddress)
  if (!normalizedGrantee || state.activeGrantCount <= 0) {
    return null
  }

  const inMemorySlot = state.activeGrants.find((slot) =>
    sameSuiValue(slot.granteeAddress, normalizedGrantee)
      && isCurrentOwnershipGrantSlot(slot, state.ownershipEpoch),
  )
  if (inMemorySlot) {
    return inMemorySlot
  }

  if (!state.activeGrantsTableId) {
    return null
  }
  return readActiveGrantSlotFromTableByGrantee(
    state.activeGrantsTableId,
    state.ownershipEpoch,
    normalizedGrantee,
  )
}

/**
 * Locate the first active grant slot whose grantee address matches one of
 * the viewer addresses AND whose scopeMask covers the requested mask.
 *
 * Phase 2: callers either pass the legacy `scope: SoulGrantScope` string
 * (back-compat) OR a numeric `scopeMask` matching `ContentSlot.grant_scope_mask`.
 * The numeric path is preferred — it lets paid-access / content-access
 * resolvers pass the slot's cached mask directly without re-deriving the
 * scope string.
 */
export async function findActiveGrantSlotForViewer(params: {
  state: SoulStateObject
  viewerAddresses: string[]
  scope?: SoulGrantScope
  scopeMask?: number
}): Promise<ActiveGrantSlotObject | null> {
  if (params.scope == null && params.scopeMask == null) {
    throw new Error('findActiveGrantSlotForViewer requires either `scope` or `scopeMask`')
  }
  for (const address of params.viewerAddresses) {
    const slot = await getActiveGrantSlotForGrantee(params.state, address)
    if (!slot) continue
    if (params.scopeMask != null) {
      if ((slot.scopeMask & params.scopeMask) === params.scopeMask) {
        return slot
      }
      continue
    }
    if (params.scope != null && slot.scopes.includes(params.scope)) {
      return slot
    }
  }
  return null
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
  return getKioskPackageAddress()
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

function ceilBpsAmount(price: bigint, bps: bigint) {
  const numerator = price * bps
  return numerator === 0n ? 0n : (numerator + MAX_BPS - 1n) / MAX_BPS
}

function floorBpsAmount(price: bigint, bps: bigint) {
  return (price * bps) / MAX_BPS
}

export function quoteSoulPurchase(config: SoulidityMarketConfig, params: {
  priceAtomic: bigint
  creatorRoyaltyBps: number
  collectionRoyaltyBps: number
}) {
  const platformFee = ceilBpsAmount(params.priceAtomic, BigInt(config.platformFeeBps))
  const creatorRoyalty = ceilBpsAmount(params.priceAtomic, BigInt(params.creatorRoyaltyBps))
  const collectionRoyalty = ceilBpsAmount(params.priceAtomic, BigInt(params.collectionRoyaltyBps))
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
  const platformFee = ceilBpsAmount(params.priceAtomic, BigInt(config.platformFeeBps))
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

export function quoteAnimacraftSoulPurchase(config: SoulidityMarketConfig, params: {
  priceAtomic: bigint
  makerRoyaltyBps: number
  collectionRoyaltyBps: number
}) {
  const combinedBps = config.platformFeeBps + params.makerRoyaltyBps + params.collectionRoyaltyBps
  if (params.priceAtomic <= 0n) {
    throw new OnChainVerificationError('Animacraft Soul listing price must be positive')
  }
  if (
    !Number.isInteger(params.makerRoyaltyBps)
    || !Number.isInteger(params.collectionRoyaltyBps)
    || params.makerRoyaltyBps < 0
    || params.collectionRoyaltyBps < 0
    || combinedBps > Number(MAX_BPS)
  ) {
    throw new OnChainVerificationError('Animacraft Soul purchase fee policy is invalid')
  }

  const platformFee = ceilBpsAmount(params.priceAtomic, BigInt(config.platformFeeBps))
  const makerRoyalty = floorBpsAmount(params.priceAtomic, BigInt(params.makerRoyaltyBps))
  if (params.makerRoyaltyBps > 0 && makerRoyalty === 0n) {
    throw new OnChainVerificationError('Animacraft Maker royalty rounds to zero at this listing price')
  }
  const collectionRoyalty = ceilBpsAmount(
    params.priceAtomic,
    BigInt(params.collectionRoyaltyBps),
  )
  const total = params.priceAtomic + platformFee + makerRoyalty + collectionRoyalty
  if (total > MAX_U64) {
    throw new OnChainVerificationError('Animacraft Soul purchase quote exceeds the supported range')
  }

  return {
    platformFeeAtomic: platformFee.toString(),
    priceAtomic: params.priceAtomic.toString(),
    makerRoyaltyAtomic: makerRoyalty.toString(),
    collectionRoyaltyAtomic: collectionRoyalty.toString(),
    totalAtomic: total.toString(),
  }
}

function readSoulProvenanceKind(value: unknown, fieldName: string): SoulProvenanceKind {
  const rawValue = readNumber(value, fieldName)
  if (rawValue === 1) return 'imported'
  if (rawValue === 2) return 'personal-join'
  if (rawValue === 3) return 'animacraft'
  return 'native'
}

export function scopeMaskToScopes(scopeMask: number): SoulGrantScope[] {
  return SOUL_GRANT_SCOPE_BITS
    .filter(({ mask }) => (scopeMask & mask) === mask)
    .map(({ scope }) => scope)
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
    provenanceKind: readSoulProvenanceKind(fields.provenance_kind, 'Soul provenance_kind'),
    originRef: readOptionalString(fields.origin_ref, 'Soul origin_ref'),
  }
}

export async function getSoulStateObject(
  objectId: string,
  packageId: string,
  options: SoulStateReadOptions = {},
): Promise<SoulStateObject> {
  const response = await suiClient.getObject({
    id: objectId,
    options: {
      showContent: true,
      showType: true,
    },
  })
  const expectedTypePrefix = `${normalizePackageId(packageId)}::soul::SoulState`
  const { fields, packageId: resolvedPackageId } = expectMoveObject(response, objectId, expectedTypePrefix)
  const ownershipEpoch = readNumber(fields.ownership_epoch, 'SoulState ownership_epoch')
  const hasTableBackedActiveGrants = 'active_grant_count' in fields
  const activeGrantCount = hasTableBackedActiveGrants
    ? readNumber(fields.active_grant_count, 'SoulState active_grant_count')
    : null
  const activeGrantsTableId = hasTableBackedActiveGrants
    ? readNestedObjectId(fields.active_grants, 'SoulState active_grants')
    : null
  const shouldMaterializeActiveGrants = options.includeActiveGrants !== false || !hasTableBackedActiveGrants
  const activeGrants = shouldMaterializeActiveGrants
    ? await readActiveGrantSlots(fields, ownershipEpoch, activeGrantCount)
    : []
  return {
    objectId,
    packageId: resolvedPackageId,
    soulId: readObjectId(fields.soul_id, 'SoulState soul_id'),
    creatorAddress: readAddress(fields.creator, 'SoulState creator'),
    creatorRoyaltyBps: readNumber(fields.creator_royalty_bps, 'SoulState creator_royalty_bps'),
    currentOwnerAddress: readAddress(fields.current_owner, 'SoulState current_owner'),
    currentKioskId: readObjectId(fields.current_kiosk_id, 'SoulState current_kiosk_id'),
    ownershipEpoch,
    grantCapacity: readNumber(fields.grant_capacity, 'SoulState grant_capacity'),
    activeGrantCount: activeGrantCount ?? activeGrants.length,
    activeGrants,
    activeGrantsTableId,
    contentId: readNestedObjectId(fields.content_id, 'SoulState content_id'),
    paidAccessListId: readNestedObjectId(fields.access_list_id, 'SoulState access_list_id'),
    collectionId: readNestedObjectId(fields.collection_id, 'SoulState collection_id'),
    isListed: Boolean(fields.is_listed),
  }
}

export async function getAnimacraftProvenanceId(
  stateObjectId: string,
): Promise<string | null> {
  try {
    const response = await suiClient.getDynamicFieldObject({
      parentId: stateObjectId,
      name: {
        type: 'u8',
        value: 1,
      },
    })
    if (!response.data) {
      const message = JSON.stringify(response.error ?? '')
      if (/not.?found|not.?exist|dynamic field/i.test(message)) return null
      throw new OnChainVerificationError('Animacraft provenance binding is missing on chain')
    }
    const content = response.data.content
    if (!content || !('fields' in content)) {
      throw new OnChainVerificationError('Animacraft provenance binding is malformed on chain')
    }
    const fields = readMoveStructFields(content.fields, 'Animacraft provenance dynamic field')
    return readObjectId(fields.value, 'Animacraft provenance id')
  } catch (error) {
    if (isDynamicFieldNotFound(error)) return null
    throw error
  }
}

export async function getAnimacraftProvenanceObject(
  objectId: string,
  packageId: string,
): Promise<AnimacraftProvenanceObject> {
  const response = await suiClient.getObject({
    id: objectId,
    options: {
      showContent: true,
      showType: true,
    },
  })
  const expectedTypePrefix = `${normalizePackageId(packageId)}::animacraft_provenance::AnimacraftProvenance`
  const { fields, packageId: resolvedPackageId } = expectMoveObject(
    response,
    objectId,
    expectedTypePrefix,
  )
  const royaltyPolicy = readMoveStructFields(
    fields.royalty_policy,
    'AnimacraftProvenance royalty_policy',
  )

  return {
    objectId,
    packageId: resolvedPackageId,
    soulId: readObjectId(fields.soul_id, 'AnimacraftProvenance soul_id'),
    animacraftVersion: readNumber(
      fields.animacraft_version,
      'AnimacraftProvenance animacraft_version',
    ),
    makerId: readObjectId(fields.maker_id, 'AnimacraftProvenance maker_id'),
    makerTreasuryId: readObjectId(
      fields.maker_treasury_id,
      'AnimacraftProvenance maker_treasury_id',
    ),
    makerCreatorAddress: readAddress(
      fields.maker_creator,
      'AnimacraftProvenance maker_creator',
    ),
    payerAddress: readAddress(fields.payer, 'AnimacraftProvenance payer'),
    profileJsonBlobId: readString(
      fields.profile_json_blob_id,
      'AnimacraftProvenance profile_json_blob_id',
    ),
    imageBlobId: readString(fields.image_blob_id, 'AnimacraftProvenance image_blob_id'),
    imageUrl: readString(fields.image_url, 'AnimacraftProvenance image_url'),
    makerRoyaltyBps: readNumber(
      royaltyPolicy.royalty_bps,
      'AnimacraftProvenance royalty_policy.royalty_bps',
    ),
    mintPaymentCoinType: readString(
      fields.mint_payment_coin_type,
      'AnimacraftProvenance mint_payment_coin_type',
    ),
    mintPriceAtomic: readBigInt(
      fields.mint_price_atomic,
      'AnimacraftProvenance mint_price_atomic',
    ).toString(),
    authorizedAtMs: readBigInt(
      fields.authorized_at_ms,
      'AnimacraftProvenance authorized_at_ms',
    ).toString(),
  }
}

export async function getAnimacraftProvenanceForState(
  stateObjectId: string,
  packageId: string,
): Promise<AnimacraftProvenanceObject | null> {
  const provenanceId = await getAnimacraftProvenanceId(stateObjectId)
  return provenanceId ? getAnimacraftProvenanceObject(provenanceId, packageId) : null
}

function readVectorU8AsUtf8(value: unknown, fieldName: string): string {
  // Sui RPC returns `vector<u8>` in `showContent` mode as a `number[]` of byte
  // values; some adapters surface it as a UTF-8 string directly. Tolerate both
  // and reject anything else so a malformed payload cannot silently mirror.
  if (Array.isArray(value)) {
    const bytes = new Uint8Array(value.length)
    for (let index = 0; index < value.length; index += 1) {
      const byte = value[index]
      if (typeof byte !== 'number' || !Number.isInteger(byte) || byte < 0 || byte > 255) {
        throw new OnChainVerificationError(`${fieldName} contains a non-byte element`)
      }
      bytes[index] = byte
    }
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  }
  if (typeof value === 'string') {
    return value
  }
  throw new OnChainVerificationError(`${fieldName} is malformed on chain`)
}

/**
 * Read a single `SoulState.config_ext[key]` entry from chain. Returns `null`
 * when the key has never been written, was deleted, or the underlying table
 * lookup fails with "dynamic field not found".
 *
 * Used by mirror routes that must NOT trust the request body's `value` —
 * `SoulStateConfigUpserted` events only carry `(state_id, soul_id, updater,
 * key)`, so the mirrored value has to come from chain reads or it can be
 * desynced by a stale / forged sync request.
 */
export async function getSoulStateConfigEntry(params: {
  stateObjectId: string
  packageId: string
  key: string
}): Promise<{ value: string } | null> {
  const stateResponse = await suiClient.getObject({
    id: params.stateObjectId,
    options: {
      showContent: true,
      showType: true,
    },
  })
  const expectedTypePrefix = `${normalizePackageId(params.packageId)}::soul::SoulState`
  const { fields } = expectMoveObject(stateResponse, params.stateObjectId, expectedTypePrefix)
  const configTableId = readNestedObjectId(fields.config_ext, 'SoulState config_ext')
  if (!configTableId) {
    return null
  }

  try {
    const fieldObject = await suiClient.getDynamicFieldObject({
      parentId: configTableId,
      name: { type: '0x1::string::String', value: params.key },
    })
    if (isMissingObjectResponse(fieldObject)) {
      return null
    }
    const content = fieldObject.data?.content
    const dynamicFields = content && typeof content === 'object' && 'fields' in content
      ? asRecord((content as { fields?: unknown }).fields)
      : null
    const dynamicInnerFields = dynamicFields ? asRecord(dynamicFields.fields) : null
    const rawValue = dynamicFields?.value ?? dynamicInnerFields?.value
    if (rawValue == null) {
      return null
    }
    return {
      value: readVectorU8AsUtf8(rawValue, `SoulState config_ext[${params.key}]`),
    }
  } catch (error) {
    if (isDynamicFieldNotFound(error)) {
      return null
    }
    throw error
  }
}

/**
 * Read the shared `SoulContent` object on chain. Phase 2 collapses the legacy
 * `SoulMetadata` / `SoulSkills` / `SoulAssets` / `SoulMemory` quartet into this
 * single typed-content root keyed by `(kind, name, versionIndex)`.
 *
 * The `items` and `active` Tables are dynamic-field-backed, so iterating them
 * off-chain is expensive. The DB mirror (`SoulContentVersionRecord`) is the
 * authoritative source for version counts and active bindings; this function's
 * job is just to validate that the on-chain object exists, has the expected
 * type, and points at the expected `soul_id`.
 *
 * TODO: surface real `versionCount` / `activeBindings` if a future caller needs
 * the on-chain truth without going through the mirror — both require iterating
 * dynamic fields and should probably be paginated through Sui RPC.
 */
export async function getSoulContentObject(
  objectId: string,
  packageId: string,
): Promise<SoulContentObject> {
  const response = await suiClient.getObject({
    id: objectId,
    options: {
      showContent: true,
      showType: true,
    },
  })
  const expectedTypePrefix = `${normalizePackageId(packageId)}::content::SoulContent`
  const { fields, packageId: resolvedPackageId } = expectMoveObject(response, objectId, expectedTypePrefix)
  return {
    objectId,
    packageId: resolvedPackageId,
    soulId: readObjectId(fields.soul_id, 'SoulContent soul_id'),
    versionCount: 0,
    activeBindings: [],
  }
}

/**
 * Read the shared `SoulPaidAccessList` object on chain. The `kind_configs` and
 * `entries` Tables are dynamic-field-backed, so this function intentionally
 * does not iterate them — DB mirrors (`SoulPaidAccessKindConfigRecord` /
 * `SoulPaidAccessEntryRecord`) hold the per-row state. The on-chain read is
 * here to validate object existence, type, and `soul_id` linkage.
 *
 * TODO: paginate `kind_configs` via dynamic-field iteration if a non-mirror
 * caller ever needs the on-chain truth.
 */
export async function getSoulPaidAccessListObject(
  objectId: string,
  packageId: string,
): Promise<SoulPaidAccessListObject> {
  const response = await suiClient.getObject({
    id: objectId,
    options: {
      showContent: true,
      showType: true,
    },
  })
  const expectedTypePrefix = `${normalizePackageId(packageId)}::paid_access::SoulPaidAccessList`
  const { fields, packageId: resolvedPackageId } = expectMoveObject(response, objectId, expectedTypePrefix)
  return {
    objectId,
    packageId: resolvedPackageId,
    soulId: readObjectId(fields.soul_id, 'SoulPaidAccessList soul_id'),
    creatorAddress: readAddress(fields.creator, 'SoulPaidAccessList creator'),
    kindConfigs: [],
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
    maxSupply: readOptionalBigInt(fields.max_supply, 'SoulCollection max_supply'),
    currentSupply: readBigInt(fields.current_supply, 'SoulCollection current_supply'),
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
  const message = error instanceof Error
    ? error.message.toLowerCase()
    : JSON.stringify(error ?? '').toLowerCase()
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
  const personalKioskCapType = getPersonalKioskCapStructType()
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
