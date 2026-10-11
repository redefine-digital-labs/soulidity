import { sha256 } from '@noble/hashes/sha2.js'
import { fromBase58, fromBase64, toBase58, toBase64, toHex } from '@mysten/sui/utils'
import { assertPrivateNamedLoadoutCipherRef, type PrivateNamedLoadoutCipherRef } from '@soulidity/sdk'
import { privateLoadoutCanonical, privateLoadoutCheck as check, privateLoadoutHash, privateLoadoutId,
  validatePrivateLoadoutScope, type PrivateLoadoutCapture, type PrivateLoadoutScope } from './private-loadout-library'
import { privateLoadoutCryptoContext, PrivateLoadoutEnvelopeBcs, privateLoadoutAad, type PrivateLoadoutCryptoContext } from './private-loadout-crypto'
import { validateBrowserPrivateLoadoutConfig, type BrowserPrivateLoadoutConfig } from './browser-private-loadout'
import { validatePrivateLoadoutUploadConfig, type PrivateLoadoutUploadConfig } from './private-loadout-storage'
import { validatePrivateLoadoutPublicPlan, validatePrivateLoadoutTransactionPacket,
  type PrivateLoadoutPublicPlan, type PrivateLoadoutTransactionPacket } from './private-loadout-transaction'
import { parseWalrusSingleRecord, readWalrusSingleRecord, walrusSingleKey, writeWalrusSingleRecord,
  type WalrusSingleRecord } from '../upload/walrus-single-operation'

export interface PrivateLoadoutStorageReceipt {
  reference: PrivateNamedLoadoutCipherRef; storageTxDigest: string; certifyTxDigest: string; recoveryKey: string; quoteId: string
}
/** Entire record is exportable, but only encrypted bytes and public metadata.
 * Application actions/names/entries and the private intent hash are forbidden. */
