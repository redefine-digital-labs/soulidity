import { toHex } from '@mysten/sui/utils'
import { sha256 } from '@noble/hashes/sha2.js'
import type { PrivateWalletBookmarksHeadSnapshot } from '@soulidity/sdk'
import { assertPrivateBookmarkHeadDocument, preparePrivateBookmarkMutation, bookmarkCanonical, bookmarkCheck as check, validatePrivateBookmarkLibrary,
  type PrivateBookmarkIntent, type PrivateBookmarkLibrary, type PrivateBookmarkScope } from './private-bookmark-library'
import { parsePrivateBookmarkRecovery, privateBookmarkRecoveryKey, privateBookmarkRecoveryFingerprint, privateBookmarkWalrusKey,
  type PrivateBookmarkRecovery, type PrivateBookmarkRecoveryStore, type PrivateBookmarkStorageReceipt } from './private-bookmark-recovery'
import { validatePrivateBookmarkPublicPlan, validatePrivateBookmarkTransactionPacket, type PrivateBookmarkPublicPlan,
  type PrivateBookmarkTransactionPacket, type createPrivateBookmarkTransactionAdapter } from './private-bookmark-transaction'
import { validateBrowserPrivateBookmarkConfig, type BrowserPrivateBookmarkConfig } from './browser-private-bookmarks'
import { validatePrivateBookmarkUploadConfig, type PrivateBookmarkUploadConfig } from './private-bookmark-storage'
import { readWalrusSingleRecord } from '../upload/walrus-single-operation'

type Snapshot = Readonly<PrivateWalletBookmarksHeadSnapshot>
export interface PrivateBookmarkControllerReaders {
  head(): Promise<Snapshot>
  unlock(): Promise<{ snapshot: Snapshot; library: PrivateBookmarkLibrary; endEpoch: number | null }>
  encrypt(library: PrivateBookmarkLibrary, verify: () => Promise<void>): Promise<Uint8Array>
  decryptRecovery(record: PrivateBookmarkRecovery): Promise<PrivateBookmarkLibrary>
}
export interface PrivateBookmarkControllerPayments {
  upload(record: PrivateBookmarkRecovery, verify: (signing: boolean) => Promise<void>): Promise<PrivateBookmarkStorageReceipt>
  recover(record: PrivateBookmarkRecovery): Promise<{ status: 'NONE' | 'SOURCE_REQUIRED' | 'UNKNOWN' | 'FAILED' } | {
    status: 'CERTIFIED'; receipt: PrivateBookmarkStorageReceipt
  }>
}
type Transactions = ReturnType<typeof createPrivateBookmarkTransactionAdapter>
export type PrivateBookmarkControllerResult = { status: 'STAGED' | 'PENDING' | 'FAILED' | 'SAVED' | 'ARCHIVED'; record: PrivateBookmarkRecovery; pendingTransaction?: boolean }
  | { status: 'UNCHANGED'; record: null }
const same = (a: unknown, b: unknown) => bookmarkCanonical(a) === bookmarkCanonical(b)
const headKey = (s: Snapshot) => bookmarkCanonical({ scope: s.scope, revision: s.revision, head: s.head, emptyReason: s.emptyReason })
const randomRequest = () => toHex(crypto.getRandomValues(new Uint8Array(32)))
const rejected = (e: unknown) => e instanceof Error && e.name === 'WalletStandardError'
  && (e as Error & { context?: { __code?: unknown } }).context?.__code === 4001000

/** One scope-local coordinator. Memory holds the unlocked library; IndexedDB
 * holds only ciphertext and public recovery. Every mutation is staged durably
 * before storage payment. No plaintext intent or bookmarked Soul ID enters the recovery journal. */
