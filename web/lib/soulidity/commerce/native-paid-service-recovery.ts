import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { fromBase58, toBase58 } from '@mysten/sui/utils'
import { MAINNET_GENESIS_DIGEST } from '../../animacraft/mainnet-chain'
import type { PinnedMovePackage } from '../../sui/pinned-move-package'
import { publicMutationCanonical, type PublicMutationPacket } from '../../sui/public-mutation-journal'
import { commerceCheck, commerceId } from './economics-read'
import { readNativePaidServiceBeneficiaryFunds, readNativePaidServiceOriginalProceeds } from './native-paid-service-beneficiary-funds'
import { PaidContentOfferBcs } from './paid-content-policy'

const REVIEW_SCHEMA = 'soulidity.native-paid-service-recovery.v1'
export const NATIVE_PAID_SERVICE_REVIEW_MAX_BYTES = 32_768
export const NATIVE_PAID_SERVICE_PACKET_MAX_BYTES = 220_000
const phases: ReadonlySet<string> = new Set(['PREPARED', 'SIGNING', 'SIGNED', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'RETIRED'])
type Readback = Parameters<typeof readNativePaidServiceBeneficiaryFunds>[0]
type Review = Pick<Readback, 'intent' | 'gas' | 'offer' | 'soulId' | 'stateId' | 'ledgerId' | 'native' | 'content' | 'foundation' | 'serviceContext'>

function fields(value: unknown, names: readonly string[]): asserts value is Record<string, unknown> {
  commerceCheck(value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name)),
  'PAID_SERVICE_RECOVERY_FIELDS')
}

function parseJson(text: string, limit: number): unknown {
  commerceCheck(text.length > 0 && text.length <= limit && new TextEncoder().encode(text).length <= limit,
    'PAID_SERVICE_RECOVERY_FILE_BOUND')
  return JSON.parse(text)
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && commerceId(value)
}

function isDigest(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 44 || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(value)) return false
  const raw = fromBase58(value)
  return raw.length === 32 && toBase58(raw) === value
}

function reviewedBytes(value: unknown) {
  commerceCheck(Array.isArray(value) && value.length === 32 && value.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255),
    'PAID_SERVICE_RECOVERY_REVIEW_BYTES')
  return Uint8Array.from(value)
}

function pin(value: unknown): asserts value is PinnedMovePackage {
  fields(value, ['originalPackageId', 'callablePackageId', 'callableDigest'])
  commerceCheck(isId(value.originalPackageId) && isId(value.callablePackageId) && isDigest(value.callableDigest),
    'PAID_SERVICE_RECOVERY_PIN')
}

