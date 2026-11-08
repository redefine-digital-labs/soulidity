import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { assertNativeSaleRetirementUnchanged, retiredNativeSaleResult, validateNativeSaleRetirement,
  verifyNativeSaleRetirement, type NativeSaleRetirement } from './commerce/native-sale-original-retirement'
import { fromBase58, fromBase64, toBase58, toBase64 } from '@mysten/sui/utils'
import { createAsyncPublicMutationStore, publicMutationCanonical as canonical, type PublicMutationPacket } from '../sui/public-mutation-journal'
import { parseCanonicalNativeWorkbenchTarget } from './canonical-native-workbench'
import { commerceCheck as check, commerceId } from './commerce/economics-read'
import { parseIncomeObservationTarget } from './commerce/income-source-qualification'
import { readNativeSaleCancellationHistory } from './commerce/native-sale-cancellation'
import { readNativeSaleListingHistory } from './commerce/native-sale-relist'
import { assertNativeSellerPacket, sellerListingBinding, type NativeSellerPlan } from './commerce/native-sale-seller-plan'
import type { SoulAccessAssetScope } from './soul-access-asset-lock'

export const NATIVE_SELLER_PREFIX = 'soulidity.native-sale-seller.v1:'
const terminal = ['SUCCEEDED', 'FAILED', 'CANCELLED', 'RETIRED']
export interface NativeSellerRecord {
  schema: 'soulidity.native-sale-seller.v1'
  plan: NativeSellerPlan
  packet: PublicMutationPacket
  retirement?: NativeSaleRetirement
}
export const nativeSellerScope = (plan: NativeSellerPlan) => ({
  chainIdentifier: plan.release.target.chainIdentifier, soulId: plan.intent.soulId, author: plan.intent.seller,
})
export function nativeSellerKey(scope: SoulAccessAssetScope) {
  check(scope.chainIdentifier === '35834a8a' && commerceId(scope.soulId) && commerceId(scope.author), 'SELLER_SCOPE')
  return NATIVE_SELLER_PREFIX + [scope.chainIdentifier, scope.soulId, scope.author].join(':')
}

export async function parseNativeSellerRecord(value: unknown) {
  const record = structuredClone(value) as NativeSellerRecord
  const exact = (row: object, names: string) => check(row && Object.keys(row).sort().join(',') === names, 'SELLER_RECORD_FIELDS')
  exact(record, record?.packet?.phase === 'RETIRED' ? 'packet,plan,retirement,schema' : 'packet,plan,schema')
  exact(record.plan, 'account,expirationEpoch,gas,intent,kioskId,offerDigest,release,shared,snapshot')
  const { plan, packet } = record
  exact(plan.release, 'collection,economics,target')
  const target = parseCanonicalNativeWorkbenchTarget(plan.release.target), economics = parseIncomeObservationTarget(plan.release.economics)
  check(record.schema === 'soulidity.native-sale-seller.v1' && target.custody && target.configId === economics.configId
    && canonical(target) === canonical(plan.release.target) && canonical(economics) === canonical(plan.release.economics), 'SELLER_RECORD_RELEASE')
  nativeSellerKey(nativeSellerScope(plan))
  exact(plan.intent, plan.intent.kind === 'LIST' ? 'accountId,ask,collectionId,kind,policyId,seller,soulId' : 'accountId,kind,offerId,seller,soulId')
  if (plan.snapshot) exact(plan.snapshot, 'config_revision,creator,generation,manifestHex,rootRevision,royalty,state')
  exact(packet, 'bytes,digest,expirationEpoch,phase,signature')
  check(typeof packet.bytes === 'string' && packet.bytes.length > 0 && packet.bytes.length <= 180000
    && ['PREPARED', 'SIGNING', 'SIGNED', ...terminal].includes(packet.phase)
    && (packet.signature === null || typeof packet.signature === 'string' && packet.signature.length > 0
      && packet.signature.length <= 32768 && toBase64(fromBase64(packet.signature)) === packet.signature)
    && (packet.phase !== 'SIGNED' || packet.signature !== null)
    && (!['PREPARED', 'SIGNING', 'CANCELLED'].includes(packet.phase) || packet.signature === null), 'SELLER_RECORD_PHASE')
  validateNativeSaleRetirement(packet, record.retirement)
  await assertNativeSellerPacket(plan, packet)
  return record
}