export interface PrivateLoadoutRecovery {
  schema: 'soulidity.private-loadout-recovery.v1'; sequence: number; status: 'ACTIVE' | 'COMPLETE' | 'ARCHIVED'
  paymentStarted: boolean
  config: BrowserPrivateLoadoutConfig; uploadConfig: PrivateLoadoutUploadConfig
  context: PrivateLoadoutCryptoContext; capture: PrivateLoadoutCapture | null
  ciphertext: Uint8Array; cipherSha256: string
  storage: PrivateLoadoutStorageReceipt | null
  transaction: { plan: PrivateLoadoutPublicPlan; packet: PrivateLoadoutTransactionPacket } | null
}
export interface PrivateLoadoutRecoveryStore {
  exclusive<T>(key: string, work: () => Promise<T>): Promise<T>
  /** Discovery only: callers must read and validate a selected record before querying it. */
  listActiveScopes(originalPackageId: string, soulId: string, stateId: string, owner: string): Promise<PrivateLoadoutScope[]>
  read(key: string): Promise<PrivateLoadoutRecovery | null>
  replace(key: string, expected: PrivateLoadoutRecovery | null, next: PrivateLoadoutRecovery): Promise<void>
  archive(key: string, expected: PrivateLoadoutRecovery): Promise<void>
  archived(key: string, requestId: string): Promise<PrivateLoadoutRecovery | null>
}
export const PRIVATE_LOADOUT_ACTIVE_SCOPE_LIMIT = 128
const exact = (v: unknown, keys: string[]): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k))
const hash = (bytes: Uint8Array) => toHex(sha256(bytes))
const eq = (a: unknown, b: unknown) => privateLoadoutCanonical(a) === privateLoadoutCanonical(b)
function digest(v: unknown): asserts v is string {
  check(typeof v === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v) && fromBase58(v).length === 32
    && toBase58(fromBase58(v)) === v, 'PRIVATE_LOADOUT_RECOVERY_DIGEST_INVALID')
}
export function privateLoadoutRecoveryKey(scope: PrivateLoadoutScope, originalPackageId: string) {
  const s = validatePrivateLoadoutScope(scope)
  check(privateLoadoutId(originalPackageId), 'PRIVATE_LOADOUT_RECOVERY_PACKAGE_INVALID')
  return `soulidity.private-loadout.v1:${originalPackageId}:${s.soulId}:${s.stateId}:${s.owner}:${s.ownershipEpoch}`
}
export function privateLoadoutStorageScope(record: Pick<PrivateLoadoutRecovery, 'context'>) {
  const c = privateLoadoutCryptoContext(record.context), s = c.scope
  return `private-loadout:${c.originalPackageId}:${s.soulId}:${s.stateId}:${s.ownershipEpoch}:${c.requestId}`
}
export function privateLoadoutWalrusKey(record: Pick<PrivateLoadoutRecovery, 'context'>) {
  return walrusSingleKey({ network: 'mainnet', owner: record.context.scope.owner, operationScope: privateLoadoutStorageScope(record) })
}
export function parsePrivateLoadoutRecovery(value: unknown): PrivateLoadoutRecovery {
  const r = structuredClone(value) as PrivateLoadoutRecovery
  check(exact(r, ['schema', 'sequence', 'status', 'paymentStarted', 'config', 'uploadConfig', 'context', 'capture', 'ciphertext', 'cipherSha256', 'storage', 'transaction'])
    && r.schema === 'soulidity.private-loadout-recovery.v1' && Number.isSafeInteger(r.sequence) && r.sequence >= 0
    && typeof r.paymentStarted === 'boolean' && ['ACTIVE', 'COMPLETE', 'ARCHIVED'].includes(r.status), 'PRIVATE_LOADOUT_RECOVERY_INVALID')
  r.config = validateBrowserPrivateLoadoutConfig(r.config); r.uploadConfig = validatePrivateLoadoutUploadConfig(r.uploadConfig)
  r.context = privateLoadoutCryptoContext(r.context)
  check(r.config.target.soulidityOriginalPackageId === r.context.originalPackageId, 'PRIVATE_LOADOUT_RECOVERY_RELEASE_MISMATCH')
  check(r.ciphertext instanceof Uint8Array && r.ciphertext.length > 0 && r.ciphertext.length <= 16 * 1024 * 1024
    && privateLoadoutHash(r.cipherSha256) && hash(r.ciphertext) === r.cipherSha256, 'PRIVATE_LOADOUT_RECOVERY_CIPHER_MISMATCH')
  const envelope = PrivateLoadoutEnvelopeBcs.parse(r.ciphertext), aad = privateLoadoutAad(r.context)
  check(toBase64(PrivateLoadoutEnvelopeBcs.serialize(envelope, { maxSize: 16 * 1024 * 1024 }).toBytes()) === toBase64(r.ciphertext)
    && envelope.version === 1 && envelope.iv.length === 12 && toBase64(new Uint8Array(envelope.aad)) === toBase64(aad),
  'PRIVATE_LOADOUT_RECOVERY_ENVELOPE_INVALID')
  if (r.capture !== null) check(exact(r.capture, ['equipmentId', 'revision', 'commitment']) && privateLoadoutId(r.capture.equipmentId)
    && /^(0|[1-9][0-9]{0,19})$/.test(r.capture.revision) && BigInt(r.capture.revision) <= 18446744073709551615n
    && privateLoadoutHash(r.capture.commitment), 'PRIVATE_LOADOUT_RECOVERY_CAPTURE_INVALID')
  if (r.storage !== null) {
    check(r.paymentStarted, 'PRIVATE_LOADOUT_RECOVERY_PAYMENT_MARKER_REQUIRED')
    check(exact(r.storage, ['reference', 'storageTxDigest', 'certifyTxDigest', 'recoveryKey', 'quoteId']), 'PRIVATE_LOADOUT_RECOVERY_STORAGE_INVALID')
    r.storage.reference = assertPrivateNamedLoadoutCipherRef(r.storage.reference)
    digest(r.storage.storageTxDigest); digest(r.storage.certifyTxDigest)
    check(r.storage.reference.sha256 === r.cipherSha256 && r.storage.reference.byteLength === String(r.ciphertext.length)
      && r.storage.recoveryKey === privateLoadoutWalrusKey(r) && typeof r.storage.quoteId === 'string'
      && r.storage.quoteId.length > 0 && r.storage.quoteId.length <= 4096, 'PRIVATE_LOADOUT_RECOVERY_RECEIPT_MISMATCH')
  }
  if (r.transaction !== null) {
    check(r.storage && exact(r.transaction, ['plan', 'packet']), 'PRIVATE_LOADOUT_RECOVERY_TRANSACTION_INVALID')
    const plan = validatePrivateLoadoutPublicPlan(r.transaction.plan)
    const packet = validatePrivateLoadoutTransactionPacket(plan, r.transaction.packet)
    check(eq(plan.scope, r.context.scope) && plan.deployment.originalPackageId === r.context.originalPackageId
      && plan.deployment.callablePackageId === r.config.target.soulidityCallablePackageId && plan.deployment.chainIdentifier === '35834a8a'
      && plan.requestId === r.context.requestId && BigInt(plan.expectedRevision) + 1n === BigInt(r.context.revision)
      && eq(plan.ciphertext, r.storage.reference) && eq(plan.capture, r.capture) && plan.protocolId === r.config.target.protocolConfigId,
    'PRIVATE_LOADOUT_RECOVERY_PLAN_MISMATCH')
    r.transaction = { plan, packet }
  }
  // A receipt committed from another device may be accepted without creating a
  // new packet; COMPLETE still requires chain revalidation before archive/use.
  check(r.status !== 'COMPLETE' || r.storage !== null, 'PRIVATE_LOADOUT_RECOVERY_COMPLETION_INVALID')
  return r
}
export function privateLoadoutRecoveryFingerprint(value: PrivateLoadoutRecovery) {
  const r = parsePrivateLoadoutRecovery(value)
  return hash(new TextEncoder().encode(privateLoadoutCanonical({ ...r, ciphertext: r.cipherSha256 })))
}
function matchesKey(key: string, r: PrivateLoadoutRecovery) {
  check(privateLoadoutRecoveryKey(r.context.scope, r.context.originalPackageId) === key, 'PRIVATE_LOADOUT_RECOVERY_KEY_MISMATCH')
}
function sameExpected(value: unknown, expected: PrivateLoadoutRecovery | null) {
  check(expected === null ? value === undefined : value !== undefined
    && privateLoadoutRecoveryFingerprint(value as PrivateLoadoutRecovery) === privateLoadoutRecoveryFingerprint(expected), 'PRIVATE_LOADOUT_RECOVERY_CAS_CONFLICT')
}
/** Strict IndexedDB transactions retain exact ciphertext beyond localStorage's
 * small quota. Web Locks cover the multi-step wallet workflow; CAS is enforced
 * again inside each actual database transaction. No plaintext cache exists. */
