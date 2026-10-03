import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { CONTENT_APPEND_STORE_CHANGED, contentAppendStoreKey, openContentAppendDatabase } from './content-append-store'
import { contentAppendPreparationFingerprint, verifyContentAppendPreparation, type ContentAppendPreparation } from './content-append-preparation'
import { parseContentAppendIntent } from './content-append-operation'
import { MAX_CONTENT_APPEND_REBASE_DEPTH, verifyContentAppendRebaseLink, type ContentAppendRebaseLink } from './content-append-rebase-evidence'

function check(v: unknown, code: string): asserts v { if (!v) throw new Error(`CONTENT_APPEND_REBASE_STORE_${code}`) }
const json = (v: unknown) => JSON.stringify(v)
const transitionKey = (record: ContentAppendPreparation, fingerprint: string) => `${contentAppendStoreKey(record.scope)}:${fingerprint}`
/** The transition stores encrypted wrappers and public evidence, sharing the
 * active ciphertext. It is committed BEFORE the new-key WAL is installed.
 * Activation is a second atomic CAS only after the caller reads back that WAL. */
export function browserContentAppendRebaseStore(client: SuiGrpcClient) {
  async function raw(key: string): Promise<ContentAppendRebaseLink | null> {
    const db = await openContentAppendDatabase()
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('rebase', 'readonly'), request = tx.objectStore('rebase').get(key)
        tx.onabort = () => reject(new Error('CONTENT_APPEND_REBASE_STORE_READ_FAILED', { cause: tx.error }))
        tx.oncomplete = () => resolve(request.result ?? null)
      })
    } finally { db.close() }
  }
  async function pending(input: ContentAppendPreparation) {
    const record = await verifyContentAppendPreparation(input, client)
    const link = await raw(transitionKey(record, contentAppendPreparationFingerprint(record)))
    if (!link) return null
    const parsed = await verifyContentAppendRebaseLink(link, record.ciphertext, client)
    check(contentAppendPreparationFingerprint(parsed.previous) === contentAppendPreparationFingerprint(record), 'PREDECESSOR_MISMATCH')
    return parsed.link
  }
  async function history(input: ContentAppendPreparation) {
    let record = await verifyContentAppendPreparation(input, client)
    const result: ContentAppendRebaseLink[] = [], seen = new Set<string>()
    while (parseContentAppendIntent(record).rebase) {
      const parent = parseContentAppendIntent(record).rebase!.predecessor
      check(!seen.has(parent) && result.length < MAX_CONTENT_APPEND_REBASE_DEPTH, 'HISTORY_LIMIT')
      seen.add(parent)
      const link = await raw(transitionKey(record, parent)); check(link, 'HISTORY_MISSING')
      const parsed = await verifyContentAppendRebaseLink(link, record.ciphertext, client)
      check(contentAppendPreparationFingerprint(parsed.next) === contentAppendPreparationFingerprint(record), 'HISTORY_FORK')
      result.push(parsed.link); record = parsed.previous
    }
    return result.reverse()
  }
  async function mutate(input: ContentAppendRebaseLink, ciphertext: Uint8Array, activate: boolean) {
    const parsed = await verifyContentAppendRebaseLink(input, ciphertext, client), { link, previous, next } = parsed
    const key = contentAppendStoreKey(previous.scope), before = contentAppendPreparationFingerprint(previous), after = contentAppendPreparationFingerprint(next)
    const linkKey = transitionKey(previous, before), db = await openContentAppendDatabase()
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['active', 'rebase'], 'readwrite', { durability: 'strict' })
        const active = tx.objectStore('active'), transitions = tx.objectStore('rebase')
        const current = active.get(key), stored = transitions.get(linkKey)
        let cause: unknown, ready = 0
        const abort = (error: unknown) => { cause = error; tx.abort() }
        tx.onabort = () => reject(cause ?? new Error('CONTENT_APPEND_REBASE_STORE_WRITE_FAILED', { cause: tx.error }))
        tx.oncomplete = () => resolve()
        const apply = () => {
          if (++ready !== 2) return
          try {
            check(current.result, 'ACTIVE_MISSING')
            const fingerprint = contentAppendPreparationFingerprint(current.result)
            if (activate) {
              check(stored.result && json(stored.result) === json(link), 'TRANSITION_MISSING_OR_CHANGED')
              check(fingerprint === before || fingerprint === after, 'ACTIVATION_CAS_MISMATCH')
              if (fingerprint === before) active.put(next, key)
            } else {
              check(fingerprint === before, 'PREPARATION_CAS_MISMATCH')
              check(stored.result === undefined || json(stored.result) === json(link), 'TRANSITION_ALREADY_PREPARED')
              transitions.put(link, linkKey)
            }
          } catch (error) { abort(error) }
        }
        current.onsuccess = apply; stored.onsuccess = apply
      })
      check(json(await raw(linkKey)) === json(link), 'TRANSITION_READBACK_MISMATCH')
      if (typeof window !== 'undefined') window.dispatchEvent(new Event(CONTENT_APPEND_STORE_CHANGED))
    } finally { db.close() }
  }
  return { pending, history,
    prepare: (link: ContentAppendRebaseLink, ciphertext: Uint8Array) => mutate(link, ciphertext, false),
    activate: (link: ContentAppendRebaseLink, ciphertext: Uint8Array) => mutate(link, ciphertext, true) }
}
