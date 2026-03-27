import { isValidSuiAddress, normalizeSuiAddress } from '@mysten/sui/utils'
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

export class OnChainVerificationError extends Error {
  constructor(message: string, readonly status = 422) {
    super(message)
    this.name = 'OnChainVerificationError'
  }
}

export interface VerifiedSoulState {
  objectId: string
  ownerAddress: string | null
  ownerObjectId: string | null
  ownerKind: 'address' | 'object' | 'shared' | 'immutable' | 'unknown'
  creatorAddress: string
  name: string
  description: string
  imageUrl: string
  metadataRef: string | null
  contentBlobId: string | null
  contentBlobObjectId: string
  agentGrant: string | null
  grantVersion: bigint
}

export interface VerifiedSoulAccessCapState {
  objectId: string
  ownerAddress: string
  soulObjectId: string
  agentAddress: string
  grantVersion: bigint
}

export interface VerifiedSoulListedEvent {
  soulObjectId: string
  sellerKioskId: string
  sellerAddress: string
  priceSui: bigint
}

export interface VerifiedSoulPurchasedEvent {
  soulObjectId: string
  sellerKioskId: string
  buyerAddress: string
  priceSui: bigint
  platformFeeSui: bigint
  royaltyFeeSui: bigint
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
  if (typeof value === 'bigint') return value
  if (typeof value === 'number' && Number.isFinite(value)) {
    const truncatedValue = Math.trunc(value)
    if (!Number.isSafeInteger(truncatedValue)) {
      throw new OnChainVerificationError(`${fieldName} exceeds the supported integer range on chain`)
    }
    return BigInt(truncatedValue)
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const trimmed = value.trim()
    const digits = trimmed.startsWith('-') ? trimmed.slice(1) : trimmed
    if (digits.length > MAX_ON_CHAIN_DECIMAL_BIGINT_LENGTH) {
      throw new OnChainVerificationError(`${fieldName} exceeds the supported integer range on chain`)
    }
    if (!/^\d+$/.test(digits)) {
      throw new OnChainVerificationError(`${fieldName} is not a valid integer on chain`)
    }
    return BigInt(trimmed)
  }
  throw new OnChainVerificationError(`${fieldName} is missing on chain`)
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

function expectMoveObject(response: ObjectLike, objectId: string, expectedTypePrefix: string) {
  const object = response.data
  if (!object || typeof object.objectId !== 'string' || object.objectId !== objectId) {
    throw new OnChainVerificationError('On-chain object was not found')
  }
  if (typeof object.type !== 'string' || !object.type.startsWith(expectedTypePrefix)) {
    throw new OnChainVerificationError('On-chain object type does not match the expected package')
  }
  const content = object.content
  if (!content || content.dataType !== 'moveObject' || typeof content.type !== 'string' || !content.type.startsWith(expectedTypePrefix)) {
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

export async function getVerifiedSoulState(objectId: string, packageId?: string): Promise<VerifiedSoulState> {
  const response = await suiClient.getObject({
    id: objectId,
    options: {
      showOwner: true,
      showContent: true,
      showType: true,
    },
  })
  const expectedTypePrefix = `${packageId ?? ''}::soul::Soul`
  const { object, fields } = expectMoveObject(response, objectId, expectedTypePrefix)
  const ownerAddress = getObjectOwnerAddress(object.owner)

  return {
    objectId,
    ownerAddress,
    ownerObjectId: getObjectOwnerObjectId(object.owner),
    ownerKind: getObjectOwnerKind(object.owner),
    creatorAddress: readAddress(fields.creator, 'Soul creator'),
    name: readString(fields.name, 'Soul name'),
    description: readString(fields.description, 'Soul description'),
    imageUrl: readString(fields.image_url, 'Soul image_url'),
    metadataRef: readOptionalString(fields.metadata_ref, 'Soul metadata_ref'),
    contentBlobId: readOptionalWalrusBlobId(fields.content_blob),
    contentBlobObjectId: readObjectId(fields.content_blob, 'Soul content_blob'),
    agentGrant: readOptionalAddress(fields.agent_grant, 'Soul agent_grant'),
    grantVersion: readBigInt(fields.grant_version, 'Soul grant_version'),
  }
}

export async function getVerifiedSoulAccessCapState(
  objectId: string,
  packageId?: string,
): Promise<VerifiedSoulAccessCapState> {
  const response = await suiClient.getObject({
    id: objectId,
    options: {
      showOwner: true,
      showContent: true,
      showType: true,
    },
  })
  const expectedTypePrefix = `${packageId ?? ''}::grant::SoulAccessCap`
  const { object, fields } = expectMoveObject(response, objectId, expectedTypePrefix)
  const ownerAddress = getObjectOwnerAddress(object.owner)
  if (!ownerAddress) {
    throw new OnChainVerificationError('Soul access cap owner is missing on chain')
  }

  return {
    objectId,
    ownerAddress,
    soulObjectId: readObjectId(fields.soul_id, 'SoulAccessCap soul_id'),
    agentAddress: readAddress(fields.agent, 'SoulAccessCap agent'),
    grantVersion: readBigInt(fields.grant_version, 'SoulAccessCap grant_version'),
  }
}

export function ensureTransactionSucceeded(transaction: TransactionLike) {
  if (transaction.effects?.status?.status !== 'success') {
    throw new OnChainVerificationError('On-chain transaction did not succeed')
  }
}

function extractTypedEvent(
  transaction: TransactionLike,
  type: string,
): Record<string, unknown> | null {
  const event = transaction.events?.find((item) => item?.type === type)
  return event ? asRecord(event.parsedJson) : null
}

export function extractSoulListingEvent(
  transaction: TransactionLike,
  packageId: string,
): VerifiedSoulListedEvent {
  const event = extractTypedEvent(transaction, `${packageId}::market::SoulListed`)
  if (!event) {
    throw new OnChainVerificationError('Soul listing event is missing from the transaction')
  }
  return {
    soulObjectId: readObjectId(event.soul_id, 'SoulListed soul_id'),
    sellerKioskId: readObjectId(event.kiosk_id, 'SoulListed kiosk_id'),
    sellerAddress: readAddress(event.seller, 'SoulListed seller'),
    priceSui: readBigInt(event.price, 'SoulListed price'),
  }
}

export function extractSoulPurchasedEvent(
  transaction: TransactionLike,
  packageId: string,
): VerifiedSoulPurchasedEvent {
  const event = extractTypedEvent(transaction, `${packageId}::market::SoulPurchased`)
  if (!event) {
    throw new OnChainVerificationError('Soul purchase event is missing from the transaction')
  }
  return {
    soulObjectId: readObjectId(event.soul_id, 'SoulPurchased soul_id'),
    sellerKioskId: readObjectId(event.seller_kiosk_id, 'SoulPurchased seller_kiosk_id'),
    buyerAddress: readAddress(event.buyer, 'SoulPurchased buyer'),
    priceSui: readBigInt(event.price, 'SoulPurchased price'),
    platformFeeSui: readBigInt(event.platform_fee, 'SoulPurchased platform_fee'),
    royaltyFeeSui: readBigInt(event.royalty_fee, 'SoulPurchased royalty_fee'),
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
