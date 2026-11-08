import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { MAINNET_GENESIS_DIGEST } from '../animacraft/mainnet-chain'
import { captureSameSoulMutationClient } from './same-soul-mutation-client'
import { sameSoulMutationScope } from './same-soul-mutation-coordination'
import type { SoulAccessAssetScope } from './soul-access-asset-lock'
import { parseEquipmentManagementRecord, equipmentManagementKey } from './management/equipment-record'
import { parseFormsManagementRecord, formsManagementKey } from './management/application-forms-record'
import { queryEquipmentOriginalResultV154 } from './management/equipment-original-result-v154'
import { queryFormsOriginalOperation } from './management/application-forms-recovery'
import { parseSoulAccessRecord, createSoulAccessAdapter } from './soul-access-operation'
import { soulAccessKey } from './soul-access-plan'
import { parseNativePublicReadPaidRecordV2, nativePublicReadPaidKeyV2, nativePublicReadPaidSettlementMatchesV2, nativePublicReadPaidHeadCanClearV2, queryNativePublicReadPaidHeadV2, type NativePublicReadPaidRecordV2 } from './native-public-read-paid-journal-v2'
import { NATIVE_SALE_CHECKOUT_PREFIX, nativeSaleCheckoutKey, parseNativeSaleCheckoutRecord, queryNativeSaleCheckoutRecord } from './native-sale-checkout-journal'
import { NATIVE_SELLER_PREFIX, nativeSellerKey, nativeSellerScope, parseNativeSellerRecord, queryNativeSellerOriginal } from './native-sale-seller-journal'
import { validateMarketListOperationRecord, marketListOperationKey } from '../animacraft/market-list-operation'
import { validateMarketBuyOperationRecord, marketBuyOperationKey } from '../animacraft/market-buy-operation'
import { validateMarketCancelOperationRecord, marketCancelOperationKey } from '../animacraft/market-cancel-operation'
import { validateMarketBatchListOperationRecord, marketBatchListOperationKey, marketBatchReservedAssets } from '../animacraft/market-batch-list-operation'
import { queryMarketListOperationEvidence } from '../animacraft/market-list-operation-adapter'
import { queryMarketBuyOperationEvidence } from '../animacraft/market-buy-operation-adapter'
import { queryMarketCancelOperationEvidence } from '../animacraft/market-cancel-operation-adapter'
import { queryMarketBatchListOperationEvidence } from '../animacraft/market-batch-list-operation-adapter'

