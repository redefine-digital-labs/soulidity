import { createSoulAuthoringPacketParser, soulAuthoringPacketCheck as check, soulAuthoringPacketKey,
  type SoulAuthoringPacketRecord } from './soul-authoring-packet'
import type { SoulAuthoringPreparation } from './soul-authoring-store'
import { assertPublicMutationTransition, publicMutationCanonical as canonical, publicMutationFrozen as frozen,
  type PublicMutationJournal } from '../sui/public-mutation-journal'
import { openWalrusBatchDatabase, walrusBatchStoreKey, WALRUS_BATCH_STORE_CHANGED } from '../upload/walrus-batch-store'
import { walrusBatchJsonHash, walrusBatchKeys } from '../upload/walrus-batch-preparation'

export interface SoulAuthoringPacketJournal extends PublicMutationJournal<SoulAuthoringPacketRecord> {
  read(key: string): Promise<SoulAuthoringPacketRecord | null>
  write(key: string, record: SoulAuthoringPacketRecord): Promise<void>
  history(key: string): Promise<SoulAuthoringPacketRecord[]>
}
const terminal = (r: SoulAuthoringPacketRecord) => ['SUCCEEDED', 'FAILED', 'CANCELLED', 'RETIRED'].includes(r.packet.phase)
/** Exact transaction bytes are separate from (and bound to) the immutable
 * pre-payment manifest. Replacing a terminal head atomically retains its full
 * receipt; unknown/SIGNING packets cannot be replaced or deleted. */