function parseReview(text: string) {
  const review = parseJson(text, NATIVE_PAID_SERVICE_REVIEW_MAX_BYTES)
  fields(review, ['schema', 'genesisDigest', 'transactionDigest', 'beneficiary', 'intent', 'gas', 'offer',
    'soulId', 'stateId', 'ledgerId', 'native', 'content', 'foundation', 'serviceContext'])
  const { beneficiary, transactionDigest, intent, offer, gas, serviceContext } = review
  commerceCheck(review.schema === REVIEW_SCHEMA && review.genesisDigest === MAINNET_GENESIS_DIGEST
    && isId(beneficiary) && isDigest(transactionDigest)
    && [review.soulId, review.stateId, review.ledgerId].every(isId)
    && new Set([review.soulId, review.stateId, review.ledgerId]).size === 3, 'PAID_SERVICE_RECOVERY_CASE')
  fields(serviceContext, ['standard', 'custody'])
  pin(review.native)
  for (const item of [review.content, review.foundation, serviceContext.standard, serviceContext.custody]) pin(item)

  fields(intent, ['buyer', 'nativeCallablePackageId', 'coinType', 'registry', 'config', 'service', 'kiosk', 'kind', 'quote',
    'entryHash', 'feeRevision', 'quoteExpiryMs', 'attempt', 'rootRevision', 'paymentCoin'])
  commerceCheck(intent.nativeCallablePackageId === review.native.callablePackageId,
    'PAID_SERVICE_RECOVERY_CALLABLE')
  for (const ref of [intent.registry, intent.config, intent.service, intent.kiosk]) fields(ref, ['objectId', 'initialSharedVersion'])
  fields(intent.paymentCoin, ['objectId', 'version', 'digest', 'balance'])
  fields(intent.quote, ['hash', 'total'])
  intent.quote.hash = reviewedBytes(intent.quote.hash)
  intent.attempt = reviewedBytes(intent.attempt)
  if (intent.entryHash !== null) intent.entryHash = reviewedBytes(intent.entryHash)

  fields(gas, ['budget', 'price', 'coins'])
  commerceCheck(Array.isArray(gas.coins) && gas.coins.length > 0 && gas.coins.length <= 256, 'PAID_SERVICE_RECOVERY_GAS')
  for (const coin of gas.coins) fields(coin, ['objectId', 'version', 'digest'])
  fields(offer, ['issuer', 'generation', 'price', 'scope', 'duration', 'revision'])
  commerceCheck(offer.issuer === beneficiary, 'PAID_SERVICE_RECOVERY_BENEFICIARY')
  const canonicalOffer = PaidContentOfferBcs.parse(PaidContentOfferBcs.serialize(offer as Review['offer']).toBytes())
  commerceCheck(publicMutationCanonical(canonicalOffer) === publicMutationCanonical(offer), 'PAID_SERVICE_RECOVERY_OFFER')
  // The historical reader validates all transaction arguments against the full
  // original kind and gas, then binds the reviewed object IDs on chain.
  return { input: review as unknown as Review, beneficiary, transactionDigest }
}

function parsePacket(text: string, reviewedDigest: string): PublicMutationPacket {
  const packet = parseJson(text, NATIVE_PAID_SERVICE_PACKET_MAX_BYTES)
  fields(packet, ['bytes', 'digest', 'expirationEpoch', 'phase', 'signature'])
  commerceCheck(typeof packet.bytes === 'string' && typeof packet.expirationEpoch === 'string'
    && packet.digest === reviewedDigest && typeof packet.phase === 'string' && phases.has(packet.phase)
    && (packet.signature === null || typeof packet.signature === 'string' && packet.signature.length > 0 && packet.signature.length <= 32768),
  'PAID_SERVICE_RECOVERY_PACKET')
  return packet as unknown as PublicMutationPacket
}

type RecoveryInput = {
  client: SuiGrpcClient
  reviewText: string
  packetText: string
  signal: AbortSignal
}

function recoveryInput(input: RecoveryInput, expectedSoulId?: string) {
  const { input: review, beneficiary, transactionDigest } = parseReview(input.reviewText)
  commerceCheck(expectedSoulId === undefined || review.soulId === expectedSoulId, 'PAID_SERVICE_RECOVERY_SOUL')
  const packet = parsePacket(input.packetText, transactionDigest)
  const { client, signal } = input
  return { beneficiary, transactionDigest, history: {
    ...review, client, signal, packet, proveTreeHistory: true, proveOpeningHistory: true,
  } }
}

/** Verify the original for the page's Soul before making any current balance query. */
export async function queryNativePaidServiceRecoveryHistory(input: RecoveryInput & { soulId: string }) {
  const { beneficiary, transactionDigest, history } = recoveryInput(input, input.soulId)
  const result = await readNativePaidServiceOriginalProceeds(history)
  if (result.status === 'ORIGINAL_SERVICE_BACKED_PROCEEDS') {
    commerceCheck(result.originalProceeds.owner === beneficiary, 'PAID_SERVICE_RECOVERY_BENEFICIARY')
  }
  return { transactionDigest, beneficiary, ...result }
}

/** Read-only operator case with both original and current observations. */
export async function verifyNativePaidServiceRecovery(input: RecoveryInput) {
  const { beneficiary, transactionDigest, history } = recoveryInput(input)
  const result = await readNativePaidServiceBeneficiaryFunds({
    ...history, viewerAddress: beneficiary, getViewerAddress: () => beneficiary,
  })
  return { transactionDigest, beneficiary, ...result }
}
