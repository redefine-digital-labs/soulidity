import { parseCollectionBuyPlan, type CollectionBuyPlan, type CollectionBuyRecord, type CollectionBuyQuery } from './collection-buy-plan'
import { parseCollectionBuyRecord, type CollectionBuyAdapter } from './collection-buy-operation'
import { publicMutationCanonical as canonical } from '../sui/public-mutation-journal'
import { same } from './collection-command-plan'
function check(value: unknown, code: string): asserts value { if (!value) throw new Error(`COLLECTION_BUY_${code}`) }

export const COLLECTION_BUY_CHANGED = 'soulidity:collection-buy-changed'
const PREFIX = 'soulidity.collection-buy:'
const terminal = (r: CollectionBuyRecord) => ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(r.packet.phase)
export function collectionBuyKey(p: CollectionBuyPlan) {
  return `${PREFIX}${p.target.chainIdentifier}:${p.request.collectionId}:${p.author}`
}
const frozen = (r: CollectionBuyRecord) => canonical({ schema: r.schema, plan: r.plan, bytes: r.packet.bytes,
  digest: r.packet.digest, expirationEpoch: r.packet.expirationEpoch })
export interface CollectionBuyStore {
  exclusive<T>(key: string, work: () => Promise<T>): Promise<T>
  read(key: string): CollectionBuyRecord | null
  write(key: string, record: CollectionBuyRecord, imported?: boolean): void
  discover(collectionId: string): CollectionBuyRecord[]
  history(key: string): CollectionBuyRecord[]
}
/** One lock/head across callable releases for each chain + Collection + buyer.
 * Storage errors fail closed. Unknown payments cannot be replaced by a new listing/quote/release. Public exact bytes are retained without TTL,
 * deletion, silent memory fallback or automatic rebuilding. */
