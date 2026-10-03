import { toHex } from '@mysten/sui/utils'
import { sha256 } from '@noble/hashes/sha2.js'
import type { PrivateNamedLoadoutHeadSnapshot } from '@soulidity/sdk'
import { normalizeNamedLoadoutName, type NamedLoadoutContent } from './named-loadout'
import { assertPrivateLoadoutHeadDocument, preparePrivateLoadoutMutation, privateLoadoutCanonical, privateLoadoutCheck as check, validatePrivateLoadoutLibrary,
  type PrivateLoadoutCapture, type PrivateLoadoutIntent, type PrivateLoadoutLibrary, type PrivateLoadoutScope } from './private-loadout-library'
import { parsePrivateLoadoutRecovery, privateLoadoutRecoveryKey, privateLoadoutWalrusKey,
  type PrivateLoadoutRecovery, type PrivateLoadoutRecoveryStore, type PrivateLoadoutStorageReceipt } from './private-loadout-recovery'
import { validatePrivateLoadoutPublicPlan, validatePrivateLoadoutTransactionPacket, type PrivateLoadoutPublicPlan,
  type PrivateLoadoutTransactionPacket, type createPrivateLoadoutTransactionAdapter } from './private-loadout-transaction'
import { validateBrowserPrivateLoadoutConfig, type BrowserPrivateLoadoutConfig } from './browser-private-loadout'
import { validatePrivateLoadoutUploadConfig, type PrivateLoadoutUploadConfig } from './private-loadout-storage'
import { readWalrusSingleRecord } from '../upload/walrus-single-operation'

type Snapshot = Readonly<PrivateNamedLoadoutHeadSnapshot>
export interface PrivateLoadoutControllerReaders {
  head(): Promise<Snapshot>
  unlock(): Promise<{ snapshot: Snapshot; library: PrivateLoadoutLibrary; endEpoch: number | null }>
  capture(): Promise<{ content: NamedLoadoutContent; capture: PrivateLoadoutCapture }>
  verifyCapture(capture: PrivateLoadoutCapture): Promise<void>
  encrypt(library: PrivateLoadoutLibrary, verifyCapture: () => Promise<void>): Promise<Uint8Array>
  decryptRecovery(record: PrivateLoadoutRecovery): Promise<PrivateLoadoutLibrary>
}
export interface PrivateLoadoutControllerPayments {
  upload(record: PrivateLoadoutRecovery, verify: (signing: boolean) => Promise<void>): Promise<PrivateLoadoutStorageReceipt>
  recover(record: PrivateLoadoutRecovery): Promise<{ status: 'NONE' | 'SOURCE_REQUIRED' | 'UNKNOWN' | 'FAILED' } | {
    status: 'CERTIFIED'; receipt: PrivateLoadoutStorageReceipt
  }>
}
type Transactions = ReturnType<typeof createPrivateLoadoutTransactionAdapter>
export type PrivateLoadoutControllerResult = { status: 'STAGED' | 'PENDING' | 'FAILED' | 'SAVED' | 'ARCHIVED'; record: PrivateLoadoutRecovery; pendingTransaction?: boolean }
const same = (a: unknown, b: unknown) => privateLoadoutCanonical(a) === privateLoadoutCanonical(b)
const headKey = (s: Snapshot) => privateLoadoutCanonical({ scope: s.scope, revision: s.revision, head: s.head, emptyReason: s.emptyReason })
const randomRequest = () => toHex(crypto.getRandomValues(new Uint8Array(32)))
const rejected = (e: unknown) => e instanceof Error && e.name === 'WalletStandardError'
  && (e as Error & { context?: { __code?: unknown } }).context?.__code === 4001000

/** One scope-local coordinator. Memory holds the unlocked library; IndexedDB
 * holds only ciphertext and public recovery. Every mutation is staged durably
 * before storage payment. The existing equipment Apply WAL remains separate. */