export type SameSoulHeadDomain = 'EQUIPMENT' | 'FORMS' | 'LEGACY_ACCESS' | 'NATIVE_PAID' | 'NATIVE_SALE_CHECKOUT' | 'NATIVE_SELLER' | 'SALE_LIST' | 'SALE_BUY' | 'SALE_CANCEL' | 'SALE_BATCH'
export interface SameSoulMutationHead {
  key: string; text: string; domain: SameSoulHeadDomain; value: unknown
  phase: string; signature: string | null; digest: string
}
export interface SameSoulHeadObservation { status: string; completeBusinessOutputVerified?: boolean; sourceQualification?: string; settledPaymentDigest?: string }
export interface SameSoulMutationHeadPort {
  storage: Pick<Storage, 'length' | 'key' | 'getItem'>
  verifyNetwork?(signal: AbortSignal): Promise<void>
  /** Explicit caller trust boundary. First-party factory never accepts a UI-installed query. */
  query(head: SameSoulMutationHead, signal: AbortSignal): Promise<SameSoulHeadObservation>
}
export class SameSoulRecoveryRequired extends Error {
  constructor(readonly key: string, readonly originalText: string | null, readonly reason: string, options?: ErrorOptions) {
    super(`SAME_SOUL_RECOVERY_REQUIRED:${reason}:${key}`, options); this.name = 'SameSoulRecoveryRequired'
  }
}
const equal = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b)
const MAX_KEYS = 8192, MAX_HEADS = 64, MAX_TEXT = 4 * 1024 * 1024
type Shape = { domain: SameSoulHeadDomain | 'UNSUPPORTED'; archived: boolean }
function shape(key: string, scopes: readonly SoulAccessAssetScope[]): Shape | null {
  const p = key.split(':'), matching = (chain: string, soul: string, actor: string) => scopes.some(s => chain === s.chainIdentifier && soul === s.soulId && actor === s.author)
  if (['soulidity.equipment-account-mutation.v1', 'soulidity.forms-account-mutation.v1'].includes(p[0]) && matching(p[1], p[3], p[4]))
    return { domain: p.length === 5 || p.length === 8 && p[5] === 'history' ? p[0].includes('.equipment-') ? 'EQUIPMENT' : 'FORMS' : 'UNSUPPORTED', archived: p.length === 8 && p[5] === 'history' }
  if (p[0] === 'soulidity.soul-access' && matching(p[1], p[6], p[7]))
    return { domain: p.length === 8 || p.length === 11 && p[8] === 'history' ? 'LEGACY_ACCESS' : 'UNSUPPORTED', archived: p.length === 11 && p[8] === 'history' }
  if (p[0] === 'soulidity.native-public-read-paid.v2' && matching(p[1], p[2], p[3]))
    return { domain: p.length === 4 || p.length === 7 && p[4] === 'history' ? 'NATIVE_PAID' : 'UNSUPPORTED', archived: p.length === 7 && p[4] === 'history' }
  if (p[0] === NATIVE_SALE_CHECKOUT_PREFIX.slice(0, -1) && matching(p[1], p[2], p[3]))
    return { domain: p.length === 4 || p.length === 7 && p[4] === 'history' ? 'NATIVE_SALE_CHECKOUT' : 'UNSUPPORTED', archived: p.length === 7 && p[4] === 'history' }
  if (p[0].startsWith('soulidity.native-sale-checkout.') && matching(p[1], p[2], p[3])) return { domain: 'UNSUPPORTED', archived: false }
  if (p[0] === NATIVE_SELLER_PREFIX.slice(0, -1) && matching(p[1], p[2], p[3]))
    return { domain: p.length === 4 || p.length === 7 && p[4] === 'history' ? 'NATIVE_SELLER' : 'UNSUPPORTED', archived: p.length === 7 && p[4] === 'history' }
  if (p[0].startsWith('soulidity.native-sale-seller.') && matching(p[1], p[2], p[3])) return { domain: 'UNSUPPORTED', archived: false }
  const sale = new Map<string, SameSoulHeadDomain>([['soulidity.market-list-operation', 'SALE_LIST'], ['soulidity.market-buy-operation', 'SALE_BUY'], ['soulidity.market-cancel-operation', 'SALE_CANCEL']])
  if (sale.has(p[0]) && p[1] === 'mainnet' && scopes.some(s => s.soulId === p[2] && s.author === p[3]))
    return { domain: p.length === 4 || p.length === 6 && p[4] === 'retired' ? sale.get(p[0])! : 'UNSUPPORTED', archived: p.length === 6 && p[4] === 'retired' }
  if (p[0] === 'soulidity.market-batch-list-operation' && p[1] === 'mainnet' && scopes.some(s => s.author === p[2]))
    return { domain: p.length === 3 || p.length === 5 && p[3] === 'retired' ? 'SALE_BATCH' : 'UNSUPPORTED', archived: p.length === 5 && p[3] === 'retired' }
  // Unknown versions in an established key family retain their exact scope positions.
  if ((p[0].startsWith('soulidity.equipment-account-mutation.') || p[0].startsWith('soulidity.forms-account-mutation.')) && matching(p[1], p[3], p[4])) return { domain: 'UNSUPPORTED', archived: false }
  if (p[0].startsWith('soulidity.soul-access.') && matching(p[1], p[6], p[7])) return { domain: 'UNSUPPORTED', archived: false }
  if (p[0].startsWith('soulidity.native-public-read-paid.') && matching(p[1], p[2], p[3])) return { domain: 'UNSUPPORTED', archived: false }
  if (p[0].startsWith('soulidity.original-soul-enhancement.') && matching(p[1], p[2], p[3]))
    return { domain: 'UNSUPPORTED', archived: false }
  return null
}
async function parse(key: string, text: string, domain: SameSoulHeadDomain, scopes: readonly SoulAccessAssetScope[]): Promise<SameSoulMutationHead | null> {
  const input = JSON.parse(text)
  let value: any, expected: string
  if (domain === 'EQUIPMENT') { value = parseEquipmentManagementRecord(input); expected = equipmentManagementKey(value.plan) }
  else if (domain === 'FORMS') { value = parseFormsManagementRecord(input); expected = formsManagementKey(value.plan) }
  else if (domain === 'LEGACY_ACCESS') { value = parseSoulAccessRecord(input); expected = soulAccessKey(value.plan) }
  else if (domain === 'NATIVE_PAID') { value = await parseNativePublicReadPaidRecordV2(input); expected = nativePublicReadPaidKeyV2(value.plan) }
  else if (domain === 'NATIVE_SALE_CHECKOUT') { value = await parseNativeSaleCheckoutRecord(input); expected = nativeSaleCheckoutKey(value.plan) }
  else if (domain === 'NATIVE_SELLER') { value = await parseNativeSellerRecord(input); expected = nativeSellerKey(nativeSellerScope(value.plan)) }
  else if (domain === 'SALE_LIST') { value = validateMarketListOperationRecord(input); expected = marketListOperationKey(value.snapshot.soulId, value.snapshot.owner) }
  else if (domain === 'SALE_BUY') { value = validateMarketBuyOperationRecord(input); expected = marketBuyOperationKey(value.snapshot.soulId, value.snapshot.buyer) }
  else if (domain === 'SALE_CANCEL') { value = validateMarketCancelOperationRecord(input); expected = marketCancelOperationKey(value.snapshot.soulId, value.snapshot.owner) }
  else {
    value = validateMarketBatchListOperationRecord(input); expected = marketBatchListOperationKey(value.owner)
    if (!scopes.some(s => s.author === value.owner && marketBatchReservedAssets(value).includes(s.soulId))) return null
  }
  if (expected !== key) throw Error('HEAD_KEY_SCOPE')
  const packet = value.packet ?? value
  return { key, text, domain, value, phase: packet.phase, signature: packet.signature, digest: packet.digest }
}

