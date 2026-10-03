import { parseSoulAuthoringRequest, soulAuthoringManifestHash, validateSoulAuthoringManifest,
  type SoulAuthoringManifest, type SoulAuthoringRequest } from './soul-authoring-manifest'
import { parseWalrusBatchPreparation, walrusBatchKeys, type WalrusBatchPreparation } from '../upload/walrus-batch-preparation'
import { createWalrusBatchRecord, openWalrusBatchDatabase, parseWalrusBatchRecord,
  walrusBatchRecordHash, walrusBatchStoreKey, WALRUS_BATCH_STORE_CHANGED } from '../upload/walrus-batch-store'

function check(value: unknown, code: string): asserts value { if (!value) throw new Error(`SOUL_AUTHORING_STORE_${code}`) }
export interface SoulAuthoringPreparation {
  schema: 'soulidity.soul-authoring-preparation.v1'
  manifest: SoulAuthoringManifest
  preparation: WalrusBatchPreparation
}
export interface SoulAuthoringStore {
  exclusive<T>(key: string, work: () => Promise<T>): Promise<T>
  read(key: string): Promise<SoulAuthoringPreparation | null>
  /** Atomically installs the parent intent AND the uploader's initial WAL.
   * Idempotent for the same intent; never resets registered/consumed uploads. */
  create(key: string, value: SoulAuthoringPreparation): Promise<void>
}
/** One unresolved authoring operation per author/original package. A fresh
 * nonce, callable upgrade or another create page cannot evade recovery. */
export function soulAuthoringStoreKey(input: SoulAuthoringRequest): string {
  const r = parseSoulAuthoringRequest(input)
  return `soul-authoring:${r.target.chainIdentifier}:${r.target.originalPackageId}:${r.author}`
}
export function parseSoulAuthoringPreparation(input: unknown): SoulAuthoringPreparation {
  const p = structuredClone(input) as SoulAuthoringPreparation
  walrusBatchKeys(p, ['schema', 'manifest', 'preparation'])
  check(p.schema === 'soulidity.soul-authoring-preparation.v1', 'SCHEMA_INVALID')
  p.preparation = parseWalrusBatchPreparation(p.preparation)
  p.manifest = validateSoulAuthoringManifest(p.manifest, p.preparation)
  return p
}
export function soulAuthoringPreparationHash(input: SoulAuthoringPreparation): string {
  const p = parseSoulAuthoringPreparation(input)
  return soulAuthoringManifestHash(p.manifest, p.preparation)
}
/** Ciphertext is stored ONCE in the uploader WAL. The small parent record is a
 * reference written in the same strict IDB transaction; there is no half-save
 * window before payment. This store does not assert transaction success or
 * expose deletion/archive: the parent runner must first prove terminal state. */
export function browserSoulAuthoringStore(): SoulAuthoringStore {
  async function read(key: string): Promise<SoulAuthoringPreparation | null> {
    const db = await openWalrusBatchDatabase()
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(['authoring', 'active'], 'readonly')
        const parent = tx.objectStore('authoring').get(key)
        let value: SoulAuthoringPreparation | null = null, cause: unknown
        const fail = (error: unknown) => { cause = error; tx.abort() }
        tx.onabort = () => reject(cause ?? new Error('SOUL_AUTHORING_STORE_READ_FAILED', { cause: tx.error }))
        tx.oncomplete = () => resolve(value)
        parent.onsuccess = () => {
          if (parent.result === undefined) return
          try {
            const p = parent.result
            walrusBatchKeys(p, ['schema', 'manifest', 'batchKey'])
            check(p.schema === 'soulidity.soul-authoring-parent.v1' && typeof p.batchKey === 'string', 'PARENT_INVALID')
            const batch = tx.objectStore('active').get(p.batchKey)
            batch.onsuccess = () => {
              try {
                check(batch.result !== undefined, 'UPLOAD_RECORD_MISSING')
                const upload = parseWalrusBatchRecord(batch.result)
                check(walrusBatchStoreKey(upload.preparation.manifest.scope) === p.batchKey, 'UPLOAD_KEY_MISMATCH')
                value = parseSoulAuthoringPreparation({ schema: 'soulidity.soul-authoring-preparation.v1',
                  manifest: p.manifest, preparation: upload.preparation })
                check(soulAuthoringStoreKey(value.manifest.request) === key, 'KEY_MISMATCH')
              } catch (error) { fail(error) }
            }
          } catch (error) { fail(error) }
        }
      })
    } finally { db.close() }
  }
  return {
    read,
    exclusive: (key, work) => {
      check(typeof navigator !== 'undefined' && navigator.locks?.request, 'LOCKS_REQUIRED')
      return navigator.locks.request(key, { mode: 'exclusive', ifAvailable: true }, async lock => {
        check(lock, 'BUSY_IN_ANOTHER_TAB'); return work()
      })
    },
    async create(key, input) {
      const value = parseSoulAuthoringPreparation(input), fingerprint = soulAuthoringPreparationHash(value)
      check(soulAuthoringStoreKey(value.manifest.request) === key, 'KEY_MISMATCH')
      const initial = createWalrusBatchRecord(value.preparation), batchKey = walrusBatchStoreKey(value.preparation.manifest.scope)
      const db = await openWalrusBatchDatabase()
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(['authoring', 'active'], 'readwrite', { durability: 'strict' })
          const parents = tx.objectStore('authoring'), uploads = tx.objectStore('active'), prior = parents.get(key)
          let cause: unknown
          const fail = (error: unknown) => { cause = error; tx.abort() }
          tx.onabort = () => reject(cause ?? new Error('SOUL_AUTHORING_STORE_WRITE_FAILED', { cause: tx.error }))
          tx.oncomplete = () => resolve()
          prior.onsuccess = () => {
            try {
              if (prior.result !== undefined) {
                walrusBatchKeys(prior.result, ['schema', 'manifest', 'batchKey'])
                check(prior.result.schema === 'soulidity.soul-authoring-parent.v1' && prior.result.batchKey === batchKey
                  && soulAuthoringManifestHash(validateSoulAuthoringManifest(prior.result.manifest, value.preparation), value.preparation) === fingerprint,
                'UNRESOLVED_OPERATION')
              }
              const oldUpload = uploads.get(batchKey)
              oldUpload.onsuccess = () => {
                try {
                  if (prior.result !== undefined) {
                    check(oldUpload.result !== undefined, 'UPLOAD_RECORD_MISSING')
                    const record = parseWalrusBatchRecord(oldUpload.result)
                    check(soulAuthoringManifestHash(value.manifest, record.preparation) === fingerprint, 'UPLOAD_CHANGED')
                    // The existing record may already contain paid receipts.
                    // Do not write the empty `initial` over those checkpoints.
                    return
                  }
                  check(oldUpload.result === undefined || walrusBatchRecordHash(oldUpload.result) === walrusBatchRecordHash(initial),
                    'ORPHAN_PAID_UPLOAD')
                  uploads.put(initial, batchKey)
                  parents.put({ schema: 'soulidity.soul-authoring-parent.v1', manifest: value.manifest, batchKey }, key)
                } catch (error) { fail(error) }
              }
            } catch (error) { fail(error) }
          }
        })
        const persisted = await read(key)
        check(persisted && soulAuthoringPreparationHash(persisted) === fingerprint, 'READBACK_MISMATCH')
        if (typeof window !== 'undefined') window.dispatchEvent(new Event(WALRUS_BATCH_STORE_CHANGED))
      } finally { db.close() }
    },
  }
}