export function createPrivateLoadoutController(params: {
  scope: PrivateLoadoutScope; config: BrowserPrivateLoadoutConfig; uploadConfig: PrivateLoadoutUploadConfig | null
  store: PrivateLoadoutRecoveryStore; readers: PrivateLoadoutControllerReaders; payments: PrivateLoadoutControllerPayments
  transactions: Transactions; signal: AbortSignal; getAddress: () => string | null; writesEnabled: () => boolean
  confirmHead: (plan: PrivateLoadoutPublicPlan, packet: PrivateLoadoutTransactionPacket) => Promise<boolean>
  onRecord?: (record: PrivateLoadoutRecovery | null) => void
}) {
  const scope = structuredClone(params.scope), config = validateBrowserPrivateLoadoutConfig(params.config)
  const uploadConfig = params.uploadConfig === null ? null : validatePrivateLoadoutUploadConfig(params.uploadConfig), { store, readers, payments, transactions, signal,
    getAddress, writesEnabled, confirmHead, onRecord } = params
  const key = privateLoadoutRecoveryKey(scope, config.target.soulidityOriginalPackageId)
  let unlocked: { snapshot: Snapshot; library: PrivateLoadoutLibrary; endEpoch: number | null } | null = null
  let readGeneration = 0
  const authorizedCiphertexts = new Set<string>()
  const documentKey = (r: PrivateLoadoutRecovery) => privateLoadoutCanonical({ context: r.context, capture: r.capture, cipherSha256: r.cipherSha256 })
  const live = () => { signal.throwIfAborted(); check(getAddress() === scope.owner, 'PRIVATE_LOADOUT_WALLET_CHANGED') }
  const writable = () => { live(); check(uploadConfig && config.target.equipmentWritesEnabled === true && writesEnabled(), 'PRIVATE_LOADOUT_WRITES_DISABLED') }
  const head = async () => { live(); const value = await readers.head(); live(); check(same(value.scope, scope), 'PRIVATE_LOADOUT_OWNER_EPOCH_CHANGED'); return value }
  function recordScope(record: PrivateLoadoutRecovery) {
    // A permission change must stop new writes, not erase access to the same
    // historical transaction. Read identity stays exact. Without a current upload
    // config, only read/query is enabled and recovery keeps its validated stored
    // upload config; a different supplied upload config still rejects recovery.
    const readIdentity = (value: BrowserPrivateLoadoutConfig) => ({ ...value, target: { ...value.target, equipmentWritesEnabled: false } })
    check(same(record.context.scope, scope) && same(readIdentity(record.config), readIdentity(config))
      && (uploadConfig === null || same(record.uploadConfig, uploadConfig)), 'PRIVATE_LOADOUT_RECOVERY_CONFIGURATION_CHANGED')
  }
  async function save(before: PrivateLoadoutRecovery | null, after: PrivateLoadoutRecovery) {
    const record = parsePrivateLoadoutRecovery({ ...after, sequence: before ? before.sequence + 1 : 0 })
    recordScope(record); await store.replace(key, before, record)
    onRecord?.(structuredClone(record)); return record
  }
  function planFor(record: PrivateLoadoutRecovery) {
    check(record.storage, 'PRIVATE_LOADOUT_STORAGE_NOT_CERTIFIED')
    return validatePrivateLoadoutPublicPlan({ deployment: { originalPackageId: config.target.soulidityOriginalPackageId,
      callablePackageId: config.target.soulidityCallablePackageId, chainIdentifier: '35834a8a' }, scope,
      expectedRevision: String(BigInt(record.context.revision) - 1n), requestId: record.context.requestId,
      ciphertext: record.storage.reference, capture: record.capture, protocolId: config.target.protocolConfigId })
  }
  function matchesReceipt(snapshot: Snapshot, record: PrivateLoadoutRecovery) {
    const receipt = snapshot.head?.receipts.find(row => row.requestId === record.context.requestId)
    if (!receipt) return false
    check(record.storage && receipt.revision === record.context.revision && same(receipt.ciphertext, record.storage.reference)
      && same(receipt.capture, record.capture), 'PRIVATE_LOADOUT_REQUEST_CONFLICT')
    return true
  }
  /** Receipt lookup before capture is performed by continueRecord. New writes
   * never rely on a stale UI's owner, private plaintext or old equipment stamp. */
  async function preflight(plan: PrivateLoadoutPublicPlan, _signing: boolean) {
    writable()
    const checked = validatePrivateLoadoutPublicPlan(plan)
    check(same(checked.scope, scope) && checked.deployment.originalPackageId === config.target.soulidityOriginalPackageId
      && checked.deployment.callablePackageId === config.target.soulidityCallablePackageId
      && checked.protocolId === config.target.protocolConfigId, 'PRIVATE_LOADOUT_TRANSACTION_SCOPE_CHANGED')
    const current = await head()
    check(!current.head?.receipts.some(row => row.requestId === checked.requestId), 'PRIVATE_LOADOUT_ALREADY_COMMITTED_QUERY_ONLY')
    check(current.revision === checked.expectedRevision, 'PRIVATE_LOADOUT_REVISION_CONFLICT')
    if (checked.capture) await readers.verifyCapture(structuredClone(checked.capture))
    const record = await inspect()
    check(record?.storage && same(planFor(record), checked), 'PRIVATE_LOADOUT_HEAD_RECOVERY_MISMATCH')
    // Imported/cached certification is not a current storage proof. Query the
    // original paid packets and exact live Blob again, including after approval.
    const payment = await payments.recover(structuredClone(record))
    check(payment.status === 'CERTIFIED' && same(payment.receipt, record.storage), 'PRIVATE_LOADOUT_STORAGE_NOT_CURRENTLY_CERTIFIED')
    writable()
  }
  async function verifyStaged(record: PrivateLoadoutRecovery) {
    writable(); recordScope(record)
    const current = await head()
    check(BigInt(current.revision) + 1n === BigInt(record.context.revision), 'PRIVATE_LOADOUT_REVISION_CONFLICT')
    if (record.capture) await readers.verifyCapture(structuredClone(record.capture))
    writable()
  }
  async function authorizeRecord(record: PrivateLoadoutRecovery) {
    if (authorizedCiphertexts.has(documentKey(record))) return
    await verifyStaged(record)
    // Recovery files contain untrusted public metadata, not proof that their
    // ciphertext can be read. Explicit resume unlocks before any new payment or
    // head signature. Historical query and exact signed replay do not need Seal.
    const library = validatePrivateLoadoutLibrary(await readers.decryptRecovery(structuredClone(record)), scope, record.context.revision)
    live()
    check(library.intent?.requestId === record.context.requestId && same(record.capture,
      library.intent.action === 'save' ? library.intent.capture : null), 'PRIVATE_LOADOUT_RECOVERY_DOCUMENT_MISMATCH')
    const current = await head()
    check(BigInt(current.revision) + 1n === BigInt(library.revision), 'PRIVATE_LOADOUT_REVISION_CONFLICT')
    const previous = (current.head?.receipts ?? []).slice(-31).map(row => ({ requestId: row.requestId, revision: row.revision }))
    check(same(library.receipts.slice(0, -1).map(row => ({ requestId: row.requestId, revision: row.result.revision })), previous),
      'PRIVATE_LOADOUT_RECOVERY_RECEIPTS_MISMATCH')
    // Seal encryption is public-key encryption: a valid envelope is not proof
    // that the imported intent describes every change inside it. Recompute the
    // complete mutation from the actual current private document before paying.
    if (!unlocked || headKey(unlocked.snapshot) !== headKey(current)) await unlock()
    check(unlocked && headKey(unlocked.snapshot) === headKey(current), 'PRIVATE_LOADOUT_REVISION_CONFLICT')
    const expected = preparePrivateLoadoutMutation(unlocked.library, library.intent)
    check(!expected.replay && same(expected.library, library), 'PRIVATE_LOADOUT_RECOVERY_MUTATION_MISMATCH')
    authorizedCiphertexts.add(documentKey(record))
  }
  async function stage(intent: PrivateLoadoutIntent, before: PrivateLoadoutRecovery | null = null) {
    writable(); check(uploadConfig, 'PRIVATE_LOADOUT_WRITES_DISABLED'); check(unlocked, 'PRIVATE_LOADOUT_UNLOCK_REQUIRED')
    const expectedHead = headKey(unlocked.snapshot)
    check(headKey(await head()) === expectedHead, 'PRIVATE_LOADOUT_REVISION_CONFLICT')
    const prepared = preparePrivateLoadoutMutation(unlocked.library, intent)
    check(!prepared.replay, 'PRIVATE_LOADOUT_ALREADY_COMMITTED_QUERY_ONLY')
    const verify = async () => {
      writable(); check(headKey(await head()) === expectedHead, 'PRIVATE_LOADOUT_REVISION_CONFLICT')
      if (intent.action === 'save') await readers.verifyCapture(structuredClone(intent.capture))
      writable()
    }
    const ciphertext = await readers.encrypt(prepared.library, verify)
    await verify()
    const record: PrivateLoadoutRecovery = { schema: 'soulidity.private-loadout-recovery.v1', sequence: 0, status: 'ACTIVE', paymentStarted: false,
      config, uploadConfig, context: { scope, revision: prepared.library.revision, requestId: intent.requestId,
        originalPackageId: config.target.soulidityOriginalPackageId }, capture: intent.action === 'save' ? intent.capture : null,
      ciphertext: new Uint8Array(ciphertext), cipherSha256: toHex(sha256(ciphertext)), storage: null, transaction: null }
    // Rebase preserves the paid predecessor before installing a new ciphertext.
    // If install fails, the full predecessor remains retrievable in the archive.
    if (before) await store.archive(key, before)
    const persisted = await save(null, record)
    authorizedCiphertexts.add(documentKey(persisted))
    return persisted
  }
  async function queryPacket(record: PrivateLoadoutRecovery) {
    if (!record.transaction || record.transaction.packet.phase === 'CANCELLED') return { record, status: null }
    const { plan, packet } = record.transaction, status = await transactions.query(plan, packet)
    if (status === 'SUCCEEDED' || status === 'FAILED') record = await save(record, { ...record,
      status: status === 'SUCCEEDED' ? 'COMPLETE' : 'ACTIVE', transaction: { plan, packet: { ...packet, phase: status } } })
    else check(!['SUCCEEDED', 'FAILED'].includes(packet.phase), 'PRIVATE_LOADOUT_TRANSACTION_RESULT_UNCONFIRMED')
    return { record, status }
  }
  async function continueRecord(input: PrivateLoadoutRecovery, queryOnly: boolean): Promise<PrivateLoadoutControllerResult> {
    let record = parsePrivateLoadoutRecovery(input); recordScope(record)
    // Exact historical query precedes current owner/head/capture, including
    // after receipt-window eviction or later ownership/equipment changes.
    const queried = await queryPacket(record); record = queried.record
    if (queried.status === 'SUCCEEDED') { unlocked = null; return { status: 'SAVED', record } }
    if (queried.status === 'FAILED') return { status: 'FAILED', record }
    if (queried.status === 'PENDING') return { status: 'PENDING', record, pendingTransaction: true }
    live()
    if (!record.transaction && record.storage && matchesReceipt(await head(), record)) {
      record = await save(record, { ...record, status: 'COMPLETE' }); unlocked = null
      return { status: 'SAVED', record }
    }
    // A previously signed registration is not replaced if its independent WAL
    // was deleted. The caller can restore the encrypted export plus paid packet.
    check(!record.paymentStarted || readWalrusSingleRecord(privateLoadoutWalrusKey(record)), 'PRIVATE_LOADOUT_PAYMENT_RECOVERY_MISSING')
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
            const walrus = readWalrusSingleRecord(privateLoadoutWalrusKey(record))
            check(walrus && [walrus.register, walrus.certify].some(packet => packet?.phase === 'SIGNING'), 'PRIVATE_LOADOUT_PAYMENT_JOURNAL_NOT_DURABLE')
            if (!record.paymentStarted) record = await save(record, { ...record, paymentStarted: true })
          }
        })
        record = await save(record, { ...record, paymentStarted: true, storage: receipt })
      }
    }
    if (!record.transaction && matchesReceipt(await head(), record)) {
      record = await save(record, { ...record, status: 'COMPLETE' }); unlocked = null
      return { status: 'SAVED', record }
    }
    if (queryOnly) return { status: 'PENDING', record }
    writable()
    if (!record.transaction) {
      const plan = planFor(record), packet = await transactions.prepare(plan)
      record = await save(record, { ...record, transaction: { plan, packet } })
    }
    let { plan, packet } = record.transaction!
    check(packet.phase !== 'CANCELLED', 'PRIVATE_LOADOUT_TRANSACTION_CANCELLED_REBASE_REQUIRED')
    if (packet.phase === 'PREPARED' || packet.phase === 'SIGNING') {
      check(await confirmHead(structuredClone(plan), structuredClone(packet)), 'PRIVATE_LOADOUT_HEAD_APPROVAL_CANCELLED')
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
      check(signed.bytes === packet.bytes, 'PRIVATE_LOADOUT_WALLET_CHANGED_BYTES')
      packet = validatePrivateLoadoutTransactionPacket(plan, { ...packet, phase: 'SIGNED', signature: signed.signature })
      await transactions.verifySignature(plan, packet)
      record = await save(record, { ...record, transaction: { plan, packet } })
    }
    // Signed bytes are durable before any broadcast. Unknown execution exits
    // with that record intact; the next run starts from queryPacket above.
    await transactions.broadcast(plan, packet)
    const final = await queryPacket(record); record = final.record
    if (final.status === 'SUCCEEDED') { unlocked = null; return { status: 'SAVED', record } }
    return { status: final.status === 'FAILED' ? 'FAILED' : 'PENDING', record }
  }
  async function inspect() {
    const record = await store.read(key); if (record) recordScope(record)
    return record
  }
  async function unlock() {
    live(); const generation = ++readGeneration, next = await readers.unlock(); live()
    check(generation === readGeneration, 'PRIVATE_LOADOUT_READ_SUPERSEDED')
    check(same(next.snapshot.scope, scope), 'PRIVATE_LOADOUT_OWNER_EPOCH_CHANGED')
    const library = validatePrivateLoadoutLibrary(next.library, scope, next.snapshot.revision)
    assertPrivateLoadoutHeadDocument(library, next.snapshot.head)
    unlocked = { ...next, library }
    return structuredClone(unlocked)
  }
  async function start(action: PrivateLoadoutIntent['action'], name?: string, loadoutId?: string) {
    return store.exclusive(key, async () => {
      writable(); check(await inspect() === null, 'PRIVATE_LOADOUT_PENDING_RECOVERY_REQUIRED')
      check(unlocked, 'PRIVATE_LOADOUT_UNLOCK_REQUIRED')
      const base = { requestId: randomRequest(), expectedRevision: unlocked.library.revision, scope, at: new Date().toISOString() }
      let intent: PrivateLoadoutIntent
      if (action === 'save') {
        const captured = await readers.capture(); live()
        intent = { ...base, action, name: normalizeNamedLoadoutName(name), loadoutId: crypto.randomUUID(), ...captured }
      } else if (action === 'renew') intent = { ...base, action }
      else if (action === 'rename') intent = { ...base, action, name: normalizeNamedLoadoutName(name), loadoutId: loadoutId! }
      else intent = { ...base, action, loadoutId: loadoutId! }
      const record = await stage(intent)
      return continueRecord(record, false)
    })
  }
  async function resume(queryOnly = false) {
    return store.exclusive(key, async () => {
      const record = await inspect(); check(record, 'PRIVATE_LOADOUT_RECOVERY_NOT_FOUND')
      return continueRecord(record, queryOnly)
    })
  }
  async function archive() {
    return store.exclusive(key, async () => {
      let record = await inspect(); check(record, 'PRIVATE_LOADOUT_RECOVERY_NOT_FOUND')
      const result = await continueRecord(record, true); record = result.record
      check(!result.pendingTransaction, 'PRIVATE_LOADOUT_QUERY_SIGNED_TRANSACTION_FIRST')
      // Unknown or signed attempts are never dismissed merely to unblock UI.
      if (record.transaction && !['SUCCEEDED', 'FAILED', 'CANCELLED', 'PREPARED'].includes(record.transaction.packet.phase))
        throw new Error('PRIVATE_LOADOUT_QUERY_SIGNED_TRANSACTION_FIRST')
      await assertPaymentSettled(record)
      await store.archive(key, record); onRecord?.(null)
      return { status: 'ARCHIVED' as const, record }
    })
  }
  async function rebase() {
    return store.exclusive(key, async () => {
      writable(); let record = await inspect(); check(record, 'PRIVATE_LOADOUT_RECOVERY_NOT_FOUND')
      const result = await continueRecord(record, true); record = result.record
      check(!result.pendingTransaction, 'PRIVATE_LOADOUT_QUERY_SIGNED_TRANSACTION_FIRST')
      check(result.status !== 'SAVED', 'PRIVATE_LOADOUT_ALREADY_COMMITTED_ARCHIVE_FIRST')
      check(!record.transaction || ['FAILED', 'CANCELLED', 'PREPARED'].includes(record.transaction.packet.phase), 'PRIVATE_LOADOUT_QUERY_SIGNED_TRANSACTION_FIRST')
      await assertPaymentSettled(record)
      const old = await readers.decryptRecovery(record); live(); check(old.intent, 'PRIVATE_LOADOUT_RECOVERY_INTENT_MISSING')
      await unlock()
      const intent = { ...old.intent, requestId: randomRequest(), expectedRevision: unlocked!.library.revision, at: new Date().toISOString() }
      const next = await stage(intent, record)
      return continueRecord(next, false)
    })
  }
  /** Expired Walrus storage is not empty. Only exact current-head cached/exported
   * ciphertext can seed a renewal; old revisions never replace the live library. */
  async function unlockBackup(input: PrivateLoadoutRecovery) {
    live(); const generation = ++readGeneration, record = parsePrivateLoadoutRecovery(input); recordScope(record)
    const current = await head()
    check(record.storage && current.head && current.revision === record.context.revision
      && same(current.head.ciphertext, record.storage.reference), 'PRIVATE_LOADOUT_BACKUP_NOT_CURRENT')
    const library = await readers.decryptRecovery(record); live()
    check(generation === readGeneration, 'PRIVATE_LOADOUT_READ_SUPERSEDED')
    check(headKey(await head()) === headKey(current), 'PRIVATE_LOADOUT_REVISION_CONFLICT')
    assertPrivateLoadoutHeadDocument(library, current.head)
    unlocked = { snapshot: current, library: validatePrivateLoadoutLibrary(library, scope, current.revision), endEpoch: null }
    return structuredClone(unlocked)
  }
  async function assertPaymentSettled(record: PrivateLoadoutRecovery) {
    if (record.storage) return
    const key = privateLoadoutWalrusKey(record)
    if (!readWalrusSingleRecord(key)) { check(!record.paymentStarted, 'PRIVATE_LOADOUT_PAYMENT_RECOVERY_MISSING'); return }
    const payment = await payments.recover(record)
    if (payment.status === 'CERTIFIED' || payment.status === 'FAILED') return
    // An unsigned packet or a certified registration with no signed certify
    // attempt can be archived. Preserve the WAL; never dismiss an unknown signature.
    const walrus = readWalrusSingleRecord(key)
    check(payment.status === 'SOURCE_REQUIRED' && walrus && [walrus.register, walrus.certify].every(packet => !packet
      || ['PREPARED', 'SUCCEEDED', 'FAILED'].includes(packet.phase)), 'PRIVATE_LOADOUT_QUERY_PAYMENT_FIRST')
  }
  return { key, inspect, unlock, unlockBackup, start, resume, archive, rebase, preflight,
    view: (id: string) => { live(); check(unlocked, 'PRIVATE_LOADOUT_UNLOCK_REQUIRED'); return structuredClone(unlocked.library.entries.find(e => e.id === id) ?? null) },
    lock: () => { readGeneration++; unlocked = null; authorizedCiphertexts.clear() } }
}