export function createPrivateBookmarkController(params: {
  scope: PrivateBookmarkScope; config: BrowserPrivateBookmarkConfig; uploadConfig: PrivateBookmarkUploadConfig
  store: PrivateBookmarkRecoveryStore; readers: PrivateBookmarkControllerReaders; payments: PrivateBookmarkControllerPayments
  transactions: Transactions; signal: AbortSignal; getAddress: () => string | null; writesEnabled: () => boolean
  confirmHead: (plan: PrivateBookmarkPublicPlan, packet: PrivateBookmarkTransactionPacket) => Promise<boolean>
  onRecord?: (record: PrivateBookmarkRecovery | null) => void
}) {
  const scope = structuredClone(params.scope), config = validateBrowserPrivateBookmarkConfig(params.config)
  const uploadConfig = validatePrivateBookmarkUploadConfig(params.uploadConfig), { store, readers, payments, transactions, signal,
    getAddress, writesEnabled, confirmHead, onRecord } = params
  const key = privateBookmarkRecoveryKey(scope, config.deployment.originalPackageId)
  let unlocked: { snapshot: Snapshot; library: PrivateBookmarkLibrary; endEpoch: number | null } | null = null
  let readGeneration = 0
  let lockGeneration = 0
  let operation: { generation: number } | null = null
  // Keep at most the current operation's private document, never a durable
  // plaintext cache. It can become visible only after its exact head is proven.
  const authorizedDocuments = new Map<string, PrivateBookmarkLibrary>()
  const documentKey = (r: PrivateBookmarkRecovery) => bookmarkCanonical({ context: r.context, cipherSha256: r.cipherSha256 })
  const live = () => {
    signal.throwIfAborted(); check(getAddress() === scope.owner, 'WALLET_CHANGED')
    check(operation === null || operation.generation === lockGeneration, 'READ_SUPERSEDED')
  }
  async function exclusive<T>(work: () => Promise<T>): Promise<T> {
    const owned = { generation: lockGeneration }
    return store.exclusive(key, async () => {
      check(operation === null && owned.generation === lockGeneration, 'READ_SUPERSEDED')
      operation = owned
      try { return await work() } finally { if (operation === owned) operation = null }
    })
  }
  const writable = () => { live(); check(config.writesEnabled === true && writesEnabled(), 'WRITES_DISABLED') }
  const head = async () => { live(); const value = await readers.head(); live(); check(same(value.scope, scope), 'SCOPE_CHANGED'); return value }
  function recordScope(record: PrivateBookmarkRecovery) {
    // A permission change must stop new writes, not erase access to the same
    // historical transaction. All release/read/storage identities remain exact.
    const readIdentity = (value: BrowserPrivateBookmarkConfig) => ({ ...value, writesEnabled: false })
    check(same(record.context.scope, scope) && same(readIdentity(record.config), readIdentity(config)) && same(record.uploadConfig, uploadConfig), 'RECOVERY_CONFIGURATION_CHANGED')
  }
  async function save(before: PrivateBookmarkRecovery | null, after: PrivateBookmarkRecovery) {
    const record = parsePrivateBookmarkRecovery({ ...after, sequence: before ? before.sequence + 1 : 0 })
    recordScope(record); await store.replace(key, before, record)
    const persisted = await store.read(key)
    check(persisted && privateBookmarkRecoveryFingerprint(persisted) === privateBookmarkRecoveryFingerprint(record), 'RECOVERY_READBACK_FAILED')
    // Historical reconciliation may finish after a wallet switch. Keep its
    // public evidence, but never notify the replacement wallet's UI.
    if (!signal.aborted && getAddress() === scope.owner && (operation === null || operation.generation === lockGeneration))
      onRecord?.(structuredClone(persisted))
    return persisted
  }
  function planFor(record: PrivateBookmarkRecovery) {
    check(record.storage, 'STORAGE_NOT_CERTIFIED')
    return validatePrivateBookmarkPublicPlan({ deployment: config.deployment, scope,
      expectedRevision: String(BigInt(record.context.revision) - 1n), requestId: record.context.requestId,
      ciphertext: record.storage.reference })
  }
  function matchesReceipt(snapshot: Snapshot, record: PrivateBookmarkRecovery) {
    const receipt = snapshot.head?.receipts.find(row => row.requestId === record.context.requestId)
    if (!receipt) return false
    check(record.storage && receipt.revision === record.context.revision && same(receipt.ciphertext, record.storage.reference), 'REQUEST_CONFLICT')
    return true
  }
  /** Receipt lookup precedes writes; stale UI state never authorizes payment. */
  async function preflight(plan: PrivateBookmarkPublicPlan, _signing: boolean) {
    writable()
    const checked = validatePrivateBookmarkPublicPlan(plan)
    check(same(checked.scope, scope) && checked.deployment.originalPackageId === config.deployment.originalPackageId
      && checked.deployment.callablePackageId === config.deployment.callablePackageId, 'TRANSACTION_SCOPE_CHANGED')
    const current = await head()
    check(!current.head?.receipts.some(row => row.requestId === checked.requestId), 'ALREADY_COMMITTED_QUERY_ONLY')
    check(current.revision === checked.expectedRevision, 'REVISION_CONFLICT')
    const record = await inspect()
    check(record?.storage && same(planFor(record), checked), 'HEAD_RECOVERY_MISMATCH')
    if (_signing) await authorizeRecord(record)
    // Imported/cached certification is not a current storage proof. Query the
    // original paid packets and exact live Blob again, including after approval.
    const payment = await payments.recover(structuredClone(record))
    check(payment.status === 'CERTIFIED' && same(payment.receipt, record.storage), 'STORAGE_NOT_CURRENTLY_CERTIFIED')
    writable()
  }
  async function verifyStaged(record: PrivateBookmarkRecovery) {
    writable(); recordScope(record)
    const current = await head()
    check(BigInt(current.revision) + 1n === BigInt(record.context.revision), 'REVISION_CONFLICT')
    writable()
  }
  async function authorizeRecord(record: PrivateBookmarkRecovery) {
    if (authorizedDocuments.has(documentKey(record))) return
    await verifyStaged(record)
    // Recovery files contain untrusted public metadata, not proof that their
    // ciphertext can be read. Explicit resume unlocks before any new payment or
    // head signature. Historical query and exact signed replay do not need Seal.
    const library = validatePrivateBookmarkLibrary(await readers.decryptRecovery(structuredClone(record)), scope, record.context.revision)
    live()
    check(library.intent?.requestId === record.context.requestId, 'RECOVERY_DOCUMENT_MISMATCH')
    const current = await head()
    check(BigInt(current.revision) + 1n === BigInt(library.revision), 'REVISION_CONFLICT')
    const previous = (current.head?.receipts ?? []).slice(-31).map(row => ({ requestId: row.requestId, revision: row.revision }))
    check(same(library.receipts.slice(0, -1).map(row => ({ requestId: row.requestId, revision: row.result.revision })), previous),
      'RECOVERY_RECEIPTS_MISMATCH')
    // Seal encryption is public-key encryption: a valid envelope is not proof
    // that the imported intent describes every change inside it. Recompute the
    // complete mutation from the actual current private document before paying.
    if (!unlocked || headKey(unlocked.snapshot) !== headKey(current)) await unlock()
    check(unlocked && headKey(unlocked.snapshot) === headKey(current), 'REVISION_CONFLICT')
    const expected = preparePrivateBookmarkMutation(unlocked.library, library.intent)
    check(!expected.replay && !expected.unchanged && same(expected.library, library), 'RECOVERY_MUTATION_MISMATCH')
    live(); authorizedDocuments.clear(); authorizedDocuments.set(documentKey(record), structuredClone(library))
  }
  async function stage(intent: PrivateBookmarkIntent, before: PrivateBookmarkRecovery | null = null) {
    writable(); check(unlocked, 'UNLOCK_REQUIRED')
    const generation = readGeneration
    const expectedHead = headKey(unlocked.snapshot)
    check(headKey(await head()) === expectedHead, 'REVISION_CONFLICT')
    const prepared = preparePrivateBookmarkMutation(unlocked.library, intent)
    check(!prepared.replay && !prepared.unchanged, 'ALREADY_COMMITTED_QUERY_ONLY')
    const verify = async () => {
      check(generation === readGeneration, 'READ_SUPERSEDED')
      writable(); check(headKey(await head()) === expectedHead, 'REVISION_CONFLICT')
      writable()
    }
    const ciphertext = await readers.encrypt(prepared.library, verify)
    await verify()
    const record: PrivateBookmarkRecovery = { schema: 'soulidity.private-bookmark-recovery.v1', sequence: 0, status: 'ACTIVE', paymentStarted: false,
      config, uploadConfig, context: { scope, revision: prepared.library.revision, requestId: intent.requestId,
        originalPackageId: config.deployment.originalPackageId, chainIdentifier: config.deployment.chainIdentifier },
      ciphertext: new Uint8Array(ciphertext), cipherSha256: toHex(sha256(ciphertext)), storage: null, transaction: null }
    // Rebase preserves the paid predecessor before installing a new ciphertext.
    // If install fails, the full predecessor remains retrievable in the archive.
    if (before) await archiveRecord(before)
    const persisted = await save(null, record)
    writable()
    authorizedDocuments.clear(); authorizedDocuments.set(documentKey(persisted), structuredClone(prepared.library))
    return persisted
  }
  async function queryPacket(record: PrivateBookmarkRecovery) {
    if (!record.transaction || record.transaction.packet.phase === 'CANCELLED') return { record, status: null }
    const { plan, packet } = record.transaction, status = await transactions.query(plan, packet)
    check(!['SUCCEEDED', 'FAILED'].includes(packet.phase) || status === packet.phase, 'TRANSACTION_RESULT_UNCONFIRMED')
    if (status === 'SUCCEEDED' || status === 'FAILED') record = await save(record, { ...record,
      status: status === 'SUCCEEDED' ? 'COMPLETE' : 'ACTIVE', transaction: { plan, packet: { ...packet, phase: status } } })
    else check(!['SUCCEEDED', 'FAILED'].includes(packet.phase), 'TRANSACTION_RESULT_UNCONFIRMED')
    return { record, status }
  }
  async function saved(record: PrivateBookmarkRecovery): Promise<Exclude<PrivateBookmarkControllerResult, { status: 'UNCHANGED' }>> {
    const generation = ++readGeneration
    unlocked = null
    const library = authorizedDocuments.get(documentKey(record))
    if (library) {
      // Historical success alone cannot replace a newer library. Reuse the
      // already-authorized in-memory document only if it is still the exact
      // current head. No second personal signature is needed for our own save.
      try {
        const current = await head()
        if (current.revision === record.context.revision && matchesReceipt(current, record)
          && same(current.head!.ciphertext, record.storage!.reference)) {
          assertPrivateBookmarkHeadDocument(library, current.head); live()
          if (generation === readGeneration) unlocked = { snapshot: current, library: structuredClone(library), endEpoch: null }
        }
      } catch {
        // The confirmed transaction remains saved even when a later current
        // read fails. Null means locked/unavailable, never an empty library.
        if (generation === readGeneration) unlocked = null
      }
    }
    return { status: 'SAVED', record }
  }
  async function continueRecord(input: PrivateBookmarkRecovery, queryOnly: boolean): Promise<Exclude<PrivateBookmarkControllerResult, { status: 'UNCHANGED' }>> {
    let record = parsePrivateBookmarkRecovery(input); recordScope(record)
    // Exact historical query precedes current wallet/head checks, including
    // after receipt-window eviction or later changes from another device.
    const queried = await queryPacket(record); record = queried.record
    if (queried.status === 'SUCCEEDED') return saved(record)
    if (queried.status === 'FAILED') return { status: 'FAILED', record }
    if (queried.status === 'PENDING') return { status: 'PENDING', record, pendingTransaction: true }
    live()
    if (!record.transaction && record.storage && matchesReceipt(await head(), record)) {
      record = await save(record, { ...record, status: 'COMPLETE' })
      return saved(record)
    }
    // A previously signed registration is not replaced if its independent WAL
    // was deleted. The caller can restore the encrypted export plus paid packet.
    check(!record.paymentStarted || readWalrusSingleRecord(privateBookmarkWalrusKey(record)), 'PAYMENT_RECOVERY_MISSING')
    if (!queryOnly && record.transaction?.packet.phase !== 'SIGNED') await authorizeRecord(record)
    if (!record.storage) {
      const recovery = await payments.recover(structuredClone(record))
      if (recovery.status === 'CERTIFIED') record = await save(record, { ...record, paymentStarted: true, storage: recovery.receipt })
      else if (recovery.status === 'FAILED') return { status: 'FAILED', record }
      else if (queryOnly) return { status: 'PENDING', record }
      if (!record.storage) {
        await verifyStaged(record)
        const receipt = await payments.upload(structuredClone(record), async signing => {
          await verifyStaged(record)
          // The shared paid engine has persisted its exact SIGNING packet now.
          // Mark that fact in IDB before handing control to the wallet.
          if (signing) {
            const walrus = readWalrusSingleRecord(privateBookmarkWalrusKey(record))
            check(walrus && [walrus.register, walrus.certify].some(packet => packet?.phase === 'SIGNING'), 'PAYMENT_JOURNAL_NOT_DURABLE')
            if (!record.paymentStarted) record = await save(record, { ...record, paymentStarted: true })
          }
        })
        record = await save(record, { ...record, paymentStarted: true, storage: receipt })
      }
    }
    if (!record.transaction && matchesReceipt(await head(), record)) {
      record = await save(record, { ...record, status: 'COMPLETE' })
      return saved(record)
    }
    if (queryOnly) return { status: 'PENDING', record }
    writable()
    if (!record.transaction) {
      const plan = planFor(record), packet = await transactions.prepare(plan)
      record = await save(record, { ...record, transaction: { plan, packet } })
    }
    let { plan, packet } = record.transaction!
    check(packet.phase !== 'CANCELLED', 'TRANSACTION_CANCELLED_REBASE_REQUIRED')
    if (packet.phase === 'PREPARED' || packet.phase === 'SIGNING') {
      check(await confirmHead(structuredClone(plan), structuredClone(packet)), 'HEAD_APPROVAL_CANCELLED')
      writable(); await preflight(plan, true)
      const wasUnsigned = packet.phase === 'PREPARED'
      packet = { ...packet, phase: 'SIGNING' }
      record = await save(record, { ...record, transaction: { plan, packet } })
      let signed
      try { signed = await transactions.sign(plan, packet) }
      catch (error) {
        if (wasUnsigned && rejected(error)) await save(record, { ...record, transaction: { plan, packet: { ...packet, phase: 'PREPARED' } } })
        throw error
      }
      check(signed.bytes === packet.bytes, 'WALLET_CHANGED_BYTES')
      packet = validatePrivateBookmarkTransactionPacket(plan, { ...packet, phase: 'SIGNED', signature: signed.signature })
      await transactions.verifySignature(plan, packet)
      record = await save(record, { ...record, transaction: { plan, packet } })
    }
    // Signed bytes are durable before any broadcast. Unknown execution exits
    // with that record intact; the next run starts from queryPacket above.
    await transactions.broadcast(plan, packet)
    const final = await queryPacket(record); record = final.record
    if (final.status === 'SUCCEEDED') return saved(record)
    return { status: final.status === 'FAILED' ? 'FAILED' : 'PENDING', record }
  }
  async function inspect() {
    const record = await store.read(key); if (record) recordScope(record)
    return record
  }
  async function unlock() {
    live(); const generation = ++readGeneration, next = await readers.unlock(); live()
    check(generation === readGeneration, 'READ_SUPERSEDED')
    check(same(next.snapshot.scope, scope), 'OWNER_EPOCH_CHANGED')
    const library = validatePrivateBookmarkLibrary(next.library, scope, next.snapshot.revision)
    assertPrivateBookmarkHeadDocument(library, next.snapshot.head)
    unlocked = { ...next, library }
    return structuredClone(unlocked)
  }
  async function start(action: 'renew' | 'set', soulId?: string, bookmarked?: boolean) {
    return exclusive(async () => {
      writable(); check(await inspect() === null, 'PENDING_RECOVERY_REQUIRED')
      check(unlocked, 'UNLOCK_REQUIRED')
      const base = { requestId: randomRequest(), expectedRevision: unlocked.library.revision, scope, at: new Date().toISOString() }
      const intent: PrivateBookmarkIntent = action === 'renew' ? { ...base, action }
        : { ...base, action, soulId: soulId!, bookmarked: bookmarked! }
      const prepared = preparePrivateBookmarkMutation(unlocked.library, intent)
      if (prepared.unchanged) {
        check(headKey(await head()) === headKey(unlocked.snapshot), 'REVISION_CONFLICT')
        return { status: 'UNCHANGED' as const, record: null }
      }
      const record = await stage(intent)
      return continueRecord(record, false)
    })
  }
  async function resume(queryOnly = false) {
    return exclusive(async () => {
      const record = await inspect(); check(record, 'RECOVERY_NOT_FOUND')
      return continueRecord(record, queryOnly)
    })
  }
  async function archive() {
    return exclusive(async () => {
      let record = await inspect(); check(record, 'RECOVERY_NOT_FOUND')
      const result = await continueRecord(record, true); record = result.record
      check(!result.pendingTransaction, 'QUERY_SIGNED_TRANSACTION_FIRST')
      // Unknown or signed attempts are never dismissed merely to unblock UI.
      if (record.transaction && !['SUCCEEDED', 'FAILED', 'CANCELLED', 'PREPARED'].includes(record.transaction.packet.phase))
        throw new Error('PRIVATE_BOOKMARK_QUERY_SIGNED_TRANSACTION_FIRST')
      await assertPaymentSettled(record)
      await archiveRecord(record)
      return { status: 'ARCHIVED' as const, record }
    })
  }
  async function rebase() {
    return exclusive(async () => {
      writable(); let record = await inspect(); check(record, 'RECOVERY_NOT_FOUND')
      const result = await continueRecord(record, true); record = result.record
      check(!result.pendingTransaction, 'QUERY_SIGNED_TRANSACTION_FIRST')
      check(result.status !== 'SAVED', 'ALREADY_COMMITTED_ARCHIVE_FIRST')
      check(!record.transaction || ['FAILED', 'CANCELLED', 'PREPARED'].includes(record.transaction.packet.phase), 'QUERY_SIGNED_TRANSACTION_FIRST')
      await assertPaymentSettled(record)
      const old = await readers.decryptRecovery(record); live(); check(old.intent, 'RECOVERY_INTENT_MISSING')
      await unlock()
      const intent = { ...old.intent, requestId: randomRequest(), expectedRevision: unlocked!.library.revision, at: new Date().toISOString() }
      if (preparePrivateBookmarkMutation(unlocked!.library, intent).unchanged) {
        check(headKey(await head()) === headKey(unlocked!.snapshot), 'REVISION_CONFLICT')
        await archiveRecord(record)
        return { status: 'UNCHANGED' as const, record: null }
      }
      const next = await stage(intent, record)
      return continueRecord(next, false)
    })
  }
  /** Expired Walrus storage is not empty. Only exact current-head cached/exported
   * ciphertext can seed a renewal; old revisions never replace the live library. */
  async function unlockBackup(input: PrivateBookmarkRecovery) {
    live(); const generation = ++readGeneration, record = parsePrivateBookmarkRecovery(input); recordScope(record)
    const current = await head()
    check(record.storage && current.head && current.revision === record.context.revision
      && same(current.head.ciphertext, record.storage.reference), 'BACKUP_NOT_CURRENT')
    const library = await readers.decryptRecovery(record); live()
    check(generation === readGeneration, 'READ_SUPERSEDED')
    check(headKey(await head()) === headKey(current), 'REVISION_CONFLICT')
    assertPrivateBookmarkHeadDocument(library, current.head)
    unlocked = { snapshot: current, library: validatePrivateBookmarkLibrary(library, scope, current.revision), endEpoch: null }
    return structuredClone(unlocked)
  }
  async function assertPaymentSettled(record: PrivateBookmarkRecovery) {
    if (record.storage) return
    const key = privateBookmarkWalrusKey(record)
    if (!readWalrusSingleRecord(key)) { check(!record.paymentStarted, 'PAYMENT_RECOVERY_MISSING'); return }
    const payment = await payments.recover(record)
    if (payment.status === 'CERTIFIED' || payment.status === 'FAILED') return
    // An unsigned packet or a certified registration with no signed certify
    // attempt can be archived. Preserve the WAL; never dismiss an unknown signature.
    const walrus = readWalrusSingleRecord(key)
    check(payment.status === 'SOURCE_REQUIRED' && walrus && [walrus.register, walrus.certify].every(packet => !packet
      || ['PREPARED', 'SUCCEEDED', 'FAILED'].includes(packet.phase)), 'QUERY_PAYMENT_FIRST')
  }
  async function archiveRecord(record: PrivateBookmarkRecovery) {
    await store.archive(key, record)
    const archived = await store.archived(key, record.context.requestId)
    check(await store.read(key) === null && archived && privateBookmarkRecoveryFingerprint(archived)
      === privateBookmarkRecoveryFingerprint({ ...record, sequence: record.sequence + 1, status: 'ARCHIVED' }), 'RECOVERY_ARCHIVE_READBACK_FAILED')
    if (!signal.aborted && getAddress() === scope.owner && (operation === null || operation.generation === lockGeneration)) onRecord?.(null)
  }
  return { key, inspect, unlock, unlockBackup, start, resume, archive, rebase, preflight,
    readUnlocked: () => { live(); return structuredClone(unlocked) },
    view: (id: string) => { live(); check(unlocked, 'UNLOCK_REQUIRED'); return structuredClone(unlocked.library.entries.find(e => e.soulId === id) ?? null) },
    lock: () => { lockGeneration++; readGeneration++; unlocked = null; authorizedDocuments.clear() } }
}
