import { sha256 } from '@noble/hashes/sha2.js'
import { fromBase58, fromBase64, toBase58, toBase64, toHex } from '@mysten/sui/utils'
import { assertPrivateWalletBookmarksCipherRef, type PrivateWalletBookmarksCipherRef } from '@soulidity/sdk'
import { PRIVATE_BOOKMARK_MAX_BYTES, bookmarkCanonical, bookmarkCheck as check, bookmarkHash, bookmarkId,
  validatePrivateBookmarkScope, type PrivateBookmarkScope } from './private-bookmark-library'
import { privateBookmarkCryptoContext, PrivateBookmarkEnvelopeBcs, privateBookmarkAad, validatePrivateBookmarkEnvelope, type PrivateBookmarkCryptoContext } from './private-bookmark-crypto'
import { validateBrowserPrivateBookmarkConfig, type BrowserPrivateBookmarkConfig } from './browser-private-bookmarks'
import { validatePrivateBookmarkUploadConfig, type PrivateBookmarkUploadConfig } from './private-bookmark-storage'
import { validatePrivateBookmarkPublicPlan, validatePrivateBookmarkTransactionPacket,
  type PrivateBookmarkPublicPlan, type PrivateBookmarkTransactionPacket } from './private-bookmark-transaction'
import { parseWalrusSingleRecord, readWalrusSingleRecord, walrusSingleKey, writeWalrusSingleRecord,
  type WalrusSingleRecord } from '../upload/walrus-single-operation'

export interface PrivateBookmarkStorageReceipt {
  reference: PrivateWalletBookmarksCipherRef; storageTxDigest: string; certifyTxDigest: string; recoveryKey: string; quoteId: string
}
/** Entire record is exportable, but only encrypted bytes and public metadata.
 * Application actions/names/entries and the private intent hash are forbidden. */
