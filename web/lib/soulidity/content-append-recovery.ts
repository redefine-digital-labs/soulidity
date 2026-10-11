import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { parseWalrusSingleRecord, readWalrusSingleRecord, walrusSingleKey, type WalrusSingleRecord } from '../upload/walrus-single-operation'
import { assertContentAppendWalrusRecord, contentAppendWalrusIntent } from './content-append-operation'
import { exportContentAppendPreparation, importContentAppendPreparation } from './content-append-store'
import { verifyContentAppendPreparation, type ContentAppendPreparation } from './content-append-preparation'
import { contentAppendPreparationFingerprint } from './content-append-preparation'
import { parseContentAppendIntent } from './content-append-operation'
import { contentAppendStorageRootHash, verifyContentAppendRebaseHistory, verifyContentAppendRebaseLink, type ContentAppendRebaseLink } from './content-append-rebase-evidence'
import { browserContentAppendRebaseStore } from './content-append-rebase-store'

export interface ContentAppendRecoveryBundle {
  record: ContentAppendPreparation
  payment: WalrusSingleRecord | null
  history: ContentAppendRebaseLink[]
  pending: ContentAppendRebaseLink | null
  additionalPayments: WalrusSingleRecord[]
}
const MAX_ADDITIONAL_PAYMENTS = 128
function check(value: unknown, code: string): asserts value { if (!value) throw new Error(`CONTENT_APPEND_RECOVERY_${code}`) }
function knownPreparations(bundle: Omit<ContentAppendRecoveryBundle, 'additionalPayments'>) {
  const records = new Map<string, ContentAppendPreparation>()
  for (const record of [bundle.record, ...[...bundle.history, ...(bundle.pending ? [bundle.pending] : [])]
    .flatMap(link => [link.previous, link.next]).map(record => ({ ...record, ciphertext: bundle.record.ciphertext }))]) {
    const key = walrusSingleKey(contentAppendWalrusIntent(record)), prior = records.get(key)
    check(!prior || contentAppendPreparationFingerprint(prior) === contentAppendPreparationFingerprint(record), 'PREPARATION_KEY_CONFLICT')
    records.set(key, record)
  }
  return records
}
function recordedPayments(bundle: Omit<ContentAppendRecoveryBundle, 'additionalPayments'>) {
  return [...(bundle.payment ? [bundle.payment] : []), ...[...bundle.history, ...(bundle.pending ? [bundle.pending] : [])]
    .flatMap(link => [link.previousPayment, link.nextPayment])]
}
function encode(bundle: ContentAppendRecoveryBundle) {
  return JSON.stringify({ schema: 'soulidity.content-append-recovery.v2',
    preparation: JSON.parse(exportContentAppendPreparation(bundle.record)), payment: bundle.payment,
    history: bundle.history, pending: bundle.pending, additionalPayments: bundle.additionalPayments })
}
export async function verifyContentAppendRecoveryBundle(input: ContentAppendRecoveryBundle, client: SuiGrpcClient): Promise<ContentAppendRecoveryBundle> {
  const value = structuredClone(input)
  if (!value || Object.keys(value).length !== 5 || !['record', 'payment', 'history', 'pending', 'additionalPayments'].every(k => Object.hasOwn(value, k)))
    throw new Error('CONTENT_APPEND_RECOVERY_BUNDLE_SCHEMA_INVALID')
  check(Array.isArray(value.additionalPayments) && value.additionalPayments.length <= MAX_ADDITIONAL_PAYMENTS, 'ADDITIONAL_PAYMENTS_LIMIT')
  const record = await verifyContentAppendPreparation(value.record, client)
  const payment = value.payment === null ? null : assertContentAppendWalrusRecord(record, value.payment)
  const history = await verifyContentAppendRebaseHistory(record, value.history, client)
  const pending = value.pending === null ? null : (await verifyContentAppendRebaseLink(value.pending, record.ciphertext, client)).link
  const rebase = parseContentAppendIntent(record).rebase
  if (payment && rebase && (contentAppendStorageRootHash(payment) !== rebase.storageRootHash
    || payment.approved?.gasBudget !== String(BigInt(rebase.certifyGasBudgetMist) * 2n))) throw new Error('CONTENT_APPEND_RECOVERY_PAYMENT_ROOT_MISMATCH')
  if (pending && (contentAppendPreparationFingerprint({ ...pending.previous, ciphertext: record.ciphertext }) !== contentAppendPreparationFingerprint(record)
    || payment?.register && contentAppendStorageRootHash(payment) !== contentAppendStorageRootHash(pending.previousPayment)))
    throw new Error('CONTENT_APPEND_RECOVERY_PENDING_MISMATCH')
  const bundle = { record, payment, history, pending }, known = knownPreparations(bundle)
  let paidRoot: string | null = rebase?.storageRootHash ?? null
  const validatePayment = (input: WalrusSingleRecord) => {
    const parsed = parseWalrusSingleRecord(input), preparation = known.get(walrusSingleKey(parsed.intent))
    check(preparation, 'ADDITIONAL_PAYMENT_UNKNOWN_PREPARATION')
    const result = assertContentAppendWalrusRecord(preparation, parsed), intent = parseContentAppendIntent(preparation)
    if (intent.rebase && result.approved) check(result.approved.gasBudget === String(BigInt(intent.rebase.certifyGasBudgetMist) * 2n), 'PAYMENT_ROOT_MISMATCH')
    if (result.register) {
      const root = contentAppendStorageRootHash(result)
      check(paidRoot === null || paidRoot === root, 'PAYMENT_ROOT_MISMATCH'); paidRoot = root
      check(!intent.rebase || intent.rebase.storageRootHash === root, 'PAYMENT_ROOT_MISMATCH')
    }
    return result
  }
  const seen = new Set(recordedPayments(bundle).map(value => JSON.stringify(validatePayment(value))))
  const additionalPayments = value.additionalPayments.map(value => {
    const parsed = validatePayment(value), encoded = JSON.stringify(parsed)
    check(!seen.has(encoded), 'ADDITIONAL_PAYMENT_DUPLICATE'); seen.add(encoded); return parsed
  })
  return { ...bundle, additionalPayments }
}
/** A public signed preparation plus its complete public payment evidence. No
 * plaintext/key material, local journal adoption or payment is performed. */