export function browserNativeSellerJournal(readOnly = false) {
  return createAsyncPublicMutationStore<NativeSellerPlan, NativeSellerRecord>({ prefix: NATIVE_SELLER_PREFIX, changedEvent: 'soulidity:native-sale-seller-v1-changed',
    errorPrefix: 'NATIVE_SELLER', key: plan => nativeSellerKey(nativeSellerScope(plan)), parse: parseNativeSellerRecord, readOnly,
    checkTransition: assertNativeSaleRetirementUnchanged,
    classify(name) {
      const parts = name.slice(NATIVE_SELLER_PREFIX.length).split(':')
      const [chainIdentifier, soulId, author, archive, digest, phase] = parts
      check(parts.length === 3 || parts.length === 6 && archive === 'history' && digest && terminal.includes(phase), 'SELLER_ARCHIVE_KEY')
      if (digest) check(fromBase58(digest).length === 32 && toBase58(fromBase58(digest)) === digest, 'SELLER_ARCHIVE_DIGEST')
      return { headKey: nativeSellerKey({ chainIdentifier, soulId, author }), archived: parts.length === 6 }
    },
  })
}

export async function queryNativeSellerOriginal(record: NativeSellerRecord, client: SuiGrpcClient, signal: AbortSignal) {
  const saved = await parseNativeSellerRecord(record)
  const queryOriginal = () => queryNativeSellerHistory(saved, client, signal)
  if (!saved.retirement) return queryOriginal()
  await verifyNativeSaleRetirement({ client, signal, packet: saved.packet, author: saved.plan.intent.seller, saved: saved.retirement, queryOriginal })
  return retiredNativeSaleResult(saved.packet.digest)
}

async function queryNativeSellerHistory({ plan, packet }: NativeSellerRecord, client: SuiGrpcClient, signal: AbortSignal) {
  const { target } = plan.release, { intent } = plan
  if (intent.kind === 'LIST') {
    const result = await readNativeSaleListingHistory({ client, native: target.native, plan: sellerListingBinding(plan), packet, signal })
    return result.status === 'RELIST_CONFIRMED'
      ? { status: 'SUCCEEDED' as const, checkpoint: result.checkpoint, offerId: result.receipt.offerId, kind: 'LIST' as const, reviewChanged: result.receipt.reviewChanged }
      : { status: result.status }
  }
  const result = await readNativeSaleCancellationHistory({ client, native: target.native, custody: target.custody!,
    packet, intent: { ...intent, kioskId: plan.kioskId }, signal })
  if (result.status !== 'CANCELLATION_CONFIRMED') return { status: result.status }
  check(result.receipt.offerContext.configId === target.configId && result.receipt.offerContext.registryId === target.registryId, 'SELLER_CANCEL_RECEIPT_SCOPE')
  return { status: 'SUCCEEDED' as const, checkpoint: result.checkpoint, offerId: result.receipt.receipt.offer, kind: 'CANCEL' as const }
}

export async function discoverNativeSellerRecords(soulId: string) {
  check(commerceId(soulId), 'SELLER_SCOPE')
  const journal = browserNativeSellerJournal(true)
  const heads = await journal.heads(key => key.startsWith(NATIVE_SELLER_PREFIX + '35834a8a:' + soulId + ':'))
  const records = [...heads]
  for (const head of heads) {
    records.push(...await journal.history(nativeSellerKey(nativeSellerScope(head.plan))))
    check(records.length <= 256, 'SELLER_RECOVERY_BOUND')
  }
  return records
}
