import { suiClient } from '@web/lib/sui'
import { isValidSuiAddress, normalizeSuiAddress } from '@mysten/sui/utils'

type TransactionLike = {
  digest?: string
  effects?: { status?: { status?: string | null } | null } | null
  objectChanges?: unknown[] | null
  transaction?: {
    data?: {
      sender?: string | null
    } | null
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

type PassType = 'perpetual' | 'subscription'
type PlanType = 'onetime' | 'subscription'

export class OnChainVerificationError extends Error {
  constructor(message: string, readonly status = 422) {
    super(message)
    this.name = 'OnChainVerificationError'
  }
}

export interface VerifiedPassState {
  objectId: string
  passType: PassType
  seriesId: string
  ownerAddress: string
  lockedReleaseId: string | null
  expiresAt: Date | null
  agentGrant: string | null
}

export interface VerifiedSeriesState {
  objectId: string
  name: string
  description: string
  category: string
  tags: string[]
  previewImages: string[]
  authorAddress: string
}

export interface VerifiedReleaseState {
  objectId: string
  seriesId: string
  version: string
  walrusBlobRef: string
  publicMetadataRef: string | null
  contentHash: string
}

export interface VerifiedPricingPlanState {
  objectId: string
  seriesId: string
  planType: PlanType
  priceUsdc: bigint
  periodMs: bigint
  active: boolean
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
  if (!normalizedLeft || !normalizedRight) return false
  return normalizedLeft === normalizedRight
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

function readText(value: unknown, fieldName: string): string {
  if (typeof value === 'string') {
    return value.trim()
  }

  const record = asRecord(value)
  if (record && typeof record.id === 'string') {
    return record.id.trim()
  }

  throw new OnChainVerificationError(`${fieldName} is missing on chain`)
}

function readOptionalString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }

  const record = asRecord(value)
  if (record && typeof record.id === 'string') {
    const trimmed = record.id.trim()
    return trimmed.length > 0 ? trimmed : null
  }

  return null
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

function readBigInt(value: unknown, fieldName: string): bigint {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.trunc(value))
  if (typeof value === 'string' && value.trim().length > 0) return BigInt(value.trim())

  throw new OnChainVerificationError(`${fieldName} is missing on chain`)
}

export function dateFromSafeMsBigInt(value: bigint, fieldName: string): Date {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new OnChainVerificationError(`${fieldName} exceeds the supported timestamp range on chain`)
  }

  return new Date(Number(value))
}

function readBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value === 'boolean') return value
  throw new OnChainVerificationError(`${fieldName} is missing on chain`)
}

function readOptionalAddress(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim()
  }

  if (Array.isArray(value)) {
    return readOptionalAddress(value[0])
  }

  const record = asRecord(value)
  if (!record) return null

  if (typeof record.id === 'string' && record.id.trim().length > 0) {
    return record.id.trim()
  }

  if (Array.isArray(record.vec)) {
    return readOptionalAddress(record.vec)
  }

  return null
}

function bytesToHex(value: unknown): string {
  if (typeof value === 'string') {
    return value.startsWith('0x') ? value.slice(2).toLowerCase() : value.toLowerCase()
  }
  if (!Array.isArray(value)) {
    throw new OnChainVerificationError('content_hash is missing on chain')
  }

  return value
    .map((item) => {
      if (typeof item !== 'number' || !Number.isInteger(item) || item < 0 || item > 255) {
        throw new OnChainVerificationError('content_hash is malformed on chain')
      }
      return item.toString(16).padStart(2, '0')
    })
    .join('')
}

function getObjectOwnerAddress(owner: unknown): string | null {
  const record = asRecord(owner)
  if (!record) return null
  return typeof record.AddressOwner === 'string' ? record.AddressOwner : null
}

function getChangeSender(change: unknown): string | null {
  const record = asRecord(change)
  return typeof record?.sender === 'string' ? record.sender : null
}

function getTransactionSender(transaction: TransactionLike): string | null {
  return typeof transaction.transaction?.data?.sender === 'string'
    ? transaction.transaction.data.sender
    : null
}

function getObjectFields(object: ObjectLike, label: string) {
  const data = object.data
  if (!data) {
    throw new OnChainVerificationError(`${label} not found on chain`)
  }

  const content = data.content
  const fields = asRecord(content?.fields)
  if (!content || content.dataType !== 'moveObject' || !fields) {
    throw new OnChainVerificationError(`${label} is not a Move object`)
  }

  return {
    objectId: readString(data.objectId, `${label} id`),
    type: readString(data.type ?? content.type, `${label} type`),
    ownerAddress: getObjectOwnerAddress(data.owner),
    fields,
  }
}