export function browserCollectionBuyStore(): CollectionBuyStore {
  check(typeof window !== 'undefined' && typeof navigator !== 'undefined' && navigator.locks?.request, 'PERSISTENT_STORAGE_AND_LOCKS_REQUIRED')
  const storage = window.localStorage, held = new Set<string>(), maxSize = 3 * 1024 * 1024, maxRecords = 128
  function readAt(name: string, key: string) {
    const raw = storage.getItem(name); if (raw === null) return null
    check(raw.length > 0 && raw.length <= maxSize, 'JOURNAL_BUDGET')
    const record = parseCollectionBuyRecord(JSON.parse(raw)); check(collectionBuyKey(record.plan) === key, 'JOURNAL_SCOPE'); return record
  }
  function persist(name: string, record: CollectionBuyRecord) {
    const encoded = canonical(record); check(encoded.length <= maxSize, 'JOURNAL_BUDGET')
    storage.setItem(name, encoded); check(storage.getItem(name) === encoded, 'JOURNAL_READBACK_FAILED')
  }
  function archive(key: string, record: CollectionBuyRecord) {
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
      const record = parseCollectionBuyRecord(input); check(collectionBuyKey(record.plan) === key, 'JOURNAL_SCOPE')
      const old = readAt(key, key)
      if (!old) check(imported || record.packet.phase === 'PREPARED' && record.packet.signature === null, 'JOURNAL_INITIAL_PHASE')
      else if (frozen(old) === frozen(record) && !(old.packet.phase === 'CANCELLED' && record.packet.phase === 'PREPARED' && !imported)) {
        const transitions: Record<CollectionBuyRecord['packet']['phase'], string[]> = {
          PREPARED: ['PREPARED', 'SIGNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'], SIGNING: ['SIGNING', 'SIGNED', 'SUCCEEDED', 'FAILED'],
          SIGNED: ['SIGNED', 'SUCCEEDED', 'FAILED'], SUCCEEDED: ['SUCCEEDED'], FAILED: ['FAILED'], CANCELLED: ['CANCELLED', 'SUCCEEDED', 'FAILED'],
        }
        check(transitions[old.packet.phase].includes(record.packet.phase) && (old.packet.signature === null || old.packet.signature === record.packet.signature), 'JOURNAL_TRANSITION')
        check(old.packet.signature !== null || record.packet.signature === null || old.packet.phase === 'SIGNING' && record.packet.phase === 'SIGNED', 'JOURNAL_SIGNATURE')
      } else {
        check(terminal(old) && !imported && record.packet.phase === 'PREPARED' && record.packet.signature === null, 'JOURNAL_RECOVERY_REQUIRED')
        archive(key, old)
      }
      persist(key, record); window.dispatchEvent(new window.Event(COLLECTION_BUY_CHANGED))
    },
    discover: collectionId => {
      const result: CollectionBuyRecord[] = []
      for (let index = 0; index < storage.length; index++) {
        const name = storage.key(index); if (!name?.startsWith(PREFIX) || name.includes(':history:')) continue
        const parts = name.slice(PREFIX.length).split(':')
        if (parts.length !== 3 || parts[1] !== collectionId) continue
        const record = readAt(name, name); check(record && record.plan.request.collectionId === collectionId, 'JOURNAL_SCOPE')
        result.push(record); check(result.length <= maxRecords, 'JOURNAL_LIST_BUDGET')
      }
      return result.sort((a, b) => collectionBuyKey(a.plan).localeCompare(collectionBuyKey(b.plan)))
    },
    history: key => {
      const result: CollectionBuyRecord[] = [], start = `${key}:history:`
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
async function observed(adapter: CollectionBuyAdapter, record: CollectionBuyRecord) {
  const result = await adapter.query(record)
  check(['MISSING', 'PENDING', 'SUCCEEDED', 'FAILED'].includes(result.status), 'JOURNAL_QUERY_INVALID')
  if (['SUCCEEDED', 'FAILED'].includes(record.packet.phase)) check(result.status === record.packet.phase, 'JOURNAL_RESULT_UNCONFIRMED')
  return result
}
function saved(store: CollectionBuyStore, key: string, record: CollectionBuyRecord, imported = false) {
  const value = parseCollectionBuyRecord(record); store.write(key, value, imported)
  check(same(store.read(key), value), 'JOURNAL_READBACK_FAILED'); return value
}
export async function prepareCollectionBuy(params: { plan: CollectionBuyPlan; store: CollectionBuyStore; adapter: CollectionBuyAdapter }) {
  const plan = parseCollectionBuyPlan(params.plan), { store, adapter } = params, key = collectionBuyKey(plan)
  return store.exclusive(key, async () => {
    let previous = store.read(key)
    if (previous) {
      const query = await observed(adapter, previous)
      if (query.status === 'SUCCEEDED' || query.status === 'FAILED') previous = saved(store, key, { ...previous, packet: { ...previous.packet, phase: query.status } })
      check(terminal(previous) && (previous.packet.phase === 'CANCELLED' ? query.status === 'MISSING' : query.status === previous.packet.phase), 'RECOVERY_REQUIRED')
    }
    const record = parseCollectionBuyRecord(await adapter.prepare(plan))
    check(same(record.plan, plan) && record.packet.phase === 'PREPARED' && record.packet.signature === null, 'PREPARATION_CHANGED')
    return saved(store, key, record)
  })
}
/** Only an explicit resume enters signing/broadcast. Cold discovery is query
 * only. An unknown SIGNING/SIGNED request remains the same packet forever. */
export async function runCollectionBuy(params: {
  record: CollectionBuyRecord; store: CollectionBuyStore; adapter: CollectionBuyAdapter
  mode: 'query' | 'resume' | 'cancel-unsigned'
}): Promise<CollectionBuyQuery & { record: CollectionBuyRecord }> {
  const selected = parseCollectionBuyRecord(params.record), { store, adapter, mode } = params, key = collectionBuyKey(selected.plan)
  return store.exclusive(key, async () => {
    let record = store.read(key)
    if (!same(record, selected)) {
      const archived = store.history(key).find(prior => same(prior, selected))
      if (archived) {
        check(mode === 'query', 'ARCHIVED_PACKET_QUERY_ONLY')
        check(terminal(archived), 'JOURNAL_ARCHIVE_INVALID')
        return { ...await observed(adapter, archived), record: archived }
      }
    }
    check(record && frozen(record) === frozen(selected), 'SELECTED_PACKET_CHANGED')
    const save = (next: CollectionBuyRecord) => { record = saved(store, key, next) }
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
      const next = parseCollectionBuyRecord({ ...record, packet: { ...record.packet, phase: 'SIGNED', signature: signed.signature } })
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
export async function importCollectionBuy(params: { input: unknown; collectionId: string; store: CollectionBuyStore; adapter: CollectionBuyAdapter }) {
  const r = parseCollectionBuyRecord(params.input), { store, adapter } = params
  check(r.plan.request.collectionId === params.collectionId, 'IMPORT_COLLECTION_MISMATCH')
  if (r.packet.signature) await adapter.verifySignature(r)
  const query = await observed(adapter, r), key = collectionBuyKey(r.plan)
  return store.exclusive(key, async () => {
    const prior = store.read(key)
    if (prior) { check(frozen(prior) === frozen(r) && same(prior.packet, r.packet), 'IMPORT_CONFLICT'); return prior }
    const record = query.status === 'SUCCEEDED' || query.status === 'FAILED' ? { ...r, packet: { ...r.packet, phase: query.status } } : r
    return saved(store, key, record, true)
  })
}