export interface PrivateBookmarkRecovery {
  schema: 'soulidity.private-bookmark-recovery.v1'; sequence: number; status: 'ACTIVE' | 'COMPLETE' | 'ARCHIVED'
  paymentStarted: boolean
  config: BrowserPrivateBookmarkConfig; uploadConfig: PrivateBookmarkUploadConfig
  context: PrivateBookmarkCryptoContext
  ciphertext: Uint8Array; cipherSha256: string
  storage: PrivateBookmarkStorageReceipt | null
  transaction: { plan: PrivateBookmarkPublicPlan; packet: PrivateBookmarkTransactionPacket } | null
}
export interface PrivateBookmarkRecoveryStore {
  exclusive<T>(key: string, work: () => Promise<T>): Promise<T>
  read(key: string): Promise<PrivateBookmarkRecovery | null>
  replace(key: string, expected: PrivateBookmarkRecovery | null, next: PrivateBookmarkRecovery): Promise<void>
  archive(key: string, expected: PrivateBookmarkRecovery): Promise<void>
  archived(key: string, requestId: string): Promise<PrivateBookmarkRecovery | null>
}
const exact = (v: unknown, keys: string[]): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k))
const hash = (bytes: Uint8Array) => toHex(sha256(bytes))
const eq = (a: unknown, b: unknown) => bookmarkCanonical(a) === bookmarkCanonical(b)
function digest(v: unknown): asserts v is string {
  check(typeof v === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v) && fromBase58(v).length === 32
    && toBase58(fromBase58(v)) === v, 'RECOVERY_DIGEST_INVALID')
}
export function privateBookmarkRecoveryKey(scope: PrivateBookmarkScope, originalPackageId: string) {
  const s = validatePrivateBookmarkScope(scope)
  check(bookmarkId(originalPackageId), 'RECOVERY_PACKAGE_INVALID')
  return `soulidity.private-bookmark.v1:${originalPackageId}:${s.registryId}:${s.owner}`
}
export function privateBookmarkStorageScope(record: Pick<PrivateBookmarkRecovery, 'context'>) {
  const c = privateBookmarkCryptoContext(record.context), s = c.scope
  return `private-bookmark:${c.chainIdentifier}:${c.originalPackageId}:${s.registryId}:${s.owner}:${c.requestId}`
}
export function privateBookmarkWalrusKey(record: Pick<PrivateBookmarkRecovery, 'context'>) {
  return walrusSingleKey({ network: 'mainnet', owner: record.context.scope.owner, operationScope: privateBookmarkStorageScope(record) })
}
export function parsePrivateBookmarkRecovery(value: unknown): PrivateBookmarkRecovery {
  const r = structuredClone(value) as PrivateBookmarkRecovery
  check(exact(r, ['schema', 'sequence', 'status', 'paymentStarted', 'config', 'uploadConfig', 'context', 'ciphertext', 'cipherSha256', 'storage', 'transaction'])
    && r.schema === 'soulidity.private-bookmark-recovery.v1' && Number.isSafeInteger(r.sequence) && r.sequence >= 0
    && typeof r.paymentStarted === 'boolean' && ['ACTIVE', 'COMPLETE', 'ARCHIVED'].includes(r.status), 'RECOVERY_INVALID')
  r.config = validateBrowserPrivateBookmarkConfig(r.config); r.uploadConfig = validatePrivateBookmarkUploadConfig(r.uploadConfig)
  r.context = privateBookmarkCryptoContext(r.context)
  check(r.config.deployment.originalPackageId === r.context.originalPackageId && r.config.deployment.chainIdentifier === r.context.chainIdentifier
    && r.config.registryId === r.context.scope.registryId, 'RECOVERY_RELEASE_MISMATCH')
  check(r.ciphertext instanceof Uint8Array && r.ciphertext.length > 0 && r.ciphertext.length <= 16 * 1024 * 1024
    && bookmarkHash(r.cipherSha256) && hash(r.ciphertext) === r.cipherSha256, 'RECOVERY_CIPHER_MISMATCH')
  const envelope = PrivateBookmarkEnvelopeBcs.parse(r.ciphertext), aad = privateBookmarkAad(r.context)
  check(toBase64(PrivateBookmarkEnvelopeBcs.serialize(envelope, { maxSize: 16 * 1024 * 1024 }).toBytes()) === toBase64(r.ciphertext)
    && envelope.version === 1 && envelope.iv.length === 12 && envelope.wrapped_dek.length > 0 && envelope.wrapped_dek.length <= 256 * 1024
    && envelope.ciphertext.length > 16 && envelope.ciphertext.length <= PRIVATE_BOOKMARK_MAX_BYTES + 16
    && toBase64(new Uint8Array(envelope.aad)) === toBase64(aad),
  'RECOVERY_ENVELOPE_INVALID')
  if (r.storage !== null) {
    check(r.paymentStarted, 'RECOVERY_PAYMENT_MARKER_REQUIRED')
    check(exact(r.storage, ['reference', 'storageTxDigest', 'certifyTxDigest', 'recoveryKey', 'quoteId']), 'RECOVERY_STORAGE_INVALID')
    r.storage.reference = assertPrivateWalletBookmarksCipherRef(r.storage.reference)
    digest(r.storage.storageTxDigest); digest(r.storage.certifyTxDigest)
    check(r.storage.reference.sha256 === r.cipherSha256 && r.storage.reference.byteLength === String(r.ciphertext.length)
      && r.storage.recoveryKey === privateBookmarkWalrusKey(r) && typeof r.storage.quoteId === 'string'
      && r.storage.quoteId.length > 0 && r.storage.quoteId.length <= 4096, 'RECOVERY_RECEIPT_MISMATCH')
  }
  if (r.transaction !== null) {
    check(r.storage && exact(r.transaction, ['plan', 'packet']), 'RECOVERY_TRANSACTION_INVALID')
    const plan = validatePrivateBookmarkPublicPlan(r.transaction.plan)
    const packet = validatePrivateBookmarkTransactionPacket(plan, r.transaction.packet)
    check(eq(plan.scope, r.context.scope) && plan.deployment.originalPackageId === r.context.originalPackageId
      && eq(plan.deployment, r.config.deployment)
      && plan.requestId === r.context.requestId && BigInt(plan.expectedRevision) + 1n === BigInt(r.context.revision)
      && eq(plan.ciphertext, r.storage.reference),
    'RECOVERY_PLAN_MISMATCH')
    r.transaction = { plan, packet }
  }
  // A receipt committed from another device may be accepted without creating a
  // new packet; COMPLETE still requires chain revalidation before archive/use.
  check(r.status !== 'COMPLETE' || r.storage !== null && (!r.transaction || r.transaction.packet.phase === 'SUCCEEDED'), 'RECOVERY_COMPLETION_INVALID')
  return r
}
export function privateBookmarkRecoveryFingerprint(value: PrivateBookmarkRecovery) {
  const r = parsePrivateBookmarkRecovery(value)
  return hash(new TextEncoder().encode(bookmarkCanonical({ ...r, ciphertext: r.cipherSha256 })))
}
function matchesKey(key: string, r: PrivateBookmarkRecovery) {
  check(privateBookmarkRecoveryKey(r.context.scope, r.context.originalPackageId) === key, 'RECOVERY_KEY_MISMATCH')
}
function sameExpected(value: unknown, expected: PrivateBookmarkRecovery | null) {
  check(expected === null ? value === undefined : value !== undefined
    && privateBookmarkRecoveryFingerprint(value as PrivateBookmarkRecovery) === privateBookmarkRecoveryFingerprint(expected), 'RECOVERY_CAS_CONFLICT')
}
/** Strict IndexedDB transactions retain exact ciphertext beyond localStorage's
 * small quota. Web Locks cover the multi-step wallet workflow; CAS is enforced
 * again inside each actual database transaction. No plaintext cache exists. */