export function browserSoulAuthoringPacketJournal(preparation: SoulAuthoringPreparation): SoulAuthoringPacketJournal {
  const domain = createSoulAuthoringPacketParser(preparation), { parentKey, manifestHash, parse } = domain
  const key = `${parentKey}:packets`, batchKey = walrusBatchStoreKey(preparation.preparation.manifest.scope)
  const table = 'authoring-packets', maxRecords = 2048, maxBytes = 64 * 1024 * 1024
  let held = false
  function scoped(input: unknown) {
    const r = parse(input); check(soulAuthoringPacketKey(r.plan) === key, 'JOURNAL_SCOPE'); return r
  }
  function parent(input: unknown) {
    walrusBatchKeys(input, ['schema', 'manifest', 'batchKey'])
    check(input.schema === 'soulidity.soul-authoring-parent.v1' && input.batchKey === batchKey
      && walrusBatchJsonHash(input.manifest) === manifestHash, 'DURABLE_MANIFEST_REQUIRED')
  }
  async function read(at: string) {
    check(at === key, 'JOURNAL_KEY')
    const db = await openWalrusBatchDatabase()
    try {
      return await new Promise<SoulAuthoringPacketRecord | null>((resolve, reject) => {
        const tx = db.transaction(['authoring', table], 'readonly'), p = tx.objectStore('authoring').get(parentKey)
        let result: SoulAuthoringPacketRecord | null = null, cause: unknown
        const fail = (error: unknown) => { cause = error; tx.abort() }
        tx.onabort = () => reject(cause ?? new Error('SOUL_AUTHORING_PACKET_READ_FAILED', { cause: tx.error }))
        tx.oncomplete = () => resolve(result)
        p.onsuccess = () => { try {
          parent(p.result)
          const r = tx.objectStore(table).get(key)
          r.onsuccess = () => { try { if (r.result !== undefined) result = scoped(r.result) } catch (error) { fail(error) } }
        } catch (error) { fail(error) } }
      })
    } finally { db.close() }
  }
  return {
    read,
    exclusive: async (at, work) => {
      check(at === key && typeof navigator !== 'undefined' && navigator.locks?.request, 'LOCKS_REQUIRED')
      return navigator.locks.request(parentKey, { mode: 'exclusive', ifAvailable: true }, async lock => {
        check(lock && !held, 'BUSY_IN_ANOTHER_TAB'); held = true
        try { return await work() } finally { held = false }
      })
    },
    async write(at, input) {
      check(at === key && held, 'JOURNAL_LOCK_REQUIRED')
      const next = scoped(input), encoded = canonical(next)
      check(encoded.length <= 3 * 1024 * 1024, 'RECORD_BUDGET')
      const db = await openWalrusBatchDatabase()
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(['authoring', table], 'readwrite', { durability: 'strict' }), rows = tx.objectStore(table)
          const p = tx.objectStore('authoring').get(parentKey)
          let cause: unknown
          const fail = (error: unknown) => { cause = error; tx.abort() }
          tx.onabort = () => reject(cause ?? new Error('SOUL_AUTHORING_PACKET_WRITE_FAILED', { cause: tx.error }))
          tx.oncomplete = () => resolve()
          p.onsuccess = () => { try {
            parent(p.result)
            const old = rows.get(key)
            old.onsuccess = () => { try {
              if (old.result === undefined) {
                check(next.packet.phase === 'PREPARED' && next.packet.signature === null, 'INITIAL_PHASE')
                rows.put(next, key); return
              }
              const prior = scoped(old.result)
              if (frozen(prior) === frozen(next) && !(prior.packet.phase === 'CANCELLED' && next.packet.phase === 'PREPARED')) {
                if (prior.retirement) check(canonical(prior.retirement) === canonical(next.retirement), 'RETIREMENT_CHANGED')
                else if (next.retirement) check(next.retirement.priorPhase === prior.packet.phase, 'RETIREMENT_PHASE_CHANGED')
                assertPublicMutationTransition(prior, next, 'SOUL_AUTHORING_PACKET'); rows.put(next, key); return
              }
              check(terminal(prior) && next.packet.phase === 'PREPARED' && next.packet.signature === null, 'RECOVERY_REQUIRED')
              check(prior.packet.digest !== next.packet.digest, 'REPLACEMENT_DIGEST_REUSED')
              const archiveKey = `${key}:history:${prior.packet.digest}:${prior.packet.phase}`, archived = rows.get(archiveKey)
              archived.onsuccess = () => { try {
                check(archived.result === undefined || canonical(scoped(archived.result)) === canonical(prior), 'ARCHIVE_CONFLICT')
                rows.put(prior, archiveKey); rows.put(next, key)
              } catch (error) { fail(error) } }
            } catch (error) { fail(error) } }
          } catch (error) { fail(error) } }
        })
        check(canonical(await read(key)) === encoded, 'JOURNAL_READBACK_FAILED')
        if (typeof window !== 'undefined') window.dispatchEvent(new Event(WALRUS_BATCH_STORE_CHANGED))
      } finally { db.close() }
    },
    async history(at) {
      check(at === key, 'JOURNAL_KEY')
      const db = await openWalrusBatchDatabase(), prefix = `${key}:history:`
      try {
        return await new Promise<SoulAuthoringPacketRecord[]>((resolve, reject) => {
          const tx = db.transaction(['authoring', table], 'readonly'), p = tx.objectStore('authoring').get(parentKey)
          const records: SoulAuthoringPacketRecord[] = []; let bytes = 0, cause: unknown
          const fail = (error: unknown) => { cause = error; tx.abort() }
          tx.onabort = () => reject(cause ?? new Error('SOUL_AUTHORING_PACKET_HISTORY_FAILED', { cause: tx.error }))
          tx.oncomplete = () => resolve(records)
          p.onsuccess = () => { try {
            parent(p.result)
            const cursor = tx.objectStore(table).openCursor(IDBKeyRange.bound(prefix, `${prefix}\uffff`))
            cursor.onsuccess = () => { try {
              const row = cursor.result; if (!row) return
              const record = scoped(row.value); bytes += canonical(record).length
              check(terminal(record) && row.key === `${prefix}${record.packet.digest}:${record.packet.phase}`, 'ARCHIVE_INVALID')
              check(records.length < maxRecords && bytes <= maxBytes, 'HISTORY_BUDGET')
              records.push(record); row.continue()
            } catch (error) { fail(error) } }
          } catch (error) { fail(error) } }
        })
      } finally { db.close() }
    },
  }
}