export function browserPrivateLoadoutRecoveryStore(): PrivateLoadoutRecoveryStore {
  function open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      check(typeof indexedDB !== 'undefined' && typeof navigator !== 'undefined' && navigator.locks?.request,
        'PRIVATE_LOADOUT_RECOVERY_STORAGE_REQUIRED')
      const request = indexedDB.open('soulidity-private-loadout-recovery', 1)
      let rejected = false
      request.onupgradeneeded = () => { request.result.createObjectStore('active'); request.result.createObjectStore('archive') }
      request.onerror = () => reject(new Error('PRIVATE_LOADOUT_RECOVERY_OPEN_FAILED', { cause: request.error }))
      request.onblocked = () => { rejected = true; reject(new Error('PRIVATE_LOADOUT_RECOVERY_OPEN_BLOCKED')) }
      request.onsuccess = () => { if (rejected) request.result.close(); else resolve(request.result) }
    })
  }
  async function read(store: 'active' | 'archive', key: string, scopeKey: string) {
    const db = await open()
    try {
      return await new Promise<PrivateLoadoutRecovery | null>((resolve, reject) => {
        const tx = db.transaction(store, 'readonly'), request = tx.objectStore(store).get(key)
        tx.onabort = () => reject(new Error('PRIVATE_LOADOUT_RECOVERY_READ_FAILED', { cause: tx.error }))
        tx.oncomplete = () => {
          try {
            if (request.result === undefined) { resolve(null); return }
            const record = parsePrivateLoadoutRecovery(request.result); matchesKey(scopeKey, record); resolve(record)
          } catch (error) { reject(error) }
        }
      })
    } finally { db.close() }
  }
  async function listActiveScopes(originalPackageId: string, soulId: string, stateId: string, owner: string) {
    const base = validatePrivateLoadoutScope({ soulId, stateId, owner, ownershipEpoch: '0' })
    // Derive the prefix with the same canonical validation as writers. A bounded
    // key cursor never materializes ciphertext, archive values, or other owners.
    const prefix = privateLoadoutRecoveryKey(base, originalPackageId).slice(0, -1)
    const db = await open()
    try {
      return await new Promise<PrivateLoadoutScope[]>((resolve, reject) => {
        const tx = db.transaction('active', 'readonly'), scopes: PrivateLoadoutScope[] = []
        // ':' is the final prefix character; its exclusive successor ';'
        // includes every suffix, even malformed non-ASCII epoch strings.
        const request = tx.objectStore('active').openKeyCursor(IDBKeyRange.bound(prefix, `${prefix.slice(0, -1)};`, false, true))
        let cause: unknown
        tx.onabort = () => reject(cause ?? new Error('PRIVATE_LOADOUT_RECOVERY_SCOPE_READ_FAILED', { cause: tx.error }))
        tx.oncomplete = () => resolve(scopes.sort((a, b) => BigInt(a.ownershipEpoch) < BigInt(b.ownershipEpoch) ? -1 : 1))
        request.onsuccess = () => {
          try {
            const cursor = request.result
            if (!cursor) return
            check(scopes.length < PRIVATE_LOADOUT_ACTIVE_SCOPE_LIMIT, 'PRIVATE_LOADOUT_RECOVERY_TOO_MANY_ACTIVE_SCOPES')
            check(typeof cursor.key === 'string' && cursor.key.startsWith(prefix), 'PRIVATE_LOADOUT_RECOVERY_SCOPE_KEY_INVALID')
            const scope = validatePrivateLoadoutScope({ ...base, ownershipEpoch: cursor.key.slice(prefix.length) })
            check(privateLoadoutRecoveryKey(scope, originalPackageId) === cursor.key, 'PRIVATE_LOADOUT_RECOVERY_SCOPE_KEY_INVALID')
            scopes.push(scope); cursor.continue()
          } catch (error) { cause = error; tx.abort() }
        }
      })
    } finally { db.close() }
  }
  async function update(key: string, expected: PrivateLoadoutRecovery | null, next: PrivateLoadoutRecovery, archive: boolean) {
    const before = expected ? parsePrivateLoadoutRecovery(expected) : null, after = parsePrivateLoadoutRecovery(next)
    matchesKey(key, after); if (before) matchesKey(key, before)
    check(after.sequence === (before ? before.sequence + 1 : 0), 'PRIVATE_LOADOUT_RECOVERY_SEQUENCE_MISMATCH')
    check(!before || before.context.requestId === after.context.requestId, 'PRIVATE_LOADOUT_RECOVERY_REQUEST_REPLACEMENT')
    if (before) {
      for (const field of ['config', 'uploadConfig', 'context', 'capture', 'cipherSha256'] as const)
        check(eq(before[field], after[field]), 'PRIVATE_LOADOUT_RECOVERY_FROZEN_INTENT_CHANGED')
      check(!before.paymentStarted || after.paymentStarted, 'PRIVATE_LOADOUT_RECOVERY_PAYMENT_MARKER_REVERSED')
      check(before.storage === null || eq(before.storage, after.storage), 'PRIVATE_LOADOUT_RECOVERY_PAID_RECEIPT_REPLACED')
      if (before.transaction) check(after.transaction && eq(before.transaction.plan, after.transaction.plan)
        && before.transaction.packet.bytes === after.transaction.packet.bytes && before.transaction.packet.digest === after.transaction.packet.digest,
      'PRIVATE_LOADOUT_RECOVERY_PACKET_REPLACED')
    }
    check(archive === (after.status === 'ARCHIVED'), 'PRIVATE_LOADOUT_RECOVERY_ARCHIVE_MISMATCH')
    const db = await open()
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(archive ? ['active', 'archive'] : ['active'], 'readwrite', { durability: 'strict' })
        const active = tx.objectStore('active'), request = active.get(key)
        let cause: unknown
        const abort = (error: unknown) => { cause = error; tx.abort() }
        tx.onabort = () => reject(cause ?? new Error('PRIVATE_LOADOUT_RECOVERY_WRITE_FAILED', { cause: tx.error }))
        tx.oncomplete = () => resolve()
        request.onsuccess = () => {
          try {
            sameExpected(request.result, before)
            if (!archive) { active.put(after, key); return }
            const history = tx.objectStore('archive'), historyKey = `${key}:${after.context.requestId}`, old = history.get(historyKey)
            old.onsuccess = () => {
              try {
                check(old.result === undefined || privateLoadoutRecoveryFingerprint(old.result) === privateLoadoutRecoveryFingerprint(after),
                  'PRIVATE_LOADOUT_RECOVERY_ARCHIVE_CONFLICT')
                history.put(after, historyKey); active.delete(key)
              } catch (error) { abort(error) }
            }
          } catch (error) { abort(error) }
        }
      })
    } finally { db.close() }
  }
  return {
    listActiveScopes,
    exclusive: (key, work) => {
      check(typeof navigator !== 'undefined' && navigator.locks?.request, 'PRIVATE_LOADOUT_RECOVERY_LOCKS_REQUIRED')
      return navigator.locks.request(key, { mode: 'exclusive', ifAvailable: true }, async lock => {
        check(lock, 'PRIVATE_LOADOUT_RECOVERY_BUSY_IN_ANOTHER_TAB'); return work()
      })
    },
    read: key => read('active', key, key),
    replace: (key, expected, next) => update(key, expected, next, false),
    archive: (key, expected) => update(key, expected, { ...expected, sequence: expected.sequence + 1, status: 'ARCHIVED' }, true),
    archived: (key, requestId) => { check(privateLoadoutHash(requestId), 'PRIVATE_LOADOUT_RECOVERY_REQUEST_INVALID'); return read('archive', `${key}:${requestId}`, key) },
  }
}
export function validatePrivateLoadoutPaymentRecovery(r: PrivateLoadoutRecovery, walrus: WalrusSingleRecord | null) {
  if (!walrus) { check(!r.paymentStarted && r.storage === null && r.transaction === null, 'PRIVATE_LOADOUT_PAYMENT_RECOVERY_MISSING'); return }
  const w = parseWalrusSingleRecord(walrus)
  check(exact(w, ['schema', 'intent', 'encoding', 'uploaded', 'approved', 'register', 'certify', 'acknowledged'])
    && exact(w.intent, ['network', 'owner', 'recipient', 'operationScope', 'attachmentScope', 'contentHash', 'payloadHash', 'payloadByteLength', 'storageEpochs', 'relayUrl'])
    && (w.encoding === null || exact(w.encoding, ['blobId', 'rootHash', 'unencodedSize', 'nonce']))
    && (w.uploaded === null || exact(w.uploaded, ['blobId', 'blobObjectId', 'certificate']))
    && (w.approved === null || exact(w.approved, ['relayTip', 'storageCost', 'writeCost', 'gasBudget', 'quoteId']))
    && [w.register, w.certify].every(p => p === null || exact(p, ['bytes', 'digest', 'expirationEpoch', 'phase', 'signature'])),
  'PRIVATE_LOADOUT_PAYMENT_RECOVERY_FIELDS_INVALID')
  check(walrusSingleKey(w.intent) === privateLoadoutWalrusKey(r) && w.intent.owner === r.context.scope.owner && w.intent.recipient === r.context.scope.owner
    && w.intent.network === 'mainnet' && w.intent.attachmentScope === null && w.intent.contentHash === r.cipherSha256
    && w.intent.payloadHash === r.cipherSha256 && w.intent.payloadByteLength === r.ciphertext.length
    && w.intent.storageEpochs === r.uploadConfig.storageEpochs && w.intent.relayUrl === r.uploadConfig.relayUrl, 'PRIVATE_LOADOUT_PAYMENT_RECOVERY_MISMATCH')
  if (r.storage) check(w.register?.digest === r.storage.storageTxDigest && w.certify?.digest === r.storage.certifyTxDigest
    && w.register.phase === 'SUCCEEDED' && w.certify.phase === 'SUCCEEDED' && w.uploaded?.blobId === r.storage.reference.blobId
    && w.uploaded.blobObjectId === r.storage.reference.blobObjectId && w.approved?.quoteId === r.storage.quoteId,
  'PRIVATE_LOADOUT_PAYMENT_RECEIPT_MISMATCH')
}
export function exportPrivateLoadoutRecovery(input: PrivateLoadoutRecovery) {
  const record = parsePrivateLoadoutRecovery(input), walrus = readWalrusSingleRecord(privateLoadoutWalrusKey(record))
  validatePrivateLoadoutPaymentRecovery(record, walrus)
  return JSON.stringify({ schema: 'soulidity.private-loadout-recovery-export.v1', record: { ...record, ciphertext: toBase64(record.ciphertext) }, walrus })
}
/** Import never overwrites an unknown local payment or private operation. If
 * IDB fails after the public WAL write, retrying the same bundle is idempotent. */
