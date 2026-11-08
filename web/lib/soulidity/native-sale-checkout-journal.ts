import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { assertNativeSaleRetirementUnchanged, retiredNativeSaleResult, validateNativeSaleRetirement,
  verifyNativeSaleRetirement, type NativeSaleRetirement } from './commerce/native-sale-original-retirement'
import { fromBase58, fromBase64, toBase58, toBase64 } from '@mysten/sui/utils'
import { createAsyncPublicMutationStore, publicMutationCanonical as canonical, type PublicMutationPacket } from '../sui/public-mutation-journal'
import { commerceCheck as check, commerceId } from './commerce/economics-read'
import { parsePurchaseRecoveryOriginal, queryPurchaseRecoveryOriginal } from './commerce/purchase-recovery-original'
import type { SoulAccessAssetScope } from './soul-access-asset-lock'

export const NATIVE_SALE_CHECKOUT_PREFIX = 'soulidity.native-sale-checkout.v1:'
const terminal = ['SUCCEEDED', 'FAILED', 'CANCELLED', 'RETIRED']
export interface NativeSaleCheckoutRecord {
  schema: 'soulidity.native-sale-checkout.v1'
  plan: SoulAccessAssetScope & { originalText: string; reviewedQuoteIdentity: string }
  packet: PublicMutationPacket
  retirement?: NativeSaleRetirement
}

export function nativeSaleCheckoutKey(scope: SoulAccessAssetScope) {
  check(scope.chainIdentifier === '35834a8a' && commerceId(scope.soulId) && commerceId(scope.author), 'SALE_CHECKOUT_SCOPE')
  return NATIVE_SALE_CHECKOUT_PREFIX + [scope.chainIdentifier, scope.soulId, scope.author].join(':')
}

export async function parseNativeSaleCheckoutRecord(input: unknown) {
  const record = structuredClone(input) as NativeSaleCheckoutRecord
  function exact(value: object, keys: string) {
    check(value && Object.keys(value).sort().join(',') === keys, 'SALE_CHECKOUT_FIELDS')
  }
  exact(record, record?.packet?.phase === 'RETIRED' ? 'packet,plan,retirement,schema' : 'packet,plan,schema')
  exact(record.plan, 'author,chainIdentifier,originalText,reviewedQuoteIdentity,soulId')
  exact(record.packet, 'bytes,digest,expirationEpoch,phase,signature')
  nativeSaleCheckoutKey(record.plan)
  check(record.schema === 'soulidity.native-sale-checkout.v1' && typeof record.plan.reviewedQuoteIdentity === 'string'
    && record.plan.reviewedQuoteIdentity.length > 0 && record.plan.reviewedQuoteIdentity.length <= 8192, 'SALE_CHECKOUT_RECORD')
  const original = await parsePurchaseRecoveryOriginal(record.plan.originalText, record.plan.soulId)
  check(original.kind === 'native-sale-preparation.v1', 'SALE_CHECKOUT_ORIGINAL_FORMAT')
  const { plan, packet } = original.value
  const current = record.packet
  check(packet.phase === 'PREPARED' && packet.signature === null && plan.buyer === record.plan.author
    && current.bytes === packet.bytes && current.digest === packet.digest && current.expirationEpoch === packet.expirationEpoch,
  'SALE_CHECKOUT_ORIGINAL_SCOPE')
  check(['PREPARED', 'SIGNING', 'SIGNED', ...terminal].includes(current.phase)
    && (current.signature === null || typeof current.signature === 'string' && current.signature.length > 0
      && current.signature.length <= 32768 && toBase64(fromBase64(current.signature)) === current.signature)
    && (current.phase !== 'SIGNED' || current.signature !== null)
    && (!['PREPARED', 'SIGNING', 'CANCELLED'].includes(current.phase) || current.signature === null), 'SALE_CHECKOUT_PACKET_PHASE')
  validateNativeSaleRetirement(current, record.retirement)
  return record
}