/** Bounded active heads only, preserving every byte and original schema.
 * Histories are not new pointers; their archive-before-head rules remain with
 * each original domain. A malformed relevant active value is never skipped.
 */
export async function assertSameSoulForeignHeads(input: {
  scopes: readonly SoulAccessAssetScope[]; ownKeys: readonly string[]; signal: AbortSignal; port: SameSoulMutationHeadPort
}) {
  const scopes = input.scopes.map(sameSoulMutationScope), own = new Set(input.ownKeys), signal = input.signal
  const storage = input.port.storage, keyAt = storage.key.bind(storage), get = storage.getItem.bind(storage), query = input.port.query.bind(input.port), verifyNetwork = input.port.verifyNetwork?.bind(input.port)
  const keys = () => {
    const length = storage.length
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_KEYS) throw new SameSoulRecoveryRequired('', null, 'STORAGE_KEY_BOUND')
    const result = Array.from({ length }, (_, i) => keyAt(i))
    if (storage.length !== length || result.some(k => typeof k !== 'string') || new Set(result).size !== length) throw new SameSoulRecoveryRequired('', null, 'STORAGE_CHANGED')
    return (result as string[]).sort()
  }
  signal.throwIfAborted()
  const related = () => keys().flatMap(key => { const kind = shape(key, scopes); return !own.has(key) && kind && !kind.archived ? [{ key, kind }] : [] })
  const selected = related(), before = selected.map(row => row.key)
  if (selected.length > MAX_HEADS) throw new SameSoulRecoveryRequired('', null, 'HEAD_COUNT_BOUND')
  const originals = new Map<string, string>(), heads: SameSoulMutationHead[] = []; let bytes = 0
  if (verifyNetwork) { await verifyNetwork(signal); signal.throwIfAborted() }
  for (const { key, kind } of selected) {
    signal.throwIfAborted()
    const text = get(key)
    if (typeof text !== 'string') throw new SameSoulRecoveryRequired(key, null, 'HEAD_DISAPPEARED')
    originals.set(key, text); bytes += new TextEncoder().encode(text).length
    if (!text.length || text.length > 750000 || bytes > MAX_TEXT) throw new SameSoulRecoveryRequired(key, text, 'HEAD_SIZE_BOUND')
    if (kind.domain === 'UNSUPPORTED') throw new SameSoulRecoveryRequired(key, text, 'UNSUPPORTED_SCHEMA')
    try { const head = await parse(key, text, kind.domain, scopes); if (head) heads.push(head) }
    catch { signal.throwIfAborted(); throw new SameSoulRecoveryRequired(key, text, 'CORRUPT_OR_UNSUPPORTED_ORIGINAL') }
  }
  const unchanged = () => {
    signal.throwIfAborted()
    if (!equal(before, related().map(row => row.key)) || [...originals].some(([key, value]) => get(key) !== value)) throw new SameSoulRecoveryRequired('', null, 'ORIGINAL_SET_CHANGED')
  }
  unchanged()
  for (const head of heads) {
    let result: SameSoulHeadObservation
    try { result = await query(head, signal) } catch (cause) {
      signal.throwIfAborted()
      throw new SameSoulRecoveryRequired(head.key, head.text, 'ORIGINAL_QUERY_UNAVAILABLE', { cause })
    }
    unchanged()
    const settledPayment = head.domain === 'NATIVE_PAID' && result.status === 'SUBSCRIPTION_RECORDED'
      && result.settledPaymentDigest === head.digest
    if (['SUCCEEDED', 'FAILED'].includes(head.phase) && result.status !== head.phase
      && !(head.phase === 'SUCCEEDED' && settledPayment)) throw new SameSoulRecoveryRequired(head.key, head.text, 'TERMINAL_RESULT_UNCONFIRMED')
    const retiredPayment = head.domain === 'NATIVE_PAID' && head.phase === 'RETIRED'
    const settledNativeSale = (head.domain === 'NATIVE_SALE_CHECKOUT' || head.domain === 'NATIVE_SELLER') && result.status === 'SUCCEEDED'
      && result.settledPaymentDigest === head.digest
    const clear = retiredPayment ? nativePublicReadPaidHeadCanClearV2(head.value as NativePublicReadPaidRecordV2, result)
      : settledPayment || settledNativeSale || result.status === 'FAILED' || head.phase === 'CANCELLED' && head.signature === null && result.status === 'MISSING'
      || result.status === 'SUCCEEDED' && result.completeBusinessOutputVerified === true && result.sourceQualification === 'COMPILED_ROOT_MATCHED'
    if (!clear) throw new SameSoulRecoveryRequired(head.key, head.text, 'ORIGINAL_RECOVERY_REQUIRED')
  }
  unchanged()
}