function isPerpetualPass(type: string) {
  return type.includes('::pass::PerpetualPass')
}

function isSubscriptionPass(type: string) {
  return type.includes('::pass::SubscriptionPass')
}

function isPassType(type: string) {
  return isPerpetualPass(type) || isSubscriptionPass(type)
}

function parsePassType(type: string): PassType {
  if (isSubscriptionPass(type)) return 'subscription'
  if (isPerpetualPass(type)) return 'perpetual'
  throw new OnChainVerificationError('Referenced object is not a Soul pass')
}

function readPassStateFromObject(object: ObjectLike): VerifiedPassState {
  const { objectId, type, ownerAddress: objectOwnerAddress, fields } = getObjectFields(object, 'Pass')
  if (!isPassType(type)) {
    throw new OnChainVerificationError('Referenced object is not a Soul pass')
  }

  const passType = parsePassType(type)
  const ownerAddress = readString(fields.owner, 'Pass owner')
  if (objectOwnerAddress && !sameSuiValue(ownerAddress, objectOwnerAddress)) {
    throw new OnChainVerificationError('Pass owner does not match on-chain ownership')
  }

  return {
    objectId,
    passType,
    seriesId: readString(fields.series_id, 'Pass series_id'),
    ownerAddress,
    lockedReleaseId: passType === 'perpetual'
      ? readString(fields.release_id, 'Pass release_id')
      : null,
    expiresAt: passType === 'subscription'
      ? dateFromSafeMsBigInt(readBigInt(fields.expires_at, 'Pass expires_at'), 'Pass expires_at')
      : null,
    agentGrant: readOptionalAddress(fields.agent_grant),
  }
}

function readSeriesStateFromObject(object: ObjectLike): VerifiedSeriesState {
  const { objectId, type, fields } = getObjectFields(object, 'Series')
  if (!type.includes('::series::SoulSeries')) {
    throw new OnChainVerificationError('Referenced object is not a Soul series')
  }

  return {
    objectId,
    name: readString(fields.name, 'Series name'),
    description: readText(fields.description, 'Series description'),
    category: readString(fields.category, 'Series category'),
    tags: readStringArray(fields.tags),
    previewImages: readStringArray(fields.preview_images),
    authorAddress: readString(fields.author, 'Series author'),
  }
}

function readReleaseStateFromObject(object: ObjectLike): VerifiedReleaseState {
  const { objectId, type, fields } = getObjectFields(object, 'Release')
  if (!type.includes('::series::SoulRelease')) {
    throw new OnChainVerificationError('Referenced object is not a Soul release')
  }

  return {
    objectId,
    seriesId: readString(fields.series_id, 'Release series_id'),
    version: readString(fields.version, 'Release version'),
    walrusBlobRef: readString(fields.encrypted_blob_id, 'Release encrypted_blob_id'),
    publicMetadataRef: readOptionalString(fields.public_metadata_id),
    contentHash: bytesToHex(fields.content_hash),
  }
}

function readPricingPlanStateFromObject(object: ObjectLike): VerifiedPricingPlanState {
  const { objectId, type, fields } = getObjectFields(object, 'Pricing plan')
  if (!type.includes('::purchase::PricingPlan')) {
    throw new OnChainVerificationError('Referenced object is not a pricing plan')
  }

  const planTypeValue = Number(readBigInt(fields.plan_type, 'Pricing plan plan_type'))
  if (planTypeValue !== 0 && planTypeValue !== 1) {
    throw new OnChainVerificationError('Pricing plan type is invalid on chain')
  }

  return {
    objectId,
    seriesId: readString(fields.series_id, 'Pricing plan series_id'),
    planType: planTypeValue === 0 ? 'onetime' : 'subscription',
    priceUsdc: readBigInt(fields.price_usdc, 'Pricing plan price_usdc'),
    periodMs: readBigInt(fields.period_ms, 'Pricing plan period_ms'),
    active: readBoolean(fields.active, 'Pricing plan active'),
  }
}

export function ensureTransactionSucceeded(transaction: TransactionLike, fallbackMessage = 'Transaction did not succeed') {
  if (transaction.effects?.status?.status !== 'success') {
    throw new OnChainVerificationError(fallbackMessage)
  }
}