export function browserPrivateBookmarkRecoveryStore(): PrivateBookmarkRecoveryStore {
  function open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      check(typeof indexedDB !== 'undefined' && typeof navigator !== 'undefined' && navigator.locks?.request,
        'RECOVERY_STORAGE_REQUIRED')
      const request = indexedDB.open('soulidity-private-bookmark-recovery', 1)
      let rejected = false
      request.onupgradeneeded = () => { request.result.createObjectStore('active'); request.result.createObjectStore('archive') }
      request.onerror = () => reject(new Error('RECOVERY_OPEN_FAILED', { cause: request.error }))
      request.onblocked = () => { rejected = true; reject(new Error('RECOVERY_OPEN_BLOCKED')) }
      request.onsuccess = () => { if (rejected) request.result.close(); else resolve(request.result) }
    })
  }
  async function read(store: 'active' | 'archive', key: string, scopeKey: string) {
    const db = await open()
    try {
      return await new Promise<PrivateBookmarkRecovery | null>((resolve, reject) => {
        const tx = db.transaction(store, 'readonly'), request = tx.objectStore(store).get(key)
        tx.onabort = () => reject(new Error('RECOVERY_READ_FAILED', { cause: tx.error }))
        tx.oncomplete = () => {
          try {
            if (request.result === undefined) { resolve(null); return }
            const record = parsePrivateBookmarkRecovery(request.result); matchesKey(scopeKey, record); resolve(record)
          } catch (error) { reject(error) }
        }
      })
    } finally { db.close() }
  }
  async function update(key: string, expected: PrivateBookmarkRecovery | null, next: PrivateBookmarkRecovery, archive: boolean) {
    const before = expected ? parsePrivateBookmarkRecovery(expected) : null, after = parsePrivateBookmarkRecovery(next)
    matchesKey(key, after); if (before) matchesKey(key, before)
    check(after.sequence === (before ? before.sequence + 1 : 0), 'RECOVERY_SEQUENCE_MISMATCH')
    check(!before || before.context.requestId === after.context.requestId, 'RECOVERY_REQUEST_REPLACEMENT')
    if (before) {
      for (const field of ['config', 'uploadConfig', 'context', 'cipherSha256'] as const)
        check(eq(before[field], after[field]), 'RECOVERY_FROZEN_INTENT_CHANGED')
      check(!before.paymentStarted || after.paymentStarted, 'RECOVERY_PAYMENT_MARKER_REVERSED')
      check(before.storage === null || eq(before.storage, after.storage), 'RECOVERY_PAID_RECEIPT_REPLACED')
      if (before.transaction) check(after.transaction && eq(before.transaction.plan, after.transaction.plan)
        && before.transaction.packet.bytes === after.transaction.packet.bytes && before.transaction.packet.digest === after.transaction.packet.digest,
      'RECOVERY_PACKET_REPLACED')
      if (before.transaction) {
        const prior = before.transaction.packet, next = after.transaction!.packet
        check(prior.signature === null || prior.signature === next.signature, 'RECOVERY_SIGNATURE_REPLACED')
        const allowed = { PREPARED: ['PREPARED', 'SIGNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'],
          SIGNING: ['SIGNING', 'PREPARED', 'SIGNED', 'SUCCEEDED', 'FAILED'], SIGNED: ['SIGNED', 'SUCCEEDED', 'FAILED'],
          SUCCEEDED: ['SUCCEEDED'], FAILED: ['FAILED'], CANCELLED: ['CANCELLED'] }
        check(allowed[prior.phase].includes(next.phase), 'RECOVERY_PHASE_REVERSED')
      }
      check(before.status !== 'COMPLETE' || after.status !== 'ACTIVE', 'RECOVERY_COMPLETION_REVERSED')
    }
    check(archive === (after.status === 'ARCHIVED'), 'RECOVERY_ARCHIVE_MISMATCH')
    check(!archive || !after.transaction || !['SIGNING', 'SIGNED'].includes(after.transaction.packet.phase), 'RECOVERY_UNKNOWN_TRANSACTION')
    const db = await open()
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(archive ? ['active', 'archive'] : ['active'], 'readwrite', { durability: 'strict' })
        const active = tx.objectStore('active'), request = active.get(key)
        let cause: unknown
        const abort = (error: unknown) => { cause = error; tx.abort() }
        tx.onabort = () => reject(cause ?? new Error('RECOVERY_WRITE_FAILED', { cause: tx.error }))
        tx.oncomplete = () => resolve()
        request.onsuccess = () => {
          try {
            sameExpected(request.result, before)
            if (!archive) { active.put(after, key); return }
            const history = tx.objectStore('archive'), historyKey = `${key}:${after.context.requestId}`, old = history.get(historyKey)
            old.onsuccess = () => {
              try {
                check(old.result === undefined || privateBookmarkRecoveryFingerprint(old.result) === privateBookmarkRecoveryFingerprint(after),
                  'RECOVERY_ARCHIVE_CONFLICT')
                history.put(after, historyKey); active.delete(key)
              } catch (error) { abort(error) }
            }
          } catch (error) { abort(error) }
        }
      })
    } finally { db.close() }
  }
  return {
    exclusive: (key, work) => {
      check(typeof navigator !== 'undefined' && navigator.locks?.request, 'RECOVERY_LOCKS_REQUIRED')
      return navigator.locks.request(key, { mode: 'exclusive', ifAvailable: true }, async lock => {
        check(lock, 'RECOVERY_BUSY_IN_ANOTHER_TAB'); return work()
      })
    },
    read: key => read('active', key, key),
    replace: (key, expected, next) => update(key, expected, next, false),
    archive: (key, expected) => update(key, expected, { ...expected, sequence: expected.sequence + 1, status: 'ARCHIVED' }, true),
    archived: (key, requestId) => { check(bookmarkHash(requestId), 'RECOVERY_REQUEST_INVALID'); return read('archive', `${key}:${requestId}`, key) },
  }
}
export function validatePrivateBookmarkPaymentRecovery(r: PrivateBookmarkRecovery, walrus: WalrusSingleRecord | null) {
  if (!walrus) { check(!r.paymentStarted && r.storage === null && r.transaction === null, 'PAYMENT_RECOVERY_MISSING'); return }
  const w = parseWalrusSingleRecord(walrus)
  check(exact(w, ['schema', 'intent', 'encoding', 'uploaded', 'approved', 'register', 'certify', 'acknowledged'])
    && exact(w.intent, ['network', 'owner', 'recipient', 'operationScope', 'attachmentScope', 'contentHash', 'payloadHash', 'payloadByteLength', 'storageEpochs', 'relayUrl'])
    && (w.encoding === null || exact(w.encoding, ['blobId', 'rootHash', 'unencodedSize', 'nonce']))
    && (w.uploaded === null || exact(w.uploaded, ['blobId', 'blobObjectId', 'certificate']))
    && (w.approved === null || exact(w.approved, ['relayTip', 'storageCost', 'writeCost', 'gasBudget', 'quoteId']))
    && [w.register, w.certify].every(p => p === null || exact(p, ['bytes', 'digest', 'expirationEpoch', 'phase', 'signature'])),
  'PAYMENT_RECOVERY_FIELDS_INVALID')
  check(walrusSingleKey(w.intent) === privateBookmarkWalrusKey(r) && w.intent.owner === r.context.scope.owner && w.intent.recipient === r.context.scope.owner
    && w.intent.network === 'mainnet' && w.intent.attachmentScope === null && w.intent.contentHash === r.cipherSha256
    && w.intent.payloadHash === r.cipherSha256 && w.intent.payloadByteLength === r.ciphertext.length
    && w.intent.storageEpochs === r.uploadConfig.storageEpochs && w.intent.relayUrl === r.uploadConfig.relayUrl, 'PAYMENT_RECOVERY_MISMATCH')
  if (r.storage) check(w.register?.digest === r.storage.storageTxDigest && w.certify?.digest === r.storage.certifyTxDigest
    && w.register.phase === 'SUCCEEDED' && w.certify.phase === 'SUCCEEDED' && w.uploaded?.blobId === r.storage.reference.blobId
    && w.uploaded.blobObjectId === r.storage.reference.blobObjectId && w.approved?.quoteId === r.storage.quoteId,
  'PAYMENT_RECEIPT_MISMATCH')
}
export function exportPrivateBookmarkRecovery(input: PrivateBookmarkRecovery) {
  const record = parsePrivateBookmarkRecovery(input), walrus = readWalrusSingleRecord(privateBookmarkWalrusKey(record))
  validatePrivateBookmarkPaymentRecovery(record, walrus)
  return JSON.stringify({ schema: 'soulidity.private-bookmark-recovery-export.v1', record: { ...record, ciphertext: toBase64(record.ciphertext) }, walrus })
}
/** Import never overwrites an unknown local payment or private operation. If
 * IDB fails after the public WAL write, retrying the same bundle is idempotent. */
