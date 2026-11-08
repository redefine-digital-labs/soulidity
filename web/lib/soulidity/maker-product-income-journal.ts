import { captureIncomeOriginalLedger } from './commerce/income-original-ledger'
import { captureMakerProductIncomeClient } from './commerce/maker-product-income-client'
import { verifyMakerProductRetirement, validateMakerProductRetirementEvidence, type MakerProductRetirementEvidence } from './commerce/maker-product-income-retirement'
import type { IncomeExecutionRegistryV1 } from './commerce/income-execution-source-v1'
import { fromBase58, fromBase64, normalizeStructTag, normalizeSuiAddress, toBase58, toBase64 } from '@mysten/sui/utils'
import { createAsyncPublicMutationStore, publicMutationCanonical, type AsyncPublicMutationStorage, type AsyncPublicMutationStore, type PublicMutationPacket } from '../sui/public-mutation-journal'
import { commerceCheck, commerceId } from './commerce/economics-read'
import { importMakerProductIncomeRecoveryRecord, queryMakerProductIncomeRecoveryRecord } from './commerce/maker-product-income-recovery-record'
import type { SuiGrpcClient } from '@mysten/sui/grpc'

/** Exact Root maker-product-income-root-contract-v1 local adapter. The public
 * factory is the sole backend and sole lock implementation. Fund and head are
 * this same Product key for every writer, continuation and future signer.
 */
