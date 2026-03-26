import { suiClient } from '@web/lib/sui'
import { isValidSuiAddress, normalizeSuiAddress } from '@mysten/sui/utils'

type TransactionLike = {
  digest?: string
  effects?: { status?: { status?: string | null } | null } | null
  objectChanges?: unknown[] | null
  transaction?: {
    data?: {
      sender?: string | null
      transaction?: unknown
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
const MAX_ON_CHAIN_DECIMAL_BIGINT_LENGTH = 78

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
  latestReleaseId: string | null
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

export interface VerifiedSoulPurchaseIntent {
  planId: string
  planType: PlanType
  releaseId: string | null
  seriesId: string
}

export interface VerifiedSoulRenewIntent {
  planId: string
  seriesId: string
  passId: string
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

function readBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value === 'boolean') return value
  throw new OnChainVerificationError(`${fieldName} is missing on chain`)
}

const OPTIONAL_ADDRESS_MAX_DEPTH = 4
const OPTIONAL_OBJECT_ID_MAX_DEPTH = 4

function readOptionalAddress(value: unknown, depth = 0): string | null {
  if (depth > OPTIONAL_ADDRESS_MAX_DEPTH) {
    throw new OnChainVerificationError('Pass agent_grant nesting exceeds the supported on-chain depth')
  }

  if (typeof value === 'string') {
    const normalized = normalizeSuiValue(value)
    if (!normalized) {
      throw new OnChainVerificationError('Pass agent_grant is malformed on chain')
    }
    return normalized
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return null
    return readOptionalAddress(value[0], depth + 1)
  }

  const record = asRecord(value)
  if (!record) return null

  if ('id' in record) {
    if (typeof record.id !== 'string') {
      throw new OnChainVerificationError('Pass agent_grant is malformed on chain')
    }
    const normalized = normalizeSuiValue(record.id)
    if (!normalized) {
      throw new OnChainVerificationError('Pass agent_grant is malformed on chain')
    }
    return normalized
  }

  if (Array.isArray(record.vec)) {
    return readOptionalAddress(record.vec, depth + 1)
  }

  return null
}

function readOptionalObjectId(value: unknown, fieldName: string, depth = 0): string | null {
  if (depth > OPTIONAL_OBJECT_ID_MAX_DEPTH) {
    throw new OnChainVerificationError(`${fieldName} nesting exceeds the supported on-chain depth`)
  }

  if (value == null) {
    return null
  }

  if (typeof value === 'string') {
    const normalized = normalizeSuiValue(value)
    if (!normalized) {
      throw new OnChainVerificationError(`${fieldName} is malformed on chain`)
    }
    return normalized
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return null
    if (value.length !== 1) {
      throw new OnChainVerificationError(`${fieldName} is malformed on chain`)
    }
    return readOptionalObjectId(value[0], fieldName, depth + 1)
  }

  const record = asRecord(value)
  if (!record) {
    throw new OnChainVerificationError(`${fieldName} is malformed on chain`)
  }

  if ('id' in record) {
    if (typeof record.id !== 'string') {
      throw new OnChainVerificationError(`${fieldName} is malformed on chain`)
    }
    const normalized = normalizeSuiValue(record.id)
    if (!normalized) {
      throw new OnChainVerificationError(`${fieldName} is malformed on chain`)
    }
    return normalized
  }

  if ('vec' in record) {
    if (!Array.isArray(record.vec)) {
      throw new OnChainVerificationError(`${fieldName} is malformed on chain`)
    }
    if (record.vec.length === 0) return null
    if (record.vec.length !== 1) {
      throw new OnChainVerificationError(`${fieldName} is malformed on chain`)
    }
    return readOptionalObjectId(record.vec[0], fieldName, depth + 1)
  }

  throw new OnChainVerificationError(`${fieldName} is malformed on chain`)
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

function getProgrammableTransactionData(transaction: TransactionLike): {
  inputs: unknown[]
  transactions: unknown[]
} {
  const programmableTx = asRecord(transaction.transaction?.data?.transaction)
  if (
    !programmableTx
    || programmableTx.kind !== 'ProgrammableTransaction'
    || !Array.isArray(programmableTx.inputs)
    || !Array.isArray(programmableTx.transactions)
  ) {
    throw new OnChainVerificationError('Transaction input data is unavailable for verification', 503)
  }

  return {
    inputs: programmableTx.inputs,
    transactions: programmableTx.transactions,
  }
}

function readObjectInputIdFromArgument(
  inputs: unknown[],
  argument: unknown,
  fieldName: string,
): string {
  const argumentRecord = asRecord(argument)
  const rawIndex = argumentRecord?.Input
  if (!Number.isInteger(rawIndex)) {
    throw new OnChainVerificationError(`${fieldName} is missing from the transaction inputs`)
  }
  const inputIndex = rawIndex as number
  if (inputIndex < 0 || inputIndex >= inputs.length) {
    throw new OnChainVerificationError(`${fieldName} is missing from the transaction inputs`)
  }

  const inputRecord = asRecord(inputs[inputIndex])
  if (
    !inputRecord
    || inputRecord.type !== 'object'
    || typeof inputRecord.objectId !== 'string'
    || inputRecord.objectId.trim().length === 0
  ) {
    throw new OnChainVerificationError(`${fieldName} is missing from the transaction inputs`)
  }

  return inputRecord.objectId.trim()
}

function readPurchaseIntentFromMoveCall(
  moveCall: Record<string, unknown>,
  inputs: unknown[],
  expectedPackageId?: string | null,
): VerifiedSoulPurchaseIntent | null {
  const moveCallPackage = typeof moveCall.package === 'string' ? moveCall.package : null
  const moveCallModule = typeof moveCall.module === 'string' ? moveCall.module : null
  const moveCallFunction = typeof moveCall.function === 'string' ? moveCall.function : null
  if (!moveCallPackage || !moveCallModule || !moveCallFunction) {
    return null
  }

  if (expectedPackageId && !sameSuiValue(moveCallPackage, expectedPackageId)) {
    return null
  }
  if (moveCallModule !== 'purchase') {
    return null
  }

  const argumentsList = Array.isArray(moveCall.arguments) ? moveCall.arguments : null
  if (!argumentsList) {
    throw new OnChainVerificationError('Transaction purchase inputs are unavailable for verification', 503)
  }

  if (moveCallFunction === 'buy_perpetual') {
    return {
      planId: readObjectInputIdFromArgument(inputs, argumentsList[1], 'Purchase pricing plan'),
      planType: 'onetime',
      releaseId: readObjectInputIdFromArgument(inputs, argumentsList[3], 'Purchase release'),
      seriesId: readObjectInputIdFromArgument(inputs, argumentsList[2], 'Purchase series'),
    }
  }

  if (moveCallFunction === 'buy_subscription') {
    return {
      planId: readObjectInputIdFromArgument(inputs, argumentsList[1], 'Purchase pricing plan'),
      planType: 'subscription',
      releaseId: null,
      seriesId: readObjectInputIdFromArgument(inputs, argumentsList[2], 'Purchase series'),
    }
  }

  return null
}

function readRenewIntentFromMoveCall(
  moveCall: Record<string, unknown>,
  inputs: unknown[],
  expectedPackageId?: string | null,
): VerifiedSoulRenewIntent | null {
  const moveCallPackage = typeof moveCall.package === 'string' ? moveCall.package : null
  const moveCallModule = typeof moveCall.module === 'string' ? moveCall.module : null
  const moveCallFunction = typeof moveCall.function === 'string' ? moveCall.function : null
  if (!moveCallPackage || !moveCallModule || !moveCallFunction) {
    return null
  }

  if (expectedPackageId && !sameSuiValue(moveCallPackage, expectedPackageId)) {
    return null
  }
  if (moveCallModule !== 'purchase') {
    return null
  }
  if (moveCallFunction !== 'renew_subscription') {
    return null
  }

  const argumentsList = Array.isArray(moveCall.arguments) ? moveCall.arguments : null
  if (!argumentsList) {
    throw new OnChainVerificationError('Transaction renew inputs are unavailable for verification', 503)
  }

  return {
    planId: readObjectInputIdFromArgument(inputs, argumentsList[1], 'Renew pricing plan'),
    seriesId: readObjectInputIdFromArgument(inputs, argumentsList[2], 'Renew series'),
    passId: readObjectInputIdFromArgument(inputs, argumentsList[3], 'Renew pass'),
  }
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

function parseObjectType(type: string): { packageId: string; remainder: string } | null {
  const separatorIndex = type.indexOf('::')
  if (separatorIndex <= 0) {
    return null
  }

  const packageId = normalizeSuiValue(type.slice(0, separatorIndex))
  const remainder = type.slice(separatorIndex + 2)
  if (!packageId || remainder.length === 0) {
    return null
  }

  return { packageId, remainder }
}

function matchesExpectedObjectType(
  type: string,
  expectedTypes: string[],
  expectedPackageId?: string | null,
): boolean {
  const parsed = parseObjectType(type)
  if (!parsed) {
    return false
  }

  const normalizedExpectedPackageId = expectedPackageId ? normalizeSuiValue(expectedPackageId) : null
  if (normalizedExpectedPackageId && parsed.packageId !== normalizedExpectedPackageId) {
    return false
  }

  return expectedTypes.some((expectedType) => parsed.remainder === expectedType)
}

function isPerpetualPass(type: string, expectedPackageId?: string | null) {
  return matchesExpectedObjectType(type, ['pass::PerpetualPass'], expectedPackageId)
}

function isSubscriptionPass(type: string, expectedPackageId?: string | null) {
  return matchesExpectedObjectType(type, ['pass::SubscriptionPass'], expectedPackageId)
}

function isPassType(type: string, expectedPackageId?: string | null) {
  return isPerpetualPass(type, expectedPackageId) || isSubscriptionPass(type, expectedPackageId)
}

function parsePassType(type: string, expectedPackageId?: string | null): PassType {
  if (isSubscriptionPass(type, expectedPackageId)) return 'subscription'
  if (isPerpetualPass(type, expectedPackageId)) return 'perpetual'
  throw new OnChainVerificationError('Referenced object is not a Soul pass')
}

function readPassStateFromObject(
  object: ObjectLike,
  expectedPackageId?: string | null,
): VerifiedPassState {
  const { objectId, type, ownerAddress: objectOwnerAddress, fields } = getObjectFields(object, 'Pass')
  if (!isPassType(type, expectedPackageId)) {
    throw new OnChainVerificationError('Referenced object is not a Soul pass')
  }

  const passType = parsePassType(type, expectedPackageId)
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

function readSeriesStateFromObject(object: ObjectLike, expectedPackageId?: string | null): VerifiedSeriesState {
  const { objectId, type, fields } = getObjectFields(object, 'Series')
  if (!matchesExpectedObjectType(type, ['series::SoulSeries'], expectedPackageId)) {
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
    latestReleaseId: readOptionalObjectId(fields.latest_release_id, 'Series latest_release_id'),
  }
}

function readReleaseStateFromObject(object: ObjectLike, expectedPackageId?: string | null): VerifiedReleaseState {
  const { objectId, type, fields } = getObjectFields(object, 'Release')
  if (!matchesExpectedObjectType(type, ['series::SoulRelease'], expectedPackageId)) {
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

function readPricingPlanStateFromObject(object: ObjectLike, expectedPackageId?: string | null): VerifiedPricingPlanState {
  const { objectId, type, fields } = getObjectFields(object, 'Pricing plan')
  if (!matchesExpectedObjectType(type, ['purchase::PricingPlan'], expectedPackageId)) {
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
  expectedPackageId?: string | null,
) {
  const wantedId = normalizeSuiValue(passOnChainId)
  const changes = Array.isArray(transaction.objectChanges) ? transaction.objectChanges : []

  return changes.find((change) => {
    const record = asRecord(change)
    if (!record) return false
    if (!changeTypes.includes(record.type as 'created' | 'mutated')) return false
    if (typeof record.objectId !== 'string' || normalizeSuiValue(record.objectId) !== wantedId) return false
    if (typeof record.objectType !== 'string' || !isPassType(record.objectType, expectedPackageId)) return false
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
  expectedSender: string | string[],
) {
  const sender = getChangeSender(change) ?? getTransactionSender(transaction)
  if (!sender) {
    throw new OnChainVerificationError('Unable to determine transaction sender for verification')
  }

  const allowedSenders = Array.isArray(expectedSender) ? expectedSender : [expectedSender]
  if (!allowedSenders.some((candidate) => sameSuiValue(sender, candidate))) {
    throw new OnChainVerificationError('Transaction sender does not match the expected wallet')
  }
}

export function assertPassChange(transaction: TransactionLike, params: {
  passOnChainId: string
  changeTypes: Array<'created' | 'mutated'>
  errorMessage: string
  expectedSender?: string | string[] | null
  expectedPackageId?: string | null
}) {
  const change = findMatchingPassChange(
    transaction,
    params.passOnChainId,
    params.changeTypes,
    params.expectedPackageId,
  )
  if (!change) {
    throw new OnChainVerificationError(params.errorMessage)
  }

  if (params.expectedSender) {
    verifyExpectedSender(transaction, change, params.expectedSender)
  }

  return change
}

export function getVerifiedSoulPurchaseIntents(
  transaction: TransactionLike,
  expectedPackageId?: string | null,
): VerifiedSoulPurchaseIntent[] {
  const { inputs, transactions } = getProgrammableTransactionData(transaction)

  return transactions.flatMap((entry) => {
    const transactionRecord = asRecord(entry)
    const moveCall = asRecord(transactionRecord?.MoveCall)
    if (!moveCall) {
      return []
    }

    const purchaseIntent = readPurchaseIntentFromMoveCall(moveCall, inputs, expectedPackageId)
    return purchaseIntent ? [purchaseIntent] : []
  })
}

export function getVerifiedSoulRenewIntents(
  transaction: TransactionLike,
  expectedPackageId?: string | null,
): VerifiedSoulRenewIntent[] {
  const { inputs, transactions } = getProgrammableTransactionData(transaction)

  return transactions.flatMap((entry) => {
    const transactionRecord = asRecord(entry)
    const moveCall = asRecord(transactionRecord?.MoveCall)
    if (!moveCall) {
      return []
    }

    const renewIntent = readRenewIntentFromMoveCall(moveCall, inputs, expectedPackageId)
    return renewIntent ? [renewIntent] : []
  })
}

export function assertCreatedObjectChange(transaction: TransactionLike, params: {
  objectOnChainId: string
  errorMessage: string
  expectedType?: string | string[]
  expectedPackageId?: string | null
  expectedSender?: string | null
}) {
  const change = findMatchingObjectChange(transaction, params.objectOnChainId, ['created'])
  if (!change) {
    throw new OnChainVerificationError(params.errorMessage)
  }

  const record = asRecord(change)
  const expectedTypes = params.expectedType == null
    ? []
    : Array.isArray(params.expectedType)
      ? params.expectedType
      : [params.expectedType]
  const objectType = typeof record?.objectType === 'string' ? record.objectType : null
  if (
    expectedTypes.length > 0
    && (
      !objectType
      || !matchesExpectedObjectType(objectType, expectedTypes, params.expectedPackageId)
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

export async function getVerifiedPassState(passOnChainId: string, expectedPackageId?: string | null) {
  const object = await suiClient.getObject({
    id: passOnChainId,
    options: {
      showContent: true,
      showOwner: true,
      showType: true,
    },
  })

  return readPassStateFromObject(object as ObjectLike, expectedPackageId)
}

export async function getVerifiedSeriesState(seriesOnChainId: string, expectedPackageId?: string | null) {
  const object = await suiClient.getObject({
    id: seriesOnChainId,
    options: {
      showContent: true,
      showType: true,
    },
  })

  return readSeriesStateFromObject(object as ObjectLike, expectedPackageId)
}

export async function getVerifiedReleaseState(releaseOnChainId: string, expectedPackageId?: string | null) {
  const object = await suiClient.getObject({
    id: releaseOnChainId,
    options: {
      showContent: true,
      showType: true,
    },
  })

  return readReleaseStateFromObject(object as ObjectLike, expectedPackageId)
}

export async function getVerifiedPricingPlanState(planOnChainId: string, expectedPackageId?: string | null) {
  const object = await suiClient.getObject({
    id: planOnChainId,
    options: {
      showContent: true,
      showType: true,
    },
  })

  return readPricingPlanStateFromObject(object as ObjectLike, expectedPackageId)
}
