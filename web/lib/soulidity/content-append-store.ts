import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { contentAppendPreparationFingerprint, contentAppendPreparationOperationHash, verifyContentAppendPreparation,
  type ContentAppendPreparation, type ContentAppendPreparationScope } from './content-append-preparation'

function check(v: unknown, code: string): asserts v { if (!v) throw new Error(`CONTENT_APPEND_STORE_${code}`) }
export const CONTENT_APPEND_STORE_CHANGED = 'soulidity:content-append-store-changed'
/** One unresolved append per exact author/release/content slot. Version/intent
 * changes cannot silently evade a paid or signed operation in that slot. */
export function contentAppendStoreKey(scope: ContentAppendPreparationScope) {
  contentAppendPreparationOperationHash(scope)
  return `content-append:${scope.originalPackageId}:${scope.author}:${scope.contentObjectId}:${scope.kind}:${encodeURIComponent(scope.name)}`
}
export interface ContentAppendStore {
  exclusive<T>(key: string, work: () => Promise<T>): Promise<T>
  read(key: string): Promise<ContentAppendPreparation | null>
  create(key: string, value: ContentAppendPreparation): Promise<void>
  archive(key: string, expected: ContentAppendPreparation): Promise<void>
  list(scope: Pick<ContentAppendPreparationScope, 'originalPackageId' | 'author' | 'contentObjectId'>): Promise<ContentAppendPreparation[]>
  listArchived(scope: Pick<ContentAppendPreparationScope, 'originalPackageId' | 'author' | 'contentObjectId'>): Promise<ContentAppendPreparation[]>
}
/** Ciphertext in IndexedDB; only encrypted material plus its author's verified
 * public attestation is accepted. No localStorage raw key or TTL deletion. */