/** First-party actual original verifiers only. No caller boolean, file or URL
 * installs a source profile; unsupported successes remain recovery obligations.
 */
export function createBrowserSameSoulHeadPort(source: SuiGrpcClient, storage: SameSoulMutationHeadPort['storage'] = window.localStorage, signal?: AbortSignal): SameSoulMutationHeadPort {
  const client = captureSameSoulMutationClient(source, signal)
  const unavailable = async (): Promise<never> => { throw Error('SAME_SOUL_READONLY_SIGNING_UNAVAILABLE') }
  const legacy = createSoulAccessAdapter({ client, getAddress: () => null, sign: unavailable })
  return Object.freeze({ storage, async verifyNetwork(signal: AbortSignal) {
    signal.throwIfAborted()
    const chain = await client.core.getChainIdentifier()
    signal.throwIfAborted()
    if (chain.chainIdentifier !== MAINNET_GENESIS_DIGEST) throw Error('SAME_SOUL_FULL_GENESIS_REQUIRED')
  }, async query(head: SameSoulMutationHead, signal: AbortSignal): Promise<SameSoulHeadObservation> {
    const v: any = head.value
    if (head.domain === 'EQUIPMENT') {
      const result = await queryEquipmentOriginalResultV154({ client, text: head.text, soulId: v.plan.soulId, chainIdentifier: v.plan.target.chainIdentifier, signal })
      return result.execution.status === 'FINALIZED_EXECUTION'
        ? { status: result.completeBusinessOutputVerified ? 'SUCCEEDED' : 'FINALIZED_EXECUTION', completeBusinessOutputVerified: result.completeBusinessOutputVerified, sourceQualification: result.sourceQualification }
        : { status: result.execution.status }
    }
    if (head.domain === 'FORMS') return { status: (await queryFormsOriginalOperation({ client, text: head.text, soulId: v.plan.soulId, chainIdentifier: v.plan.target.chainIdentifier, signal })).execution.status }
    if (head.domain === 'LEGACY_ACCESS') return legacy.query(v)
    if (head.domain === 'NATIVE_PAID') {
      const result = await queryNativePublicReadPaidHeadV2(v, client, signal)
      if (v.packet.phase === 'RETIRED') return result
      return nativePublicReadPaidSettlementMatchesV2(v, result)
        ? { status: result.status, settledPaymentDigest: v.packet.digest }
        : { status: result.status }
    }
    if (head.domain === 'NATIVE_SALE_CHECKOUT') {
      const result = await queryNativeSaleCheckoutRecord(v, client, signal)
      return result.status === 'SUCCEEDED'
        ? { status: result.status, settledPaymentDigest: v.packet.digest }
        : { status: result.status }
    }
    if (head.domain === 'NATIVE_SELLER') {
      const result = await queryNativeSellerOriginal(v, client, signal)
      return result.status === 'SUCCEEDED' ? { status: result.status, settledPaymentDigest: v.packet.digest } : { status: result.status }
    }
    if (head.domain === 'SALE_LIST') return queryMarketListOperationEvidence(v, client)
    if (head.domain === 'SALE_BUY') return queryMarketBuyOperationEvidence(v, client)
    if (head.domain === 'SALE_CANCEL') return queryMarketCancelOperationEvidence(v, client)
    return queryMarketBatchListOperationEvidence(v, client)
  } })
}

/** Capture the explicit original reader/Storage receivers before an outer lock await. */
export function captureSameSoulHeadPort(port: SameSoulMutationHeadPort): SameSoulMutationHeadPort {
  const storage = port.storage, key = storage.key.bind(storage), getItem = storage.getItem.bind(storage), query = port.query.bind(port), verifyNetwork = port.verifyNetwork?.bind(port)
  return Object.freeze({ storage: Object.freeze({ get length() { return storage.length }, key, getItem }), query, verifyNetwork })
}