function findMatchingPassChange(
  transaction: TransactionLike,
  passOnChainId: string,
  changeTypes: Array<'created' | 'mutated'>,
) {
  const wantedId = normalizeSuiValue(passOnChainId)
  const changes = Array.isArray(transaction.objectChanges) ? transaction.objectChanges : []

  return changes.find((change) => {
    const record = asRecord(change)
    if (!record) return false
    if (!changeTypes.includes(record.type as 'created' | 'mutated')) return false
    if (typeof record.objectId !== 'string' || normalizeSuiValue(record.objectId) !== wantedId) return false
    if (typeof record.objectType !== 'string' || !isPassType(record.objectType)) return false
    return true
  })
}

function findMatchingObjectChange(
  transaction: TransactionLike,
  objectOnChainId: string,
  changeTypes: Array<'created' | 'mutated'>,
) {
  const wantedId = normalizeSuiValue(objectOnChainId)
  const changes = Array.isArray(transaction.objectChanges) ? transaction.objectChanges : []

  return changes.find((change) => {
    const record = asRecord(change)
    if (!record) return false
    if (!changeTypes.includes(record.type as 'created' | 'mutated')) return false
    if (typeof record.objectId !== 'string' || normalizeSuiValue(record.objectId) !== wantedId) return false
    return true
  })
}

function verifyExpectedSender(
  transaction: TransactionLike,
  change: unknown,
  expectedSender: string,
) {
  const sender = getChangeSender(change) ?? getTransactionSender(transaction)
  if (!sender) {
    throw new OnChainVerificationError('Unable to determine transaction sender for verification')
  }
  if (!sameSuiValue(sender, expectedSender)) {
    throw new OnChainVerificationError('Transaction sender does not match the expected wallet')
  }
}

export function assertPassChange(transaction: TransactionLike, params: {
  passOnChainId: string
  changeTypes: Array<'created' | 'mutated'>
  errorMessage: string
  expectedSender?: string | null
}) {
  const change = findMatchingPassChange(transaction, params.passOnChainId, params.changeTypes)
  if (!change) {
    throw new OnChainVerificationError(params.errorMessage)
  }

  if (params.expectedSender) {
    verifyExpectedSender(transaction, change, params.expectedSender)
  }

  return change
}

export function assertCreatedObjectChange(transaction: TransactionLike, params: {
  objectOnChainId: string
  errorMessage: string
  expectedTypeIncludes?: string | string[]
  expectedSender?: string | null
}) {
  const change = findMatchingObjectChange(transaction, params.objectOnChainId, ['created'])
  if (!change) {
    throw new OnChainVerificationError(params.errorMessage)
  }

  const record = asRecord(change)
  const expectedTypes = params.expectedTypeIncludes == null
    ? []
    : Array.isArray(params.expectedTypeIncludes)
      ? params.expectedTypeIncludes
      : [params.expectedTypeIncludes]
  const objectType = typeof record?.objectType === 'string' ? record.objectType : null
  if (
    expectedTypes.length > 0
    && (
      !objectType
      || !expectedTypes.some((expectedType) => objectType.includes(expectedType))
    )
  ) {
    throw new OnChainVerificationError(params.errorMessage)
  }

  if (params.expectedSender) {
    verifyExpectedSender(transaction, change, params.expectedSender)
  }

  return change
}

export async function getSuccessfulTransaction(digest: string) {
  const transaction = await suiClient.getTransactionBlock({
    digest,
    options: {
      showEffects: true,
      showInput: true,
      showObjectChanges: true,
    },
  })

  ensureTransactionSucceeded(transaction as TransactionLike)
  return transaction
}

export async function getVerifiedPassState(passOnChainId: string) {
  const object = await suiClient.getObject({
    id: passOnChainId,
    options: {
      showContent: true,
      showOwner: true,
      showType: true,
    },
  })

  return readPassStateFromObject(object as ObjectLike)
}

export async function getVerifiedSeriesState(seriesOnChainId: string) {
  const object = await suiClient.getObject({
    id: seriesOnChainId,
    options: {
      showContent: true,
      showType: true,
    },
  })

  return readSeriesStateFromObject(object as ObjectLike)
}

export async function getVerifiedReleaseState(releaseOnChainId: string) {
  const object = await suiClient.getObject({
    id: releaseOnChainId,
    options: {
      showContent: true,
      showType: true,
    },
  })

  return readReleaseStateFromObject(object as ObjectLike)
}

export async function getVerifiedPricingPlanState(planOnChainId: string) {
  const object = await suiClient.getObject({
    id: planOnChainId,
    options: {
      showContent: true,
      showType: true,
    },
  })

  return readPricingPlanStateFromObject(object as ObjectLike)
}
