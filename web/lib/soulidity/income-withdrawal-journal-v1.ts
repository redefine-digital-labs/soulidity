import { captureIncomeOriginalLedger } from './commerce/income-original-ledger'
import type { IncomeExecutionRegistryV1 } from './commerce/income-execution-source-v1'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { fromBase58, fromBase64, normalizeStructTag, toBase58, toBase64 } from '@mysten/sui/utils'
import { createAsyncPublicMutationStore, publicMutationCanonical, type AsyncPublicMutationStorage, type AsyncPublicMutationStore, type PublicMutationPacket } from '../sui/public-mutation-journal'
import { commerceCheck, commerceId } from './commerce/economics-read'
import { captureIncomeWithdrawalRetirementClient, validateIncomeWithdrawalRetirementEvidence,
  verifyIncomeWithdrawalRetirement, type IncomeWithdrawalRetirementEvidence } from './commerce/income-withdrawal-retirement'
import { importIncomeWithdrawalRecoveryRecord, queryIncomeWithdrawalRecoveryRecord } from './commerce/income-withdrawal-recovery-record'

export const INCOME_WITHDRAWAL_PREFIX_V1 = 'soulidity.income-withdrawal.v1:'
export const INCOME_WITHDRAWAL_CHANGED_V1 = 'soulidity:income-withdrawal-v1-changed'
export interface IncomeWithdrawalFundScope { chainIdentifier: string; configId: string; coinType: string }
export interface IncomeWithdrawalJournalPlanV1 extends IncomeWithdrawalFundScope { originalText: string }
export interface IncomeWithdrawalJournalRecordV1 { schema: 'soulidity.income-withdrawal-operation.v1'; plan: IncomeWithdrawalJournalPlanV1; packet: PublicMutationPacket; retirement?: IncomeWithdrawalRetirementEvidence }
export type IncomeWithdrawalJournalV1 = AsyncPublicMutationStore<IncomeWithdrawalJournalPlanV1, IncomeWithdrawalJournalRecordV1>
export type IncomeWithdrawalOriginalReaderV1 = Pick<IncomeWithdrawalJournalV1, 'read' | 'heads' | 'history'>
const phases = ['PREPARED', 'SIGNING', 'SIGNED', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'RETIRED']
const terminal = ['SUCCEEDED', 'FAILED', 'CANCELLED', 'RETIRED']
function exact(value: unknown, names: string[]) {
  commerceCheck(value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join() === names.slice().sort().join(), 'WITHDRAW_JOURNAL_FIELDS')
}
export function incomeWithdrawalFundScope(input: IncomeWithdrawalFundScope): IncomeWithdrawalFundScope {
  commerceCheck(/^[0-9a-f]{8}$/.test(input.chainIdentifier) && commerceId(input.configId)
    && typeof input.coinType === 'string' && input.coinType.length > 0 && input.coinType.length <= 2048, 'WITHDRAW_FUND_SCOPE')
  return { chainIdentifier: input.chainIdentifier, configId: input.configId, coinType: normalizeStructTag(input.coinType) }
}
/** One shared-funds head across actors/Admin/recipients/package upgrades. */
export function incomeWithdrawalFundKeyV1(input: IncomeWithdrawalFundScope) {
  const scope = incomeWithdrawalFundScope(input)
  return INCOME_WITHDRAWAL_PREFIX_V1 + [scope.chainIdentifier, scope.configId, encodeURIComponent(scope.coinType)].join(':')
}
export async function parseIncomeWithdrawalJournalRecordV1(input: unknown): Promise<IncomeWithdrawalJournalRecordV1> {
  const record = structuredClone(input) as IncomeWithdrawalJournalRecordV1
  exact(record, ['schema', 'plan', 'packet', ...(record?.retirement !== undefined ? ['retirement'] : [])]); commerceCheck(record.schema === 'soulidity.income-withdrawal-operation.v1', 'WITHDRAW_JOURNAL_SCHEMA')
  exact(record.plan, ['chainIdentifier', 'configId', 'coinType', 'originalText'])
  const scope = incomeWithdrawalFundScope(record.plan)
  commerceCheck(scope.coinType === record.plan.coinType && typeof record.plan.originalText === 'string', 'WITHDRAW_JOURNAL_SCOPE')
  exact(record.packet, ['bytes', 'digest', 'expirationEpoch', 'phase', 'signature'])
  const packet = record.packet
  commerceCheck(phases.includes(packet.phase) && (packet.signature === null || typeof packet.signature === 'string'
    && packet.signature.length > 0 && packet.signature.length <= 32768 && toBase64(fromBase64(packet.signature)) === packet.signature), 'WITHDRAW_JOURNAL_PHASE_SIGNATURE')
  commerceCheck(packet.phase !== 'SIGNED' || packet.signature !== null, 'WITHDRAW_JOURNAL_SIGNATURE_REQUIRED')
  commerceCheck(!['PREPARED', 'SIGNING', 'CANCELLED'].includes(packet.phase) || packet.signature === null, 'WITHDRAW_JOURNAL_UNEXPECTED_SIGNATURE')
  commerceCheck((packet.phase === 'RETIRED') === (record.retirement !== undefined), 'WITHDRAW_JOURNAL_RETIREMENT_SCOPE')
  if (record.retirement !== undefined) validateIncomeWithdrawalRetirementEvidence(record.retirement, packet.expirationEpoch)
  const original = importIncomeWithdrawalRecoveryRecord(record.plan.originalText)
  commerceCheck(original.packet.phase === 'PREPARED' && original.packet.signature === null, 'WITHDRAW_JOURNAL_ORIGINAL_NOT_PREPARED')
  commerceCheck(publicMutationCanonical(incomeWithdrawalFundScope(original.target)) === publicMutationCanonical(scope), 'WITHDRAW_JOURNAL_ORIGINAL_SCOPE')
  const identity = (value: PublicMutationPacket) => ({ bytes: value.bytes, digest: value.digest, expirationEpoch: value.expirationEpoch })
  commerceCheck(publicMutationCanonical(identity(original.packet)) === publicMutationCanonical(identity(packet)), 'WITHDRAW_JOURNAL_ORIGINAL_PACKET_CHANGED')
  return record
}
export async function incomeWithdrawalJournalRecordFromOriginalV1(originalText: string) {
  const original = importIncomeWithdrawalRecoveryRecord(originalText)
  return parseIncomeWithdrawalJournalRecordV1({ schema: 'soulidity.income-withdrawal-operation.v1',
    plan: { ...incomeWithdrawalFundScope(original.target), originalText }, packet: original.packet })
}
function createJournal(storage?: AsyncPublicMutationStorage, readOnly = false): IncomeWithdrawalJournalV1 {
  return createAsyncPublicMutationStore({ prefix: INCOME_WITHDRAWAL_PREFIX_V1, changedEvent: INCOME_WITHDRAWAL_CHANGED_V1,
    errorPrefix: 'INCOME_WITHDRAWAL_JOURNAL_V1', key: incomeWithdrawalFundKeyV1, parse: parseIncomeWithdrawalJournalRecordV1, storage, readOnly,
    classify: name => {
      const parts = name.slice(INCOME_WITHDRAWAL_PREFIX_V1.length).split(':')
      commerceCheck(parts.length === 3 || parts.length === 6 && parts[3] === 'history' && terminal.includes(parts[5]), 'WITHDRAW_JOURNAL_OPAQUE_HEAD_KEY')
      const coinType = decodeURIComponent(parts[2])
      commerceCheck(encodeURIComponent(coinType) === parts[2] && normalizeStructTag(coinType) === coinType, 'WITHDRAW_JOURNAL_KEY_COIN')
      const headKey = incomeWithdrawalFundKeyV1({ chainIdentifier: parts[0], configId: parts[1], coinType })
      if (parts.length === 6) { const bytes = fromBase58(parts[4]); commerceCheck(bytes.length === 32 && toBase58(bytes) === parts[4], 'WITHDRAW_JOURNAL_ARCHIVE_DIGEST') }
      return { headKey, archived: parts.length === 6 }
    } })
}
export function browserIncomeWithdrawalJournalV1(storage?: AsyncPublicMutationStorage) { return createJournal(storage) }
export function captureIncomeWithdrawalJournalV1(source: IncomeWithdrawalJournalV1): IncomeWithdrawalJournalV1 {
  const { exclusive, read, write, heads, history } = source
  return { exclusive: exclusive.bind(source), read: read.bind(source), write: write.bind(source), heads: heads.bind(source), history: history.bind(source) }
}
export function browserIncomeWithdrawalOriginalReaderV1(storage?: AsyncPublicMutationStorage): IncomeWithdrawalOriginalReaderV1 {
  const { read, heads, history } = createJournal(storage, true)
  return { read, heads, history }
}
/** Caller owns fund+head locks. Settle a readback even after a failed ACK; a
 * matching readback does not turn the failed write into permission to proceed.
 */
