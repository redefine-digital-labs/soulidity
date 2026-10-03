import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { toHex } from '@mysten/sui/utils'
import { sha256 } from '@noble/hashes/sha2.js'
import { contentAppendPreparationFingerprint, type ContentAppendPreparationScope } from './content-append-preparation'
import { CONTENT_APPEND_STORE_CHANGED, contentAppendStoreKey, openContentAppendDatabase } from './content-append-store'
import { verifyContentAppendRecoveryBundle, type ContentAppendRecoveryBundle } from './content-append-recovery'

function check(v: unknown, code: string): asserts v { if (!v) throw new Error(`CONTENT_APPEND_RESTORE_STORE_${code}`) }
const json = (v: unknown) => JSON.stringify(v)
export function contentAppendRestoreFingerprint(bundle: ContentAppendRecoveryBundle) {
  return toHex(sha256(new TextEncoder().encode(json({ preparation: contentAppendPreparationFingerprint(bundle.record),
    payment: bundle.payment, history: bundle.history, pending: bundle.pending, additionalPayments: bundle.additionalPayments }))))
}
/** A restore is not active/resumable until all payment keys were installed and
 * read back. Its durable encrypted marker remains discoverable after any failure.
 * Caller holds the normal content-slot lock throughout the cross-store operation. */
export function browserContentAppendRestoreStore(client: SuiGrpcClient) {
  async function read(key: string) {
    const db = await openContentAppendDatabase()
    try {
      const value = await new Promise<ContentAppendRecoveryBundle | null>((resolve, reject) => {
        const tx = db.transaction('restore', 'readonly'), request = tx.objectStore('restore').get(key)
        tx.onabort = () => reject(new Error('CONTENT_APPEND_RESTORE_STORE_READ_FAILED', { cause: tx.error }))
        tx.oncomplete = () => resolve(request.result ?? null)
      })
      if (!value) return null
      const parsed = await verifyContentAppendRecoveryBundle(value, client)
      check(contentAppendStoreKey(parsed.record.scope) === key, 'KEY_MISMATCH'); return parsed
    } finally { db.close() }
  }
  async function update(input: ContentAppendRecoveryBundle, complete: boolean) {
    const bundle = await verifyContentAppendRecoveryBundle(input, client), key = contentAppendStoreKey(bundle.record.scope)
    const fingerprint = contentAppendRestoreFingerprint(bundle), prepared = contentAppendPreparationFingerprint(bundle.record)
    const edges = [...bundle.history, ...(bundle.pending ? [bundle.pending] : [])]
    const db = await openContentAppendDatabase()
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['restore', 'active', 'rebase'], 'readwrite', { durability: 'strict' })
        const restores = tx.objectStore('restore'), active = tx.objectStore('active'), history = tx.objectStore('rebase')
        const saved = restores.get(key), current = active.get(key)
        const currentPending = history.get(`${key}:${prepared}`)
        const links = edges.map(edge => ({ edge, key: `${key}:${contentAppendPreparationFingerprint({ ...edge.previous, ciphertext: bundle.record.ciphertext })}` }))
        const reads = links.map(link => history.get(link.key))
        let cause: unknown, count = 0
        tx.onabort = () => reject(cause ?? new Error('CONTENT_APPEND_RESTORE_STORE_WRITE_FAILED', { cause: tx.error }))
        tx.oncomplete = () => resolve()
        const finish = () => {
          if (++count !== 3 + reads.length) return
          try {
            check(!current.result || contentAppendPreparationFingerprint(current.result) === prepared, 'ACTIVE_CONFLICT')
            check(!saved.result || contentAppendRestoreFingerprint(saved.result) === fingerprint, 'RESTORE_CONFLICT')
            check(currentPending.result === undefined || bundle.pending && json(currentPending.result) === json(bundle.pending), 'PENDING_CONFLICT')
            reads.forEach((request, n) => check(request.result === undefined || json(request.result) === json(links[n].edge), 'HISTORY_CONFLICT'))
            if (complete) {
              check(saved.result && contentAppendRestoreFingerprint(saved.result) === fingerprint, 'DURABLE_MARKER_REQUIRED')
              links.forEach(link => history.put(link.edge, link.key))
              active.put(bundle.record, key); restores.delete(key)
            } else restores.put(bundle, key)
          } catch (error) { cause = error; tx.abort() }
        }
        saved.onsuccess = finish; current.onsuccess = finish; currentPending.onsuccess = finish; reads.forEach(request => { request.onsuccess = finish })
      })
      const persisted = await read(key)
      check(complete ? persisted === null : persisted && contentAppendRestoreFingerprint(persisted) === fingerprint, 'READBACK_MISMATCH')
      if (typeof window !== 'undefined') window.dispatchEvent(new Event(CONTENT_APPEND_STORE_CHANGED))
    } finally { db.close() }
  }
  async function list(scope: Pick<ContentAppendPreparationScope, 'originalPackageId' | 'author' | 'contentObjectId'>) {
    for (const value of [scope.originalPackageId, scope.author, scope.contentObjectId]) check(/^0x[0-9a-f]{64}$/.test(value), 'LIST_SCOPE_INVALID')
    const prefix = `content-append:${scope.originalPackageId}:${scope.author}:${scope.contentObjectId}:`, db = await openContentAppendDatabase()
    let keys: string[]
    try {
      keys = await new Promise<string[]>((resolve, reject) => {
        const tx = db.transaction('restore', 'readonly'), result: string[] = []
        const request = tx.objectStore('restore').openKeyCursor(IDBKeyRange.bound(prefix, `${prefix.slice(0, -1)};`, false, true))
        let cause: unknown
        tx.onabort = () => reject(cause ?? new Error('CONTENT_APPEND_RESTORE_STORE_LIST_FAILED', { cause: tx.error }))
        tx.oncomplete = () => resolve(result)
        request.onsuccess = () => {
          try {
            const cursor = request.result; if (!cursor) return
            check(result.length < 16 && typeof cursor.key === 'string' && cursor.key.startsWith(prefix), 'LIST_LIMIT')
            result.push(cursor.key); cursor.continue()
          } catch (error) { cause = error; tx.abort() }
        }
      })
    } finally { db.close() }
    const bundles: ContentAppendRecoveryBundle[] = []; let bytes = 0
    for (const key of keys) {
      const bundle = await read(key); if (!bundle) continue
      bytes += bundle.record.ciphertext.length; check(bytes <= 128 * 1024 * 1024, 'LIST_BYTE_LIMIT'); bundles.push(bundle)
    }
    return bundles
  }
  return { read, list, stage: (bundle: ContentAppendRecoveryBundle) => update(bundle, false),
    complete: (bundle: ContentAppendRecoveryBundle) => update(bundle, true) }
}
