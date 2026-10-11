import { validateBrowserPrivateLoadoutConfig, type BrowserPrivateLoadoutConfig } from './browser-private-loadout'
import { privateLoadoutCanonical, privateLoadoutCheck as check, privateLoadoutId, validatePrivateLoadoutScope } from './private-loadout-library'
import { parsePrivateLoadoutRecovery, parsePrivateLoadoutRecoveryExport, validatePrivateLoadoutPaymentRecovery, type PrivateLoadoutRecovery } from './private-loadout-recovery'
import type { createPrivateLoadoutTransactionAdapter, PrivateLoadoutTransactionStatus } from './private-loadout-transaction'
import type { recoverPrivateLoadoutStorage } from './private-loadout-storage'
import { parseWalrusSingleRecord, type WalrusSingleRecord } from '../upload/walrus-single-operation'

export interface PrivateLoadoutHistoricalExpected {
  originalPackageId: string; soulId: string; stateId: string; owner: string
}
export type PrivateLoadoutHistoricalStorageStatus = Awaited<ReturnType<typeof recoverPrivateLoadoutStorage>>['status']
export type PrivateLoadoutHistoricalBundle = ReturnType<typeof parsePrivateLoadoutRecoveryExport>
export type PrivateLoadoutHistoryResult = Readonly<
  { kind: 'HEAD'; status: PrivateLoadoutTransactionStatus; digest: string }
  | { kind: 'STORAGE'; status: PrivateLoadoutHistoricalStorageStatus; digest: string | null }
>

/** Import validation only: old owner epochs and archived records remain public
 * query evidence. This neither installs a recovery record nor decrypts a library. */
export function parsePrivateLoadoutHistoricalExport(encoded: string, expected: PrivateLoadoutHistoricalExpected): PrivateLoadoutHistoricalBundle {
  const identity = structuredClone(expected)
  check(identity && typeof identity === 'object' && !Array.isArray(identity)
    && Object.keys(identity).length === 4 && ['originalPackageId', 'soulId', 'stateId', 'owner'].every(key => Object.hasOwn(identity, key))
    && Object.values(identity).every(privateLoadoutId), 'PRIVATE_LOADOUT_HISTORY_IDENTITY_INVALID')
  check(typeof encoded === 'string' && encoded.length > 0 && encoded.length <= 30 * 1024 * 1024, 'PRIVATE_LOADOUT_IMPORT_TOO_LARGE')
  const wire = JSON.parse(encoded)
  const scope = validatePrivateLoadoutScope(wire?.record?.context?.scope)
  check(scope.soulId === identity.soulId && scope.stateId === identity.stateId && scope.owner === identity.owner,
    'PRIVATE_LOADOUT_HISTORY_SCOPE_MISMATCH')
  return parsePrivateLoadoutRecoveryExport(encoded, scope, identity.originalPackageId)
}

/** Exact historical query, deliberately without current-owner, Seal, signing,
 * upload or store capabilities. Status is supplied only by the existing proof
 * readers, never inferred from cached local completion/phase flags. */
export async function queryPrivateLoadoutHistory(input: {
  record: PrivateLoadoutRecovery
  /** undefined selects local recovery; null explicitly selects an unpaid export.
   * An inline payment journal is never installed in localStorage or IndexedDB. */
  walrus?: WalrusSingleRecord | null
  config: BrowserPrivateLoadoutConfig
  transactions: Pick<ReturnType<typeof createPrivateLoadoutTransactionAdapter>, 'query'>
  recoverStorage: (record: PrivateLoadoutRecovery, walrus?: WalrusSingleRecord | null) => Promise<{ status: PrivateLoadoutHistoricalStorageStatus }>
}): Promise<PrivateLoadoutHistoryResult> {
  const record = parsePrivateLoadoutRecovery(input.record), config = validateBrowserPrivateLoadoutConfig(input.config)
  const walrus = input.walrus === undefined ? undefined : input.walrus === null ? null : parseWalrusSingleRecord(input.walrus)
  if (walrus !== undefined) validatePrivateLoadoutPaymentRecovery(record, walrus)
  const readIdentity = (value: BrowserPrivateLoadoutConfig) => ({ ...value, target: { ...value.target, equipmentWritesEnabled: false } })
  check(privateLoadoutCanonical(readIdentity(record.config)) === privateLoadoutCanonical(readIdentity(config)),
    'PRIVATE_LOADOUT_HISTORY_CONFIGURATION_CHANGED')
  if (record.transaction) {
    check(typeof input.transactions?.query === 'function', 'PRIVATE_LOADOUT_HISTORY_QUERY_REQUIRED')
    const query = input.transactions.query.bind(input.transactions), { plan, packet } = record.transaction
    const digest = packet.digest
    const status = await query(structuredClone(plan), structuredClone(packet))
    check(['MISSING', 'PENDING', 'SUCCEEDED', 'FAILED'].includes(status), 'PRIVATE_LOADOUT_HISTORY_STATUS_INVALID')
    return Object.freeze({ kind: 'HEAD', status, digest })
  }
  check(typeof input.recoverStorage === 'function', 'PRIVATE_LOADOUT_HISTORY_STORAGE_QUERY_REQUIRED')
  const recover = input.recoverStorage, digest = record.storage?.certifyTxDigest ?? walrus?.certify?.digest ?? walrus?.register?.digest ?? null
  const result = await recover(structuredClone(record), walrus === undefined ? undefined : structuredClone(walrus))
  check(result && ['NONE', 'SOURCE_REQUIRED', 'UNKNOWN', 'FAILED', 'CERTIFIED'].includes(result.status), 'PRIVATE_LOADOUT_HISTORY_STATUS_INVALID')
  return Object.freeze({ kind: 'STORAGE', status: result.status, digest })
}
