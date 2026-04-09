import { isValidSuiAddress, normalizeSuiAddress } from '@mysten/sui/utils'
import { getVendoredKioskPackageAddress } from '@web/lib/souls/kiosk-package'
import { normalizeWalrusBlobId } from '@web/lib/services/walrus'
import { suiClient } from '@web/lib/sui'

type TransactionLike = {
  digest?: string
  effects?: { status?: { status?: string | null } | null } | null
  events?: Array<{ type?: unknown; parsedJson?: unknown }> | null
  objectChanges?: Array<Record<string, unknown>> | null
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

const MAX_ON_CHAIN_DECIMAL_BIGINT_LENGTH = 78
const OPTIONAL_VECTOR_MAX_DEPTH = 4
const MAX_CREATOR_ROYALTY_BPS = 2_500n

export class OnChainVerificationError extends Error {
  constructor(message: string, readonly status = 422) {
    super(message)
    this.name = 'OnChainVerificationError'
  }
}

export interface VerifiedSoulState {
  objectId: string
  packageId?: string
  ownerAddress: string | null
  ownerObjectId: string | null
  kioskParentId: string | null
  ownerKind: 'address' | 'object' | 'shared' | 'immutable' | 'unknown'
  creatorAddress: string
  creatorRoyaltyBps: number
  name: string
  description: string
  imageUrl: string
  metadataRef: string | null
  contentBlobId: string | null
  contentBlobObjectId: string
  allowlistAddress: string | null
  allowlistVersion: bigint
}

export interface VerifiedPersonalKioskCapState {
  objectId: string
  ownerAddress: string
  kioskId: string
}

export interface VerifiedSoulAllowlistCapState {
  objectId: string
  ownerAddress: string
  soulObjectId: string
  allowlistedAddress: string
  allowlistVersion: bigint
}

export interface VerifiedSoulListedEvent {
  listingObjectId: string
  soulObjectId: string
  kioskId: string
  kioskCapOnChainId: string
  sellerAddress: string
  priceAtomic: bigint
}

export interface VerifiedSoulMintedToKioskEvent {
  soulObjectId: string
  kioskId: string
  kioskCapOnChainId: string
  ownerAddress: string
}

export interface VerifiedSoulPurchasedEvent {
  soulObjectId: string
  sellerKioskId: string
  buyerKioskId: string
  buyerKioskCapOnChainId: string
  buyerAddress: string
  priceAtomic: bigint
  platformFeeAtomic: bigint
  creatorRoyaltyAtomic: bigint
}

export interface VerifiedSoulAllowlistSetEvent {
  soulObjectId: string
  allowlistedAddress: string
  allowlistVersion: bigint
}

export interface VerifiedSoulAllowlistClearedEvent {
  soulObjectId: string
  oldAllowlistedAddress: string
}

export interface VerifiedSoulListingCancelledEvent {
  listingObjectId: string
  soulObjectId: string
  kioskId: string
  sellerAddress: string
}

type VerifiedSoulStateOptions = {
  expectedKioskId?: string | null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

function normalizeSuiValue(value: string): string | null {
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

function readBigInt(value: unknown, fieldName: string): bigint {
  if (typeof value === 'bigint') {
    if (value < 0n) {
      throw new OnChainVerificationError(`${fieldName} is not a valid integer on chain`)
    }
    return value
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const truncatedValue = Math.trunc(value)
    if (!Number.isSafeInteger(truncatedValue)) {
      throw new OnChainVerificationError(`${fieldName} exceeds the supported integer range on chain`)
    }
    if (truncatedValue < 0) {
      throw new OnChainVerificationError(`${fieldName} is not a valid integer on chain`)
    }
    return BigInt(truncatedValue)
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const trimmed = value.trim()
    if (trimmed.length > MAX_ON_CHAIN_DECIMAL_BIGINT_LENGTH) {
      throw new OnChainVerificationError(`${fieldName} exceeds the supported integer range on chain`)
    }
    if (!/^\d+$/.test(trimmed)) {
      throw new OnChainVerificationError(`${fieldName} is not a valid integer on chain`)
    }
    return BigInt(trimmed)
  }
  throw new OnChainVerificationError(`${fieldName} is missing on chain`)
}

function readCreatorRoyaltyBps(value: unknown): number {
  const creatorRoyaltyBps = readBigInt(value, 'Soul creator_royalty_bps')
  if (creatorRoyaltyBps < 0n || creatorRoyaltyBps > MAX_CREATOR_ROYALTY_BPS) {
    throw new OnChainVerificationError('Soul creator_royalty_bps is out of valid range on chain')
  }
  return Number(creatorRoyaltyBps)
}

export function dateFromSafeMsBigInt(value: bigint, fieldName: string): Date {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new OnChainVerificationError(`${fieldName} exceeds the supported timestamp range on chain`)
  }
  return new Date(Number(value))
}

function readOptionalVectorValue(value: unknown, fieldName: string, depth = 0): string | null {
  if (depth > OPTIONAL_VECTOR_MAX_DEPTH) {
    throw new OnChainVerificationError(`${fieldName} nesting exceeds the supported on-chain depth`)
  }

  if (value == null) {
    return null
  }
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
  if (typeof record.id === 'string') {
    return record.id.trim() || null
  }

  throw new OnChainVerificationError(`${fieldName} is malformed on chain`)
}

function readOptionalAddress(value: unknown, fieldName: string): string | null {
  const resolved = readOptionalVectorValue(value, fieldName)
  if (!resolved) return null
  const normalized = normalizeSuiValue(resolved)
  if (!normalized) {
    throw new OnChainVerificationError(`${fieldName} is malformed on chain`)
  }
  return normalized
}

function readOptionalString(value: unknown, fieldName: string): string | null {
  const resolved = readOptionalVectorValue(value, fieldName)
  return resolved?.trim() || null
}

function readOptionalWalrusBlobId(value: unknown): string | null {
  const record = asRecord(value)
  if (!record) {
    return typeof value === 'string' ? normalizeWalrusBlobId(value) : null
  }

  const directValue = typeof record.blob_id === 'string'
    ? record.blob_id
    : typeof record.blobId === 'string'
      ? record.blobId
      : null
  const directBlobId = directValue ? normalizeWalrusBlobId(directValue) : null
  if (directBlobId) {
    return directBlobId
  }

  const nestedFields = asRecord(record.fields)
  if (nestedFields) {
    const nestedBlobId = readOptionalWalrusBlobId(nestedFields)
    if (nestedBlobId) {
      return nestedBlobId
    }
  }

  const nestedVec = record.vec
  if (Array.isArray(nestedVec) && nestedVec.length === 1) {
    return readOptionalWalrusBlobId(nestedVec[0])
  }

  return null
}

function readNestedBlobObjectId(value: unknown, fieldName: string): string {
  const record = asRecord(value)
  if (record) {
    const nested = asRecord(record.fields)
    if (nested) {
      const idWrapper = asRecord(nested.id)
      if (idWrapper && typeof idWrapper.id === 'string') {
        const normalized = normalizeSuiValue(idWrapper.id)
        if (normalized) return normalized
      }
    }
  }
  return readObjectId(value, fieldName)
}

function readObjectId(value: unknown, fieldName: string): string {
  const resolved = readString(value, fieldName)
  const normalized = normalizeSuiValue(resolved)
  if (!normalized) {
    throw new OnChainVerificationError(`${fieldName} is malformed on chain`)
  }
  return normalized
}

function getObjectOwnerAddress(owner: unknown): string | null {
  const record = asRecord(owner)
  if (!record) return null
  return typeof record.AddressOwner === 'string' ? normalizeSuiValue(record.AddressOwner) : null
}

function getObjectOwnerObjectId(owner: unknown): string | null {
  const record = asRecord(owner)
  if (!record) return null
  return typeof record.ObjectOwner === 'string' ? normalizeSuiValue(record.ObjectOwner) : null
}

function getObjectOwnerKind(owner: unknown): VerifiedSoulState['ownerKind'] {
  const record = asRecord(owner)
  if (!record) return 'unknown'
  if (typeof record.AddressOwner === 'string') return 'address'
  if (typeof record.ObjectOwner === 'string') return 'object'
  if ('Shared' in record) return 'shared'
  if ('Immutable' in record) return 'immutable'
  return 'unknown'
}

async function resolveKioskParentId(objectOwnerId: string): Promise<string | null> {
  try {
    const response = await suiClient.getObject({
      id: objectOwnerId,
      options: { showOwner: true, showType: true },
    })
    const data = response?.data
    if (!data) return null
    const objectType = typeof data.type === 'string' ? data.type : null
    if (!objectType || !objectType.includes('dynamic_field::Field') || !objectType.includes('kiosk::Item')) {
      return null
    }
    const parentId = getObjectOwnerObjectId(data.owner)
    return parentId ?? null
  } catch {
    return null
  }
}

function normalizePackageId(packageId: string): string {
  return normalizeSuiAddress(packageId)
}

export function getTrustedPackageIds(...packageIds: Array<string | null | undefined>) {
  const trustedPackageIds = new Set<string>()
  for (const packageId of packageIds) {
    if (typeof packageId !== 'string' || packageId.trim().length === 0) {
      continue
    }
    trustedPackageIds.add(normalizePackageId(packageId))
  }
  return [...trustedPackageIds]
}

function readPackageIdFromType(type: string): string | null {
  const packageId = type.split('::', 1)[0]
  return packageId ? normalizeSuiValue(packageId) : null
}

function getPersonalKioskCapTypePrefix() {
  try {
    return `${getVendoredKioskPackageAddress()}::personal_kiosk::PersonalKioskCap`
  } catch {
    throw new OnChainVerificationError('Personal kiosk verification is not configured', 503)
  }
}

function readNestedKioskId(value: unknown, fieldName: string, depth = 0): string | null {
  if (depth > OPTIONAL_VECTOR_MAX_DEPTH) {
    throw new OnChainVerificationError(`${fieldName} nesting exceeds the supported on-chain depth`)
  }

  const record = asRecord(value)
  if (!record) {
    return null
  }

  if ('for' in record) {
    return readObjectId(record.for, fieldName)
  }

  if (record.fields) {
    const nested = readNestedKioskId(record.fields, fieldName, depth + 1)
    if (nested) {
      return nested
    }
  }

  if (Array.isArray(record.vec)) {
    if (record.vec.length === 0) return null
    if (record.vec.length !== 1) {
      throw new OnChainVerificationError(`${fieldName} is malformed on chain`)
    }
    return readNestedKioskId(record.vec[0], fieldName, depth + 1)
  }

  return null
}

function typeMatchesPrefix(type: string, expectedTypePrefix: string): boolean {
  if (type.startsWith(expectedTypePrefix)) return true
  // After package upgrade, objects retain the original package address in their type.
  // Fall back to matching the module::Name suffix.
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
  }
}

export async function getVerifiedSoulState(
  objectId: string,
  packageId: string,
  options?: VerifiedSoulStateOptions,
): Promise<VerifiedSoulState> {
  const response = await suiClient.getObject({
    id: objectId,
    options: {
      showOwner: true,
      showContent: true,
      showType: true,
    },
  })
  const expectedTypePrefix = `${normalizePackageId(packageId)}::soul::Soul`
  const { object, fields } = expectMoveObject(response, objectId, expectedTypePrefix)
  const ownerAddress = getObjectOwnerAddress(object.owner)
  const ownerObjectId = getObjectOwnerObjectId(object.owner)
  const shouldResolveKioskParent = ownerObjectId && !sameSuiValue(ownerObjectId, options?.expectedKioskId ?? null)
  const kioskParentId = shouldResolveKioskParent ? await resolveKioskParentId(ownerObjectId) : null
  const resolvedPackageId = typeof object.type === 'string' ? readPackageIdFromType(object.type) : null

  return {
    objectId,
    packageId: resolvedPackageId ?? undefined,
    ownerAddress,
    ownerObjectId,
    kioskParentId,
    ownerKind: getObjectOwnerKind(object.owner),
    creatorAddress: readAddress(fields.creator, 'Soul creator'),
    creatorRoyaltyBps: readCreatorRoyaltyBps(fields.creator_royalty_bps),
    name: readString(fields.name, 'Soul name'),
    description: readString(fields.description, 'Soul description'),
    imageUrl: readString(fields.image_url, 'Soul image_url'),
    metadataRef: readOptionalString(fields.metadata_ref, 'Soul metadata_ref'),
    contentBlobId: readOptionalWalrusBlobId(fields.content_blob),
    contentBlobObjectId: readNestedBlobObjectId(fields.content_blob, 'Soul content_blob'),
    allowlistAddress: readOptionalAddress(fields.allowlist_address, 'Soul allowlist_address'),
    allowlistVersion: readBigInt(fields.allowlist_version, 'Soul allowlist_version'),
  }
}

function parseVerifiedSoulAllowlistCapState(
  response: ObjectLike,
  objectId: string,
  packageId: string,
): VerifiedSoulAllowlistCapState {
  const expectedTypePrefix = `${normalizePackageId(packageId)}::allowlist::SoulAllowlistCap`
  const { object, fields } = expectMoveObject(response, objectId, expectedTypePrefix)
  const ownerAddress = getObjectOwnerAddress(object.owner)
  if (!ownerAddress) {
    throw new OnChainVerificationError('Soul allowlist cap owner is missing on chain')
  }

  return {
    objectId,
    ownerAddress,
    soulObjectId: readObjectId(fields.soul_id, 'SoulAllowlistCap soul_id'),
    allowlistedAddress: readAddress(fields.allowlisted, 'SoulAllowlistCap allowlisted'),
    allowlistVersion: readBigInt(fields.allowlist_version, 'SoulAllowlistCap allowlist_version'),
  }
}

export async function getVerifiedSoulAllowlistCapState(
  objectId: string,
  packageId: string,
): Promise<VerifiedSoulAllowlistCapState> {
  const response = await suiClient.getObject({
    id: objectId,
    options: {
      showOwner: true,
      showContent: true,
      showType: true,
    },
  })
  return parseVerifiedSoulAllowlistCapState(response, objectId, packageId)
}

export async function getVerifiedSoulAllowlistCapStates(
  objectIds: string[],
  packageId: string,
): Promise<VerifiedSoulAllowlistCapState[]> {
  if (objectIds.length === 0) {
    return []
  }

  const responses = await suiClient.multiGetObjects({
    ids: objectIds,
    options: {
      showOwner: true,
      showContent: true,
      showType: true,
    },
  })

  const verifiedStates: VerifiedSoulAllowlistCapState[] = []
  responses.forEach((response, index) => {
    const objectId = objectIds[index]
    if (!objectId) {
      return
    }

    try {
      verifiedStates.push(parseVerifiedSoulAllowlistCapState(response as ObjectLike, objectId, packageId))
    } catch (error) {
      if (!(error instanceof OnChainVerificationError)) {
        throw error
      }
    }
  })

  return verifiedStates
}

function parseVerifiedPersonalKioskCapState(
  response: ObjectLike,
  objectId: string,
  expectedTypePrefix: string,
): VerifiedPersonalKioskCapState {
  const { object, fields } = expectMoveObject(response, objectId, expectedTypePrefix)
  const ownerAddress = getObjectOwnerAddress(object.owner)
  if (!ownerAddress) {
    throw new OnChainVerificationError('Personal kiosk cap owner is missing on chain')
  }

  const kioskId = readNestedKioskId(fields.cap, 'PersonalKioskCap cap.for')
  if (!kioskId) {
    throw new OnChainVerificationError('Personal kiosk cap kiosk id is missing on chain')
  }

  return {
    objectId,
    ownerAddress,
    kioskId,
  }
}

export async function getVerifiedPersonalKioskCapState(
  objectId: string,
): Promise<VerifiedPersonalKioskCapState> {
  const expectedTypePrefix = getPersonalKioskCapTypePrefix()
  const response = await suiClient.getObject({
    id: objectId,
    options: {
      showOwner: true,
      showContent: true,
      showType: true,
    },
  })
  return parseVerifiedPersonalKioskCapState(response, objectId, expectedTypePrefix)
}

export async function getVerifiedPersonalKioskCapStates(
  objectIds: string[],
): Promise<VerifiedPersonalKioskCapState[]> {
  if (objectIds.length === 0) {
    return []
  }

  const expectedTypePrefix = getPersonalKioskCapTypePrefix()
  const responses = await suiClient.multiGetObjects({
    ids: objectIds,
    options: {
      showOwner: true,
      showContent: true,
      showType: true,
    },
  })

  const verifiedStates: VerifiedPersonalKioskCapState[] = []
  responses.forEach((response, index) => {
    const objectId = objectIds[index]
    if (!objectId) {
      return
    }

    try {
      verifiedStates.push(parseVerifiedPersonalKioskCapState(response as ObjectLike, objectId, expectedTypePrefix))
    } catch (error) {
      if (!(error instanceof OnChainVerificationError)) {
        throw error
      }
    }
  })

  return verifiedStates
}

export function ensureTransactionSucceeded(transaction: TransactionLike) {
  if (transaction.effects?.status?.status !== 'success') {
    throw new OnChainVerificationError('On-chain transaction did not succeed')
  }
}

function extractTypedEvent(
  transaction: TransactionLike,
  type: string,
  trustedPackageIds?: string[],
): Record<string, unknown> | null {
  const event = transaction.events?.find((item) => item?.type === type)
  if (event) return asRecord(event.parsedJson)
  const trustedPackages = getTrustedPackageIds(...(trustedPackageIds ?? []))
  if (trustedPackages.length === 0) {
    return null
  }

  // After package upgrade, events carry the original package address.
  // Fall back to suffix match (e.g. "::market::SoulListed"), but only for
  // packages the caller explicitly trusts for this Soul.
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

export function extractSoulListingEvent(
  transaction: TransactionLike,
  packageId: string,
  trustedPackageIds?: string[],
): VerifiedSoulListedEvent {
  const event = extractTypedEvent(
    transaction,
    `${normalizePackageId(packageId)}::market::SoulListed`,
    trustedPackageIds,
  )
  if (!event) {
    throw new OnChainVerificationError('Soul listing event is missing from the transaction')
  }
  return {
    listingObjectId: readObjectId(event.listing_id, 'SoulListed listing_id'),
    soulObjectId: readObjectId(event.soul_id, 'SoulListed soul_id'),
    kioskId: readObjectId(event.kiosk_id, 'SoulListed kiosk_id'),
    kioskCapOnChainId: readObjectId(event.kiosk_cap_id, 'SoulListed kiosk_cap_id'),
    sellerAddress: readAddress(event.seller, 'SoulListed seller'),
    priceAtomic: readBigInt(event.price, 'SoulListed price'),
  }
}

export function extractSoulMintedToKioskEvent(
  transaction: TransactionLike,
  packageId: string,
  trustedPackageIds?: string[],
): VerifiedSoulMintedToKioskEvent {
  const event = extractTypedEvent(
    transaction,
    `${normalizePackageId(packageId)}::market::SoulMintedToKiosk`,
    trustedPackageIds,
  )
  if (!event) {
    throw new OnChainVerificationError('Soul minted-to-kiosk event is missing from the transaction')
  }
  return {
    soulObjectId: readObjectId(event.soul_id, 'SoulMintedToKiosk soul_id'),
    kioskId: readObjectId(event.kiosk_id, 'SoulMintedToKiosk kiosk_id'),
    kioskCapOnChainId: readObjectId(event.kiosk_cap_id, 'SoulMintedToKiosk kiosk_cap_id'),
    ownerAddress: readAddress(event.owner, 'SoulMintedToKiosk owner'),
  }
}

export type SoulPublishEvent =
  | { kind: 'listed'; event: VerifiedSoulListedEvent }
  | { kind: 'minted'; event: VerifiedSoulMintedToKioskEvent }

export function extractSoulPublishEvent(
  transaction: TransactionLike,
  packageId: string,
  trustedPackageIds?: string[],
): SoulPublishEvent {
  const normalizedPackageId = normalizePackageId(packageId)
  const listedEvent = extractTypedEvent(
    transaction,
    `${normalizedPackageId}::market::SoulListed`,
    trustedPackageIds,
  )
  if (listedEvent) {
    return {
      kind: 'listed',
      event: {
        listingObjectId: readObjectId(listedEvent.listing_id, 'SoulListed listing_id'),
        soulObjectId: readObjectId(listedEvent.soul_id, 'SoulListed soul_id'),
        kioskId: readObjectId(listedEvent.kiosk_id, 'SoulListed kiosk_id'),
        kioskCapOnChainId: readObjectId(listedEvent.kiosk_cap_id, 'SoulListed kiosk_cap_id'),
        sellerAddress: readAddress(listedEvent.seller, 'SoulListed seller'),
        priceAtomic: readBigInt(listedEvent.price, 'SoulListed price'),
      },
    }
  }
  const mintedEvent = extractTypedEvent(
    transaction,
    `${normalizedPackageId}::market::SoulMintedToKiosk`,
    trustedPackageIds,
  )
  if (mintedEvent) {
    return {
      kind: 'minted',
      event: {
        soulObjectId: readObjectId(mintedEvent.soul_id, 'SoulMintedToKiosk soul_id'),
        kioskId: readObjectId(mintedEvent.kiosk_id, 'SoulMintedToKiosk kiosk_id'),
        kioskCapOnChainId: readObjectId(mintedEvent.kiosk_cap_id, 'SoulMintedToKiosk kiosk_cap_id'),
        ownerAddress: readAddress(mintedEvent.owner, 'SoulMintedToKiosk owner'),
      },
    }
  }
  throw new OnChainVerificationError('Neither SoulListed nor SoulMintedToKiosk event was found in the transaction')
}

export function extractSoulPurchasedEvent(
  transaction: TransactionLike,
  packageId: string,
  trustedPackageIds?: string[],
): VerifiedSoulPurchasedEvent {
  const event = extractTypedEvent(
    transaction,
    `${normalizePackageId(packageId)}::market::SoulPurchased`,
    trustedPackageIds,
  )
  if (!event) {
    throw new OnChainVerificationError('Soul purchase event is missing from the transaction')
  }
  return {
    soulObjectId: readObjectId(event.soul_id, 'SoulPurchased soul_id'),
    sellerKioskId: readObjectId(event.seller_kiosk_id, 'SoulPurchased seller_kiosk_id'),
    buyerKioskId: readObjectId(event.buyer_kiosk_id, 'SoulPurchased buyer_kiosk_id'),
    buyerKioskCapOnChainId: readObjectId(event.buyer_kiosk_cap_id, 'SoulPurchased buyer_kiosk_cap_id'),
    buyerAddress: readAddress(event.buyer, 'SoulPurchased buyer'),
    priceAtomic: readBigInt(event.price, 'SoulPurchased price'),
    platformFeeAtomic: readBigInt(event.platform_fee, 'SoulPurchased platform_fee'),
    creatorRoyaltyAtomic: readBigInt(event.creator_royalty, 'SoulPurchased creator_royalty'),
  }
}

export function extractSoulListingCancelledEvent(
  transaction: TransactionLike,
  packageId: string,
  trustedPackageIds?: string[],
): VerifiedSoulListingCancelledEvent {
  const event = extractTypedEvent(
    transaction,
    `${normalizePackageId(packageId)}::market::SoulListingCancelled`,
    trustedPackageIds,
  )
  if (!event) {
    throw new OnChainVerificationError('Soul listing cancelled event is missing from the transaction')
  }
  return {
    listingObjectId: readObjectId(event.listing_id, 'SoulListingCancelled listing_id'),
    soulObjectId: readObjectId(event.soul_id, 'SoulListingCancelled soul_id'),
    kioskId: readObjectId(event.kiosk_id, 'SoulListingCancelled kiosk_id'),
    sellerAddress: readAddress(event.seller, 'SoulListingCancelled seller'),
  }
}

export function extractSoulAllowlistSetEvent(
  transaction: TransactionLike,
  packageId: string,
  trustedPackageIds?: string[],
): VerifiedSoulAllowlistSetEvent {
  const event = extractTypedEvent(
    transaction,
    `${normalizePackageId(packageId)}::allowlist::AllowlistAddressSet`,
    trustedPackageIds,
  )
  if (!event) {
    throw new OnChainVerificationError('Soul allowlist set event is missing from the transaction')
  }
  return {
    soulObjectId: readObjectId(event.soul_id, 'AllowlistAddressSet soul_id'),
    allowlistedAddress: readAddress(event.allowlisted, 'AllowlistAddressSet allowlisted'),
    allowlistVersion: readBigInt(event.allowlist_version, 'AllowlistAddressSet allowlist_version'),
  }
}

export function extractSoulAllowlistClearedEvent(
  transaction: TransactionLike,
  packageId: string,
  trustedPackageIds?: string[],
): VerifiedSoulAllowlistClearedEvent {
  const event = extractTypedEvent(
    transaction,
    `${normalizePackageId(packageId)}::allowlist::AllowlistAddressCleared`,
    trustedPackageIds,
  )
  if (!event) {
    throw new OnChainVerificationError('Soul allowlist cleared event is missing from the transaction')
  }
  return {
    soulObjectId: readObjectId(event.soul_id, 'AllowlistAddressCleared soul_id'),
    oldAllowlistedAddress: readAddress(event.old_allowlisted, 'AllowlistAddressCleared old_allowlisted'),
  }
}

export function transactionMutatedObject(
  transaction: { objectChanges?: Array<{ type?: string; objectId?: string }> | null },
  objectId: string,
): boolean {
  return transaction.objectChanges?.some(
    (change) => change.type === 'mutated' && change.objectId && sameSuiValue(change.objectId, objectId),
  ) ?? false
}