export const MAKER_PRODUCT_INCOME_PREFIX = 'soulidity.maker-product-income.v1:'
export const MAKER_PRODUCT_INCOME_CHANGED = 'soulidity:maker-product-income-v1-changed'
export interface MakerProductIncomeScope { chainIdentifier: string; productId: string; coinType: string }
export interface MakerProductIncomePlan extends MakerProductIncomeScope { originalText: string }
export interface MakerProductIncomeOperation { schema: 'soulidity.maker-product-income-operation.v1'; plan: MakerProductIncomePlan; packet: PublicMutationPacket; retirement?: MakerProductRetirementEvidence }
export type MakerProductIncomeJournal = AsyncPublicMutationStore<MakerProductIncomePlan, MakerProductIncomeOperation>
export type MakerProductIncomeOriginalReader = Pick<MakerProductIncomeJournal, 'read' | 'heads' | 'history'>
export function makerProductIncomeScope(input: MakerProductIncomeScope): MakerProductIncomeScope {
  commerceCheck(input && /^[0-9a-f]{8}$/.test(input.chainIdentifier) && typeof input.productId === 'string' && /^(?:0x)?[0-9a-fA-F]{1,64}$/.test(input.productId)
    && typeof input.coinType === 'string' && input.coinType.length > 0 && input.coinType.length <= 2048, 'MAKER_INCOME_FUND_SCOPE')
  const productId = normalizeSuiAddress(input.productId)
  commerceCheck(commerceId(productId), 'MAKER_INCOME_FUND_PRODUCT')
  return { chainIdentifier: input.chainIdentifier, productId, coinType: normalizeStructTag(input.coinType) }
}
export function makerProductIncomeFundKey(input: MakerProductIncomeScope) {
  const scope = makerProductIncomeScope(input)
  return MAKER_PRODUCT_INCOME_PREFIX + [scope.chainIdentifier, scope.productId, encodeURIComponent(scope.coinType)].join(':')
}
function exact(input: unknown, keys: string[]) { commerceCheck(input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).sort().join() === keys.slice().sort().join(), 'MAKER_INCOME_OPERATION_FIELDS') }
export async function parseMakerProductIncomeOperation(input: unknown): Promise<MakerProductIncomeOperation> {
  const row = structuredClone(input) as MakerProductIncomeOperation
  exact(row, ['schema', 'plan', 'packet', ...(row?.retirement !== undefined ? ['retirement'] : [])]); commerceCheck(row.schema === 'soulidity.maker-product-income-operation.v1', 'MAKER_INCOME_OPERATION_SCHEMA')
  exact(row.plan, ['chainIdentifier', 'productId', 'coinType', 'originalText'])
  const scope = makerProductIncomeScope(row.plan)
  commerceCheck(row.plan.productId === scope.productId && row.plan.coinType === scope.coinType && typeof row.plan.originalText === 'string', 'MAKER_INCOME_OPERATION_SCOPE')
  exact(row.packet, ['bytes', 'digest', 'expirationEpoch', 'phase', 'signature'])
  const packet = row.packet
  commerceCheck(['PREPARED', 'SIGNING', 'SIGNED', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'RETIRED'].includes(packet.phase)
    && (packet.signature === null || typeof packet.signature === 'string' && packet.signature.length > 0 && packet.signature.length <= 32768 && toBase64(fromBase64(packet.signature)) === packet.signature), 'MAKER_INCOME_OPERATION_PACKET')
  commerceCheck(packet.phase !== 'SIGNED' || packet.signature !== null, 'MAKER_INCOME_OPERATION_SIGNATURE_REQUIRED')
  commerceCheck(!['PREPARED', 'SIGNING', 'CANCELLED'].includes(packet.phase) || packet.signature === null, 'MAKER_INCOME_OPERATION_UNEXPECTED_SIGNATURE')
  commerceCheck((packet.phase === 'RETIRED') === (row.retirement !== undefined), 'MAKER_INCOME_OPERATION_RETIREMENT_SCOPE')
  if (row.retirement !== undefined) validateMakerProductRetirementEvidence(row.retirement, packet.expirationEpoch)
  const original = importMakerProductIncomeRecoveryRecord(row.plan.originalText)
  commerceCheck(original.packet.phase === 'PREPARED' && original.packet.signature === null && publicMutationCanonical(makerProductIncomeScope(original.target)) === publicMutationCanonical(scope), 'MAKER_INCOME_OPERATION_ORIGINAL_SCOPE')
  const identity = (value: PublicMutationPacket) => ({ bytes: value.bytes, digest: value.digest, expirationEpoch: value.expirationEpoch })
  commerceCheck(publicMutationCanonical(identity(original.packet)) === publicMutationCanonical(identity(packet)), 'MAKER_INCOME_OPERATION_ORIGINAL_PACKET')
  return row
}
export async function makerProductIncomeOperationFromOriginal(originalText: string) {
  const original = importMakerProductIncomeRecoveryRecord(originalText)
  return parseMakerProductIncomeOperation({ schema: 'soulidity.maker-product-income-operation.v1', plan: { ...makerProductIncomeScope(original.target), originalText }, packet: original.packet })
}
function capturedStorage(source: AsyncPublicMutationStorage): AsyncPublicMutationStorage {
  const { key, getItem, setItem } = source
  let owner: object | null = source, length: PropertyDescriptor | undefined
  while (owner && !length) { length = Object.getOwnPropertyDescriptor(owner, 'length'); owner = Object.getPrototypeOf(owner) }
  commerceCheck(length?.get && typeof key === 'function' && typeof getItem === 'function' && typeof setItem === 'function', 'MAKER_INCOME_STORAGE_OPERATIONS')
  const getLength = length.get.bind(source)
  return { get length() { return getLength() }, key: key.bind(source), getItem: getItem.bind(source), setItem: setItem.bind(source) }
}
function createJournal(storage?: AsyncPublicMutationStorage, readOnly = false): MakerProductIncomeJournal {
  const source = storage ?? window.localStorage
  return createAsyncPublicMutationStore({ prefix: MAKER_PRODUCT_INCOME_PREFIX, changedEvent: MAKER_PRODUCT_INCOME_CHANGED, errorPrefix: 'MAKER_PRODUCT_INCOME',
    key: makerProductIncomeFundKey, parse: parseMakerProductIncomeOperation, storage: capturedStorage(source), readOnly,
    classify: name => {
      const parts = name.slice(MAKER_PRODUCT_INCOME_PREFIX.length).split(':')
      commerceCheck(parts.length === 3 || parts.length === 6 && parts[3] === 'history' && ['SUCCEEDED', 'FAILED', 'CANCELLED', 'RETIRED'].includes(parts[5]), 'MAKER_INCOME_OPAQUE_HEAD_KEY')
      const coinType = decodeURIComponent(parts[2]), scope = makerProductIncomeScope({ chainIdentifier: parts[0], productId: parts[1], coinType })
      commerceCheck(parts[1] === scope.productId && parts[2] === encodeURIComponent(scope.coinType), 'MAKER_INCOME_KEY_CANONICAL')
      if (parts.length === 6) { const digest = fromBase58(parts[4]); commerceCheck(digest.length === 32 && toBase58(digest) === parts[4], 'MAKER_INCOME_ARCHIVE_DIGEST') }
      return { headKey: makerProductIncomeFundKey(scope), archived: parts.length === 6 }
    } })
}
export function browserMakerProductIncomeJournal(storage?: AsyncPublicMutationStorage) { return createJournal(storage) }
export function browserMakerProductIncomeOriginalReader(storage?: AsyncPublicMutationStorage): MakerProductIncomeOriginalReader {
  const { read, heads, history } = createJournal(storage, true); return { read, heads, history }
}
export function captureMakerProductIncomeJournal(source: MakerProductIncomeJournal): MakerProductIncomeJournal {
  const { exclusive, read, write, heads, history } = source
  return { exclusive: exclusive.bind(source), read: read.bind(source), write: write.bind(source), heads: heads.bind(source), history: history.bind(source) }
}
/** Caller holds the Root factory exclusion. Even failed ACK/abort awaits an
 * already initiated readback; a matching value does not erase the failed ACK.
 */