export function browserNativeSaleCheckoutJournal(readOnly = false) {
  return createAsyncPublicMutationStore({ prefix: NATIVE_SALE_CHECKOUT_PREFIX, changedEvent: 'soulidity:native-sale-checkout-v1-changed',
    errorPrefix: 'NATIVE_SALE_CHECKOUT', key: nativeSaleCheckoutKey, parse: parseNativeSaleCheckoutRecord, readOnly,
    checkTransition: assertNativeSaleRetirementUnchanged,
    classify(name) {
      const parts = name.slice(NATIVE_SALE_CHECKOUT_PREFIX.length).split(':')
      const [chainIdentifier, soulId, author, archive, digest, phase] = parts
      check(parts.length === 3 || parts.length === 6 && archive === 'history' && digest && terminal.includes(phase), 'SALE_CHECKOUT_ARCHIVE_KEY')
      if (digest) {
        const bytes = fromBase58(digest)
        check(bytes.length === 32 && toBase58(bytes) === digest, 'SALE_CHECKOUT_ARCHIVE_DIGEST')
      }
      return { headKey: nativeSaleCheckoutKey({ chainIdentifier, soulId, author }), archived: archive === 'history' }
    },
  })
}

export async function queryNativeSaleCheckoutRecord(record: NativeSaleCheckoutRecord, client: SuiGrpcClient, signal: AbortSignal) {
  const saved = await parseNativeSaleCheckoutRecord(record)
  const queryOriginal = () => queryNativeSaleCheckoutHistory(saved, client, signal)
  if (!saved.retirement) return queryOriginal()
  await verifyNativeSaleRetirement({ client, signal, packet: saved.packet, author: saved.plan.author, saved: saved.retirement, queryOriginal })
  return retiredNativeSaleResult(saved.packet.digest)
}

async function queryNativeSaleCheckoutHistory(saved: NativeSaleCheckoutRecord, client: SuiGrpcClient, signal: AbortSignal) {
  const result = await queryPurchaseRecoveryOriginal({ text: saved.plan.originalText, soulId: saved.plan.soulId, client, signal,
    proveSaleSource: true, proveSaleCustody: true, proveSaleCleanup: true })
  check(result.kind === 'native-sale-preparation.v1', 'SALE_CHECKOUT_ORIGINAL_FORMAT')
  const history = result.history
  if (history.status !== 'SETTLEMENT_CONFIRMED') return { status: history.status }
  const { money, custody, cleanup, effectsReconciliation } = history.receipt
  check(custody?.transactionDigest === saved.packet.digest && custody.soulId === saved.plan.soulId && cleanup
    && money.sourceBinding?.soulBinding?.soulId === saved.plan.soulId && !money.requiresOriginalSourceBindingProof
    && effectsReconciliation.status === 'OBJECT_EFFECTS_ACCOUNTED', 'SALE_CHECKOUT_INCOMPLETE_SETTLEMENT')
  return { status: 'SUCCEEDED' as const, checkpoint: history.checkpoint, history }
}

export function nativeSaleCheckoutMatches(before: NativeSaleCheckoutRecord | null, selected: NativeSaleCheckoutRecord) {
  return canonical(before) === canonical(selected)
}

export async function discoverNativeSaleCheckoutRecords(soulId: string) {
  check(commerceId(soulId), 'SALE_CHECKOUT_SCOPE')
  const journal = browserNativeSaleCheckoutJournal(true)
  const heads = await journal.heads(key => key.startsWith(NATIVE_SALE_CHECKOUT_PREFIX + '35834a8a:' + soulId + ':'))
  const result = [...heads]
  for (const head of heads) {
    result.push(...await journal.history(nativeSaleCheckoutKey(head.plan)))
    check(result.length <= 256, 'SALE_CHECKOUT_RECOVERY_BOUND')
  }
  return result
}