export function parsePrivateBookmarkRecoveryExport(encoded: string, expectedScope: PrivateBookmarkScope,
  expectedPackageId: string) {
  check(typeof encoded === 'string' && encoded.length > 0 && encoded.length <= 30 * 1024 * 1024, 'IMPORT_TOO_LARGE')
  const value = JSON.parse(encoded)
  check(exact(value, ['schema', 'record', 'walrus']) && value.schema === 'soulidity.private-bookmark-recovery-export.v1'
    && value.record && typeof value.record === 'object' && 'ciphertext' in value.record && typeof value.record.ciphertext === 'string', 'IMPORT_INVALID')
  const bytes = fromBase64(value.record.ciphertext)
  check(toBase64(bytes) === value.record.ciphertext, 'IMPORT_BYTES_INVALID')
  const record = parsePrivateBookmarkRecovery({ ...value.record, ciphertext: bytes })
  const key = privateBookmarkRecoveryKey(expectedScope, expectedPackageId); matchesKey(key, record)
  const walrus = value.walrus === null ? null : parseWalrusSingleRecord(value.walrus)
  validatePrivateBookmarkPaymentRecovery(record, walrus)
  return { record, walrus }
}
export async function importPrivateBookmarkRecovery(encoded: string, store: PrivateBookmarkRecoveryStore, expectedScope: PrivateBookmarkScope,
  expectedPackageId: string) {
  const { record, walrus } = parsePrivateBookmarkRecoveryExport(encoded, expectedScope, expectedPackageId)
  const key = privateBookmarkRecoveryKey(record.context.scope, record.context.originalPackageId)
  // A synchronous structural parse is not Seal validation. Before installing
  // either journal, bind the actual wrapped key to this scope/release/keyset.
  // This still does not authorize paying: the controller decrypts and rebuilds
  // the full mutation from the current private predecessor before new signing.
  await validatePrivateBookmarkEnvelope({ bytes: record.ciphertext, context: record.context, sealConfig: record.config.sealConfig })
  const imported = { ...record, sequence: 0 }
  check(record.status !== 'ARCHIVED', 'IMPORT_ARCHIVED_REBASE_REQUIRED')
  return store.exclusive(key, async () => {
    const current = await store.read(key)
    check(current === null || privateBookmarkRecoveryFingerprint(current) === privateBookmarkRecoveryFingerprint(imported), 'IMPORT_EXISTING_OPERATION')
    const walrusKey = privateBookmarkWalrusKey(record), local = readWalrusSingleRecord(walrusKey)
    check(local === null || walrus !== null && eq(local, walrus), 'IMPORT_EXISTING_PAYMENT')
    if (walrus && !local) writeWalrusSingleRecord(walrusKey, walrus)
    if (!current) await store.replace(key, null, imported)
    return (await store.read(key))!
  })
}
