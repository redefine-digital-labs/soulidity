import { check, same, parseCollectionCommandPlan, type CollectionCommandPlan, type CollectionCommandRecord, type CollectionCommandQuery } from './collection-command-plan'
import { parseCollectionCommandRecord, type CollectionCommandAdapter } from './collection-command-operation'
import { publicMutationCanonical as canonical } from '../sui/public-mutation-journal'

export const COLLECTION_COMMAND_CHANGED = 'soulidity:collection-command-changed'
const PREFIX = 'soulidity.collection-command:'
const terminal = (r: CollectionCommandRecord) => ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(r.packet.phase)
export function collectionCommandKey(p: CollectionCommandPlan) {
  return `${PREFIX}${p.target.chainIdentifier}:${p.request.collectionId}:${p.author}`
}
const frozen = (r: CollectionCommandRecord) => canonical({ schema: r.schema, plan: r.plan, bytes: r.packet.bytes,
  digest: r.packet.digest, expirationEpoch: r.packet.expirationEpoch })
export interface CollectionCommandStore {
  exclusive<T>(key: string, work: () => Promise<T>): Promise<T>
  read(key: string): CollectionCommandRecord | null
  write(key: string, record: CollectionCommandRecord, imported?: boolean): void
  discover(collectionId: string): CollectionCommandRecord[]
  history(key: string): CollectionCommandRecord[]
}
/** One lock/head across callable releases for each chain + Collection + owner.
 * Storage errors fail closed. Public exact bytes are retained without TTL,
 * deletion, silent memory fallback or automatic rebuilding. */
export function browserCollectionCommandStore(): CollectionCommandStore {
  check(typeof window !== 'undefined' && typeof navigator !== 'undefined' && navigator.locks?.request, 'PERSISTENT_STORAGE_AND_LOCKS_REQUIRED')
  const storage = window.localStorage, held = new Set<string>(), maxSize = 3 * 1024 * 1024, maxRecords = 128
  function readAt(name: string, key: string) {
    const raw = storage.getItem(name); if (raw === null) return null
    check(raw.length > 0 && raw.length <= maxSize, 'JOURNAL_BUDGET')
    const record = parseCollectionCommandRecord(JSON.parse(raw)); check(collectionCommandKey(record.plan) === key, 'JOURNAL_SCOPE'); return record
  }
  function persist(name: string, record: CollectionCommandRecord) {
    const encoded = canonical(record); check(encoded.length <= maxSize, 'JOURNAL_BUDGET')
    storage.setItem(name, encoded); check(storage.getItem(name) === encoded, 'JOURNAL_READBACK_FAILED')
  }
  function archive(key: string, record: CollectionCommandRecord) {
    check(terminal(record), 'JOURNAL_UNRESOLVED')
    const name = `${key}:history:${record.packet.digest}:${record.packet.phase}`, prior = readAt(name, key)
    check(!prior || same(prior, record), 'ARCHIVE_CONFLICT'); if (!prior) persist(name, record)
  }
  return {
    exclusive: (key, work) => navigator.locks.request(key, { mode: 'exclusive', ifAvailable: true }, async lock => {
      check(lock && !held.has(key), 'JOURNAL_BUSY'); held.add(key)
      try { return await work() } finally { held.delete(key) }
    }),
    read: key => readAt(key, key),
    write: (key, input, imported = false) => {
      check(held.has(key), 'JOURNAL_LOCK_REQUIRED')
      const record = parseCollectionCommandRecord(input); check(collectionCommandKey(record.plan) === key, 'JOURNAL_SCOPE')
      const old = readAt(key, key)
      if (!old) check(imported || record.packet.phase === 'PREPARED' && record.packet.signature === null, 'JOURNAL_INITIAL_PHASE')
      else if (frozen(old) === frozen(record) && !(old.packet.phase === 'CANCELLED' && record.packet.phase === 'PREPARED' && !imported)) {
        const transitions: Record<CollectionCommandRecord['packet']['phase'], string[]> = {
          PREPARED: ['PREPARED', 'SIGNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'], SIGNING: ['SIGNING', 'SIGNED', 'SUCCEEDED', 'FAILED'],
          SIGNED: ['SIGNED', 'SUCCEEDED', 'FAILED'], SUCCEEDED: ['SUCCEEDED'], FAILED: ['FAILED'], CANCELLED: ['CANCELLED', 'SUCCEEDED', 'FAILED'],
        }
        check(transitions[old.packet.phase].includes(record.packet.phase) && (old.packet.signature === null || old.packet.signature === record.packet.signature), 'JOURNAL_TRANSITION')
        check(old.packet.signature !== null || record.packet.signature === null || old.packet.phase === 'SIGNING' && record.packet.phase === 'SIGNED', 'JOURNAL_SIGNATURE')
      } else {
        check(terminal(old) && !imported && record.packet.phase === 'PREPARED' && record.packet.signature === null, 'JOURNAL_RECOVERY_REQUIRED')
        archive(key, old)
      }
      persist(key, record); window.dispatchEvent(new window.Event(COLLECTION_COMMAND_CHANGED))
    },
    discover: collectionId => {
      const result: CollectionCommandRecord[] = []
      for (let index = 0; index < storage.length; index++) {
        const name = storage.key(index); if (!name?.startsWith(PREFIX) || name.includes(':history:')) continue
        const parts = name.slice(PREFIX.length).split(':')
        if (parts.length !== 3 || parts[1] !== collectionId) continue
        const record = readAt(name, name); check(record && record.plan.request.collectionId === collectionId, 'JOURNAL_SCOPE')
        result.push(record); check(result.length <= maxRecords, 'JOURNAL_LIST_BUDGET')
      }
      return result.sort((a, b) => collectionCommandKey(a.plan).localeCompare(collectionCommandKey(b.plan)))
    },
    history: key => {
      const result: CollectionCommandRecord[] = [], start = `${key}:history:`
      for (let index = 0; index < storage.length; index++) {
        const name = storage.key(index); if (!name?.startsWith(start)) continue
        const record = readAt(name, key)
        check(record && terminal(record) && name === `${start}${record.packet.digest}:${record.packet.phase}`, 'JOURNAL_ARCHIVE_INVALID')
        result.push(record); check(result.length <= maxRecords, 'JOURNAL_LIST_BUDGET')
      }
      return result
    },
  }
}
async function observed(adapter: CollectionCommandAdapter, record: CollectionCommandRecord) {
  const result = await adapter.query(record)
  check(['MISSING', 'PENDING', 'SUCCEEDED', 'FAILED'].includes(result.status), 'JOURNAL_QUERY_INVALID')
  if (['SUCCEEDED', 'FAILED'].includes(record.packet.phase)) check(result.status === record.packet.phase, 'JOURNAL_RESULT_UNCONFIRMED')
  return result
}
function saved(store: CollectionCommandStore, key: string, record: CollectionCommandRecord, imported = false) {
  const value = parseCollectionCommandRecord(record); store.write(key, value, imported)
  check(same(store.read(key), value), 'JOURNAL_READBACK_FAILED'); return value
}
export async function prepareCollectionCommand(params: { plan: CollectionCommandPlan; store: CollectionCommandStore; adapter: CollectionCommandAdapter }) {
  const plan = parseCollectionCommandPlan(params.plan), { store, adapter } = params, key = collectionCommandKey(plan)
  return store.exclusive(key, async () => {
    let previous = store.read(key)
    if (previous) {
      const query = await observed(adapter, previous)
      if (query.status === 'SUCCEEDED' || query.status === 'FAILED') previous = saved(store, key, { ...previous, packet: { ...previous.packet, phase: query.status } })
      check(terminal(previous) && (previous.packet.phase === 'CANCELLED' ? query.status === 'MISSING' : query.status === previous.packet.phase), 'RECOVERY_REQUIRED')
    }
    const record = parseCollectionCommandRecord(await adapter.prepare(plan))
    check(same(record.plan, plan) && record.packet.phase === 'PREPARED' && record.packet.signature === null, 'PREPARATION_CHANGED')
    return saved(store, key, record)
  })
}
/** Only an explicit resume enters signing/broadcast. Cold discovery is query
 * only. An unknown SIGNING/SIGNED request remains the same packet forever. */