export async function persistIncomeWithdrawalHeadV1(journal: IncomeWithdrawalJournalV1, key: string,
  input: IncomeWithdrawalJournalRecordV1, onMatched?: () => void) {
  const saved = structuredClone(input), read = journal.read.bind(journal), write = journal.write.bind(journal)
  const record = await parseIncomeWithdrawalJournalRecordV1(saved)
  let writeError: unknown, failed = false
  try { await write(key, record) } catch (error) { failed = true; writeError = error }
  const after = await read(key)
  const matched = publicMutationCanonical(after) === publicMutationCanonical(record) && after?.plan.originalText === record.plan.originalText
  if (matched) onMatched?.()
  if (failed) throw writeError
  commerceCheck(matched, 'WITHDRAW_HOST_PERSISTENCE_FAILED')
  return after!
}
// Only a fresh verified observation may release this exact retired head.
const reverifiedRetirements = new WeakMap<object, string>()
export async function queryIncomeWithdrawalJournalOriginalV1(input: { record: IncomeWithdrawalJournalRecordV1; client: SuiGrpcClient; signal: AbortSignal; executionRegistry?: IncomeExecutionRegistryV1 }) {
  const executionRegistry = input.executionRegistry, saved = structuredClone(input.record)
  const client = saved.retirement !== undefined ? captureIncomeWithdrawalRetirementClient(input.client) : captureIncomeOriginalLedger(input.client)
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(saved.retirement === undefined ? 60000 : 90000)]), record = await parseIncomeWithdrawalJournalRecordV1(saved)
  signal.throwIfAborted()
  const query = () => queryIncomeWithdrawalRecoveryRecord({ text: record.plan.originalText, client, signal, executionRegistry })
  if (!record.retirement) return query()
  commerceCheck(executionRegistry, 'WITHDRAW_RETIREMENT_SOURCE_NOT_INSTALLED')
  const result = await verifyIncomeWithdrawalRetirement({ client, signal, executionRegistry, saved: record.retirement,
    original: importIncomeWithdrawalRecoveryRecord(record.plan.originalText), queryOriginal: query })
  reverifiedRetirements.set(result.observed, publicMutationCanonical(record))
  return result.observed
}
export function incomeWithdrawalHeadCanClearV1(record: IncomeWithdrawalJournalRecordV1, result: Awaited<ReturnType<typeof queryIncomeWithdrawalJournalOriginalV1>>) {
  if (record.packet.phase === 'RETIRED') {
    const verified = reverifiedRetirements.get(result)
    reverifiedRetirements.delete(result)
    return result.status === 'MISSING' && verified === publicMutationCanonical(record)
  }
  if (record.packet.phase === 'SUCCEEDED') commerceCheck(result.status === 'WITHDRAWAL_EVIDENCE_CONFIRMED', 'WITHDRAW_JOURNAL_TERMINAL_UNCONFIRMED')
  if (record.packet.phase === 'FAILED') commerceCheck(result.status === 'FAILED', 'WITHDRAW_JOURNAL_TERMINAL_UNCONFIRMED')
  return result.status === 'FAILED' || result.status === 'WITHDRAWAL_EVIDENCE_CONFIRMED'
    || record.packet.phase === 'CANCELLED' && record.packet.signature === null && result.status === 'MISSING'
}
