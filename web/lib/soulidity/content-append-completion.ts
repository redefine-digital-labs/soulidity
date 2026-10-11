import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { readWalrusSingleRecord, walrusSingleKey, withWalrusSingleLock, type WalrusSingleRecord } from '../upload/walrus-single-operation'
import { assertContentAppendWalrusRecord, contentAppendWalrusIntent, queryContentAppend } from './content-append-operation'
import { contentAppendPreparationFingerprint, type ContentAppendPreparation } from './content-append-preparation'
import { browserContentAppendStore, contentAppendStoreKey } from './content-append-store'
import { browserContentAppendRestoreStore } from './content-append-restore-store'
import { exportContentAppendRecovery, importContentAppendRecovery, verifyContentAppendRecoveryBundle, type ContentAppendRecoveryBundle } from './content-append-recovery'

type Result = Awaited<ReturnType<typeof queryContentAppend>>
const defaults = { query: queryContentAppend, read: readWalrusSingleRecord, lock: withWalrusSingleLock,
  store: browserContentAppendStore, restores: browserContentAppendRestoreStore,
  bundle: async (record: ContentAppendPreparation, client: SuiGrpcClient) =>
    importContentAppendRecovery(await exportContentAppendRecovery(record, client), client) }
function check(value: unknown, code: string): asserts value { if (!value) throw new Error(`CONTENT_APPEND_COMPLETION_${code}`) }

/** All attempts refer to the same signed encrypted payload and paid register.
 * Different known certify packets are retained and queried, never merged away.
 * Detached imports deliberately do not consult local payment storage. */
async function attempts(bundle: ContentAppendRecoveryBundle, client: SuiGrpcClient,
  read?: typeof readWalrusSingleRecord) {
  bundle = await verifyContentAppendRecoveryBundle(bundle, client)
  const candidates: { record: ContentAppendPreparation; payment: WalrusSingleRecord | null }[] = []
  const add = (record: ContentAppendPreparation, payment: WalrusSingleRecord | null) => {
    if (payment) assertContentAppendWalrusRecord(record, payment)
    if (!candidates.some(c => contentAppendPreparationFingerprint(c.record) === contentAppendPreparationFingerprint(record)
      && JSON.stringify(c.payment) === JSON.stringify(payment))) candidates.push({ record, payment })
  }
  for (const link of [...bundle.history, ...(bundle.pending ? [bundle.pending] : [])]) {
    add({ ...link.previous, ciphertext: bundle.record.ciphertext }, link.previousPayment)
    add({ ...link.next, ciphertext: bundle.record.ciphertext }, link.nextPayment)
  }
  add(bundle.record, bundle.payment)
  for (const payment of bundle.additionalPayments) {
    const matching = candidates.find(c => walrusSingleKey(contentAppendWalrusIntent(c.record)) === walrusSingleKey(payment.intent))
    check(matching, 'ADDITIONAL_PAYMENT_UNKNOWN'); add(matching.record, payment)
  }
  if (read) for (const candidate of [...candidates]) {
    const local = read(walrusSingleKey(contentAppendWalrusIntent(candidate.record)))
    if (local) add(candidate.record, local)
  }
  return candidates
}

/** Read-only: no unlock/sign/send, no WAL updates and no automatic archive. */
export async function queryContentAppendCompletion(params: {
  bundle: ContentAppendRecoveryBundle; client: SuiGrpcClient; signal: AbortSignal; local?: boolean
}, injected: Partial<typeof defaults> = {}) {
  const deps = { ...defaults, ...injected }, { client, signal } = params
  const known = await attempts(params.bundle, client, params.local ? deps.read : undefined)
  const results: { record: ContentAppendPreparation; result: Result | null; error: string | null }[] = []
  for (const candidate of known) {
    signal.throwIfAborted()
    try {
      const result = await deps.query({ ...candidate, signal,
        execution: { client, getAddress: () => null, sign: async () => { throw new Error('CONTENT_APPEND_COMPLETION_CANNOT_SIGN') } } })
      signal.throwIfAborted(); results.push({ record: candidate.record, result, error: null })
    } catch (error) {
      signal.throwIfAborted()
      results.push({ record: candidate.record, result: null, error: error instanceof Error ? error.message : 'Historical query unavailable' })
    }
  }
  return { completed: results.find(row => row.result?.historical) ?? null, attempts: results }
}

export async function queryLocalContentAppendCompletion(params: {
  record: ContentAppendPreparation; client: SuiGrpcClient; signal: AbortSignal
}, injected: Partial<typeof defaults> = {}) {
  const deps = { ...defaults, ...injected }
  return queryContentAppendCompletion({ ...params, bundle: await deps.bundle(params.record, params.client), local: true }, deps)
}

/** Explicit local finish. The slot and every ancestor WAL stay locked through
 * proof and atomic archive. The archived head retains its history/pending keys;
 * exact packets are exportable even if their local phase still says SIGNED.
 * No journal is deleted or relabelled as succeeded merely because another
 * attempt completed. A failed archive can safely retry the exact same head. */
export async function finishContentAppendCompletion(params: {
  record: ContentAppendPreparation; client: SuiGrpcClient; signal: AbortSignal; getAddress: () => string | null
}, injected: Partial<typeof defaults> = {}) {
  const deps = { ...defaults, ...injected }, { client, signal } = params
  const record = structuredClone(params.record), key = contentAppendStoreKey(record.scope), store = deps.store(client)
  const guard = () => { signal.throwIfAborted(); check(params.getAddress() === record.scope.author, 'RECONNECT_AUTHOR_WALLET') }
  guard()
  return store.exclusive(key, async () => {
    guard()
    const active = await store.read(key); guard()
    check(!active || contentAppendPreparationFingerprint(active) === contentAppendPreparationFingerprint(record), 'ACTIVE_CHANGED')
    check(!await deps.restores(client).read(key), 'RESTORE_UNFINISHED'); guard()
    const bundle = await deps.bundle(record, client), known = await attempts(bundle, client)
    const keys = [...new Set(known.map(c => walrusSingleKey(contentAppendWalrusIntent(c.record))))].sort()
    async function locked(index: number): Promise<Awaited<ReturnType<typeof queryContentAppendCompletion>>> {
      if (index < keys.length) return deps.lock(keys[index], () => locked(index + 1))
      guard()
      // Capture the actual exportable receipt again while every WAL is locked.
      // A payment may have advanced while the lock set was being acquired.
      const receipt = await deps.bundle(record, client); guard()
      const result = await queryContentAppendCompletion({ bundle: receipt, client, signal, local: true }, deps); guard()
      check(result.completed, 'ORIGINAL_SUCCESS_NOT_PROVED')
      await store.archive(key, record); guard()
      return result
    }
    return locked(0)
  })
}

export function describeContentAppendCompletion(value: Awaited<ReturnType<typeof queryContentAppendCompletion>>) {
  const done = value.completed
  if (done?.result?.historical) {
    const observation = done.result.currentStatus === 'MATCHES_ORIGINAL' ? 'Current state still matches.'
      : done.result.currentStatus === 'CHANGED' ? 'Current state has since changed.' : 'Current state is unavailable; the historical proof remains valid.'
    return `Original append v${done.record.scope.versionIndex} verified (${done.result.historical.certifyDigest}). ${observation} No transaction was signed or sent.`
  }
  const states = value.attempts.map(row => row.error ?? row.result?.recovery.status ?? 'UNKNOWN')
  return `Original completion is not proved. Recorded status: ${[...new Set(states)].join('; ')}. Recovery records retained; no transaction was signed or sent.`
}