export function parsePrivateLoadoutRecoveryExport(encoded: string, expectedScope: PrivateLoadoutScope,
  expectedPackageId: string) {
  check(typeof encoded === 'string' && encoded.length > 0 && encoded.length <= 30 * 1024 * 1024, 'PRIVATE_LOADOUT_IMPORT_TOO_LARGE')
  const value = JSON.parse(encoded)
  check(exact(value, ['schema', 'record', 'walrus']) && value.schema === 'soulidity.private-loadout-recovery-export.v1'
    && value.record && typeof value.record === 'object' && 'ciphertext' in value.record && typeof value.record.ciphertext === 'string', 'PRIVATE_LOADOUT_IMPORT_INVALID')
  const bytes = fromBase64(value.record.ciphertext)
  check(toBase64(bytes) === value.record.ciphertext, 'PRIVATE_LOADOUT_IMPORT_BYTES_INVALID')
  const record = parsePrivateLoadoutRecovery({ ...value.record, ciphertext: bytes })
  const key = privateLoadoutRecoveryKey(expectedScope, expectedPackageId); matchesKey(key, record)
  const walrus = value.walrus === null ? null : parseWalrusSingleRecord(value.walrus)
  validatePrivateLoadoutPaymentRecovery(record, walrus)
  return { record, walrus }
}
export async function importPrivateLoadoutRecovery(encoded: string, store: PrivateLoadoutRecoveryStore, expectedScope: PrivateLoadoutScope,
  expectedPackageId: string) {
  const { record, walrus } = parsePrivateLoadoutRecoveryExport(encoded, expectedScope, expectedPackageId)
  const imported = { ...record, sequence: 0 }, key = privateLoadoutRecoveryKey(expectedScope, expectedPackageId)
  check(record.status !== 'ARCHIVED', 'PRIVATE_LOADOUT_IMPORT_ARCHIVED_REBASE_REQUIRED')
  return store.exclusive(key, async () => {
    const current = await store.read(key)
    check(current === null || privateLoadoutRecoveryFingerprint(current) === privateLoadoutRecoveryFingerprint(imported), 'PRIVATE_LOADOUT_IMPORT_EXISTING_OPERATION')
    const walrusKey = privateLoadoutWalrusKey(record), local = readWalrusSingleRecord(walrusKey)
    check(local === null || walrus !== null && eq(local, walrus), 'PRIVATE_LOADOUT_IMPORT_EXISTING_PAYMENT')
    if (walrus && !local) writeWalrusSingleRecord(walrusKey, walrus)
    if (!current) await store.replace(key, null, imported)
    return (await store.read(key))!
  })
}