export async function exportContentAppendRecovery(input: ContentAppendPreparation, client: SuiGrpcClient,
  readPayment = readWalrusSingleRecord, readTransitions = async (record: ContentAppendPreparation) => {
    const store = browserContentAppendRebaseStore(client)
    return { history: parseContentAppendIntent(record).rebase ? await store.history(record) : [], pending: await store.pending(record) }
  }): Promise<string> {
  const record = await verifyContentAppendPreparation(input, client)
  const stored = readPayment(walrusSingleKey(contentAppendWalrusIntent(record)))
  const payment = stored === null ? null : assertContentAppendWalrusRecord(record, stored)
  const transitions = await readTransitions(record)
  const bundle = await verifyContentAppendRecoveryBundle({ record, payment, ...transitions, additionalPayments: [] }, client)
  const seen = new Set(recordedPayments(bundle).map(value => JSON.stringify(value)))
  const headKey = walrusSingleKey(contentAppendWalrusIntent(record))
  for (const [key, preparation] of knownPreparations(bundle)) {
    // The head was already read once above. Do not combine two observations of
    // a replaceable head WAL while collecting the other exact preparation keys.
    if (key === headKey) continue
    const input = readPayment(key)
    if (input === null) continue
    const extra = assertContentAppendWalrusRecord(preparation, input), encoded = JSON.stringify(extra)
    if (!seen.has(encoded)) { seen.add(encoded); bundle.additionalPayments.push(extra) }
  }
  const text = encode(await verifyContentAppendRecoveryBundle(bundle, client))
  check(text.length <= 100 * 1024 * 1024, 'EXPORT_SIZE_INVALID')
  return text
}
export async function importContentAppendRecovery(text: string, client: SuiGrpcClient): Promise<ContentAppendRecoveryBundle> {
  if (typeof text !== 'string' || text.length > 100 * 1024 * 1024) throw new Error('CONTENT_APPEND_RECOVERY_IMPORT_SIZE_INVALID')
  const value = JSON.parse(text)
  if (!value || Object.keys(value).length !== 6 || value.schema !== 'soulidity.content-append-recovery.v2'
    || !['preparation', 'payment', 'history', 'pending', 'additionalPayments'].every(key => Object.hasOwn(value, key))) throw new Error('CONTENT_APPEND_RECOVERY_IMPORT_SCHEMA_INVALID')
  const record = await importContentAppendPreparation(JSON.stringify(value.preparation), client)
  const bundle = await verifyContentAppendRecoveryBundle({ record, payment: value.payment, history: value.history, pending: value.pending,
    additionalPayments: value.additionalPayments }, client)
  if (encode(bundle) !== text) throw new Error('CONTENT_APPEND_RECOVERY_IMPORT_NOT_CANONICAL')
  return bundle
}