export async function persistMakerProductIncomeHead(journal: MakerProductIncomeJournal, key: string, input: MakerProductIncomeOperation, onMatched?: () => void) {
  const read = journal.read.bind(journal), write = journal.write.bind(journal), saved = structuredClone(input)
  const record = await parseMakerProductIncomeOperation(saved)
  let error: unknown, failed = false
  try { await write(key, record) } catch (cause) { failed = true; error = cause }
  const after = await read(key), matched = publicMutationCanonical(after) === publicMutationCanonical(record) && after?.plan.originalText === record.plan.originalText
  if (matched) onMatched?.()
  if (failed) throw error
  commerceCheck(matched, 'MAKER_INCOME_PERSISTENCE_FAILED'); return after!
}
// This capability binds clearing a retired head to the freshly verified read,
// not a caller-provided or previously cached MISSING result.
const reverifiedRetirements = new WeakMap<object, string>()
export async function queryMakerProductIncomeOriginal(input: { record: MakerProductIncomeOperation; client: SuiGrpcClient; signal: AbortSignal; executionRegistry?: IncomeExecutionRegistryV1 }) {
  const executionRegistry = input.executionRegistry
  const saved = structuredClone(input.record)
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(90000)])
  const client = saved.retirement !== undefined ? captureMakerProductIncomeClient(input.client) : captureIncomeOriginalLedger(input.client)
  const record = await parseMakerProductIncomeOperation(saved)
  const query = () => queryMakerProductIncomeRecoveryRecord({ text: record.plan.originalText, client, signal, executionRegistry })
  if (!record.retirement) return query()
  commerceCheck(executionRegistry, 'MAKER_INCOME_RETIREMENT_SOURCE_NOT_INSTALLED')
  const result = await verifyMakerProductRetirement({ client, signal, executionRegistry, saved: record.retirement,
    original: importMakerProductIncomeRecoveryRecord(record.plan.originalText), queryOriginal: query })
  reverifiedRetirements.set(result.observed, publicMutationCanonical(record))
  return result.observed
}
export function makerProductIncomeHeadCanClear(record: MakerProductIncomeOperation, result: Awaited<ReturnType<typeof queryMakerProductIncomeOriginal>>) {
  if (record.packet.phase === 'RETIRED') {
    const verified = reverifiedRetirements.get(result)
    reverifiedRetirements.delete(result)
    return verified === publicMutationCanonical(record)
  }
  if (record.packet.phase === 'SUCCEEDED') commerceCheck(result.status === 'WITHDRAWAL_EVIDENCE_CONFIRMED', 'MAKER_INCOME_TERMINAL_UNCONFIRMED')
  if (record.packet.phase === 'FAILED') commerceCheck(result.status === 'FAILED', 'MAKER_INCOME_TERMINAL_UNCONFIRMED')
  return result.status === 'FAILED' || result.status === 'WITHDRAWAL_EVIDENCE_CONFIRMED' || record.packet.phase === 'CANCELLED' && record.packet.signature === null && result.status === 'MISSING'
}