export async function runCollectionCommand(params: {
  record: CollectionCommandRecord; store: CollectionCommandStore; adapter: CollectionCommandAdapter
  mode: 'query' | 'resume' | 'cancel-unsigned'
}): Promise<CollectionCommandQuery & { record: CollectionCommandRecord }> {
  const selected = parseCollectionCommandRecord(params.record), { store, adapter, mode } = params, key = collectionCommandKey(selected.plan)
  return store.exclusive(key, async () => {
    let record = store.read(key); check(record && frozen(record) === frozen(selected), 'SELECTED_PACKET_CHANGED')
    const save = (next: CollectionCommandRecord) => { record = saved(store, key, next) }
    const query = await observed(adapter, record)
    if (query.status === 'SUCCEEDED' || query.status === 'FAILED') save({ ...record, packet: { ...record.packet, phase: query.status } })
    if (mode === 'query' || terminal(record) || query.status === 'PENDING') return { ...query, record }
    if (mode === 'cancel-unsigned') {
      check(record.packet.phase === 'PREPARED' && record.packet.signature === null && query.status === 'MISSING', 'CANNOT_CANCEL_UNKNOWN_SIGNATURE')
      save({ ...record, packet: { ...record.packet, phase: 'CANCELLED' } }); return { ...query, record }
    }
    await adapter.preflight(record, record.packet.phase !== 'SIGNED')
    if (record.packet.phase !== 'SIGNED') {
      save({ ...record, packet: { ...record.packet, phase: 'SIGNING' } })
      const signed = await adapter.sign(record); check(signed.bytes === record.packet.bytes, 'WALLET_CHANGED_BYTES')
      const next = parseCollectionCommandRecord({ ...record, packet: { ...record.packet, phase: 'SIGNED', signature: signed.signature } })
      await adapter.verifySignature(next)
      save(next) // Persist a late wallet result before checking lifecycle again.
    }
    await adapter.preflight(record, false); await adapter.verifySignature(record)
    await adapter.broadcast(record)
    const result = await observed(adapter, record)
    if (result.status === 'SUCCEEDED' || result.status === 'FAILED') save({ ...record, packet: { ...record.packet, phase: result.status } })
    return { ...result, record }
  })
}
export async function importCollectionCommand(params: { input: unknown; collectionId: string; store: CollectionCommandStore; adapter: CollectionCommandAdapter }) {
  const r = parseCollectionCommandRecord(params.input), { store, adapter } = params
  check(r.plan.request.collectionId === params.collectionId, 'IMPORT_COLLECTION_MISMATCH')
  if (r.packet.signature) await adapter.verifySignature(r)
  const query = await observed(adapter, r), key = collectionCommandKey(r.plan)
  return store.exclusive(key, async () => {
    const prior = store.read(key)
    if (prior) { check(frozen(prior) === frozen(r) && same(prior.packet, r.packet), 'IMPORT_CONFLICT'); return prior }
    const record = query.status === 'SUCCEEDED' || query.status === 'FAILED' ? { ...r, packet: { ...r.packet, phase: query.status } } : r
    return saved(store, key, record, true)
  })
}