export function openContentAppendDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    check(typeof indexedDB !== 'undefined' && typeof navigator !== 'undefined' && navigator.locks?.request, 'INDEXED_DB_AND_LOCKS_REQUIRED')
    const request = indexedDB.open('soulidity-content-append', 3)
    let failed = false
    request.onupgradeneeded = () => {
      for (const name of ['active', 'archive', 'rebase', 'restore']) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name)
    }
    request.onblocked = () => { failed = true; reject(new Error('CONTENT_APPEND_STORE_BLOCKED')) }
    request.onerror = () => reject(new Error('CONTENT_APPEND_STORE_OPEN_FAILED', { cause: request.error }))
    request.onsuccess = () => { if (failed) request.result.close(); else resolve(request.result) }
  })
}
export function browserContentAppendStore(client: SuiGrpcClient): ContentAppendStore {
  const open = openContentAppendDatabase
  async function readStored(key: string, store: 'active' | 'archive') {
    const db = await open()
    try {
      const value = await new Promise<ContentAppendPreparation | null>((resolve, reject) => {
        const tx = db.transaction(store, 'readonly'), request = tx.objectStore(store).get(key)
        tx.onabort = () => reject(new Error('CONTENT_APPEND_STORE_READ_FAILED', { cause: tx.error }))
        tx.oncomplete = () => resolve(request.result ?? null)
      })
      if (value === null) return null
      const parsed = await verifyContentAppendPreparation(value, client)
      const base = contentAppendStoreKey(parsed.scope)
      check((store === 'active' ? base : `${base}:${contentAppendPreparationFingerprint(parsed)}`) === key, 'KEY_MISMATCH'); return parsed
    } finally { db.close() }
  }
  const read = (key: string) => readStored(key, 'active')
  async function update(key: string, input: ContentAppendPreparation, archive: boolean) {
    const value = await verifyContentAppendPreparation(input, client), fingerprint = contentAppendPreparationFingerprint(value)
    check(contentAppendStoreKey(value.scope) === key, 'KEY_MISMATCH')
    const db = await open()
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(archive ? ['active', 'archive'] : ['active'], 'readwrite', { durability: 'strict' })
        const active = tx.objectStore('active'), request = active.get(key)
        let cause: unknown
        const abort = (error: unknown) => { cause = error; tx.abort() }
        tx.onabort = () => reject(cause ?? new Error('CONTENT_APPEND_STORE_WRITE_FAILED', { cause: tx.error }))
        tx.oncomplete = () => resolve()
        request.onsuccess = () => {
          try {
            if (archive) {
              const present = request.result !== undefined
              check(!present || contentAppendStoreKey(request.result.scope) === key
                && contentAppendPreparationFingerprint(request.result) === fingerprint, 'ARCHIVE_CAS_MISMATCH')
              // Archive retains the exact signed preparation; it never deletes
              // the separate paid transaction WAL. Caller first proves finality.
              const history = tx.objectStore('archive'), historyKey = `${key}:${fingerprint}`, prior = history.get(historyKey)
              prior.onsuccess = () => {
                try {
                  check(prior.result === undefined || contentAppendPreparationFingerprint(prior.result) === fingerprint, 'ARCHIVE_CONFLICT')
                  check(present || prior.result !== undefined, 'ARCHIVE_CAS_MISMATCH')
                  if (present) { history.put(value, historyKey); active.delete(key) }
                } catch (error) { abort(error) }
              }
            } else {
              check(request.result === undefined || contentAppendPreparationFingerprint(request.result) === fingerprint, 'UNRESOLVED_OPERATION')
              active.put(value, key)
            }
          } catch (error) { abort(error) }
        }
      })
      const persisted = await readStored(archive ? `${key}:${fingerprint}` : key, archive ? 'archive' : 'active')
      check(persisted && contentAppendPreparationFingerprint(persisted) === fingerprint, 'READBACK_MISMATCH')
      if (typeof window !== 'undefined') window.dispatchEvent(new Event(CONTENT_APPEND_STORE_CHANGED))
    } finally { db.close() }
  }
  async function listStored(scope: Parameters<ContentAppendStore['list']>[0], store: 'active' | 'archive') {
      for (const value of [scope.originalPackageId, scope.author, scope.contentObjectId]) check(/^0x[0-9a-f]{64}$/.test(value), 'LIST_SCOPE_INVALID')
      const prefix = `content-append:${scope.originalPackageId}:${scope.author}:${scope.contentObjectId}:`
      const db = await open()
      let found: string[]
      try {
        found = await new Promise<string[]>((resolve, reject) => {
          const tx = db.transaction(store, 'readonly'), keys: string[] = []
          const request = tx.objectStore(store).openKeyCursor(IDBKeyRange.bound(prefix, `${prefix.slice(0, -1)};`, false, true))
          let cause: unknown
          tx.onabort = () => reject(cause ?? new Error('CONTENT_APPEND_STORE_LIST_FAILED', { cause: tx.error }))
          tx.oncomplete = () => resolve(keys)
          request.onsuccess = () => {
            try {
              const cursor = request.result; if (!cursor) return
              check(keys.length < 32 && typeof cursor.key === 'string' && cursor.key.startsWith(prefix), 'LIST_BUDGET_EXCEEDED')
              keys.push(cursor.key); cursor.continue()
            } catch (error) { cause = error; tx.abort() }
          }
        })
      } finally { db.close() }
      const values: ContentAppendPreparation[] = []; let bytes = 0
      for (const key of found) {
        const value = await readStored(key, store); if (!value) continue
        bytes += value.ciphertext.length; check(bytes <= 128 * 1024 * 1024, 'LIST_BYTE_BUDGET_EXCEEDED'); values.push(value)
      }
      return values
  }
  return { read, create: (key, value) => update(key, value, false), archive: (key, value) => update(key, value, true),
    list: scope => listStored(scope, 'active'), listArchived: scope => listStored(scope, 'archive'),
    exclusive: (key, work) => {
      check(typeof navigator !== 'undefined' && navigator.locks?.request, 'LOCKS_REQUIRED')
      return navigator.locks.request(`soulidity:${key}`, { mode: 'exclusive', ifAvailable: true }, async lock => {
        check(lock, 'BUSY_IN_ANOTHER_TAB'); return work()
      })
    } }
}

export function exportContentAppendPreparation(record: ContentAppendPreparation) {
  contentAppendPreparationFingerprint(record)
  return JSON.stringify({ ...record, ciphertext: toBase64(record.ciphertext) })
}
/** Import only verifies/stages data. It never adopts a different active record,
 * queries/broadcasts a packet, requests a signature or pays for storage. */
export async function importContentAppendPreparation(text: string, client: SuiGrpcClient) {
  check(typeof text === 'string' && text.length <= 90 * 1024 * 1024, 'IMPORT_SIZE_INVALID')
  const value = JSON.parse(text)
  check(typeof value.ciphertext === 'string', 'IMPORT_CIPHERTEXT_INVALID')
  const bytes = fromBase64(value.ciphertext)
  check(toBase64(bytes) === value.ciphertext, 'IMPORT_CIPHERTEXT_INVALID')
  const parsed = await verifyContentAppendPreparation({ ...value, ciphertext: bytes }, client)
  check(exportContentAppendPreparation(parsed) === text, 'IMPORT_NOT_CANONICAL'); return parsed
}
