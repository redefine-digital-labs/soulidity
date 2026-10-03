import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { collectionCommandTestDom, type CollectionCommandTestDom } from './fixtures/collection-command-dom'
import { bcs } from '@mysten/sui/bcs'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { collectionCommandFixture, cid } from './fixtures/collection-command'
import { browserCollectionCommandStore, collectionCommandKey, prepareCollectionCommand, runCollectionCommand, importCollectionCommand } from '../../web/lib/collections/collection-command-journal'
import { collectionCommandHash, parseCollectionCommandPlan, type CollectionCommandRecord, type CollectionCommandQuery } from '../../web/lib/collections/collection-command-plan'
import type { CollectionCommandAdapter } from '../../web/lib/collections/collection-command-operation'

let dom: CollectionCommandTestDom
beforeEach(() => {
  dom = collectionCommandTestDom('https://collection.example.test')
  vi.stubGlobal('window', dom.window); vi.stubGlobal('navigator', dom.window.navigator)
  window.localStorage.clear(); const locked = new Set<string>()
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request: async (key: string, _options: unknown, callback: (lock: unknown) => Promise<unknown>) => {
      if (locked.has(key)) return callback(null)
      locked.add(key); try { return await callback({ name: key }) } finally { locked.delete(key) }
    },
  } })
})
afterEach(() => { vi.restoreAllMocks(); dom.window.close(); vi.unstubAllGlobals() })
async function setup(action: 'list' | 'reprice' | 'delist' = 'list') {
  const f = await collectionCommandFixture(action), store = browserCollectionCommandStore(), key = collectionCommandKey(f.plan)
  const prepared: CollectionCommandRecord = { ...f.record, packet: { ...f.record.packet, phase: 'PREPARED', signature: null } }
  const order: string[] = [], result: CollectionCommandQuery = { status: 'MISSING' }
  const adapter: CollectionCommandAdapter = { prepare: vi.fn(async () => { order.push('prepare'); return prepared }),
    query: vi.fn(async () => { order.push('query'); return structuredClone(result) }),
    preflight: vi.fn(async () => { order.push('preflight') }),
    sign: vi.fn(async () => { order.push('sign'); expect(store.read(key)?.packet.phase).toBe('SIGNING'); return { bytes: prepared.packet.bytes, signature: f.record.packet.signature! } }),
    verifySignature: vi.fn(async () => { order.push('verify') }), broadcast: vi.fn(async () => { order.push('broadcast'); expect(store.read(key)?.packet.phase).toBe('SIGNED') }),
  }
  return { ...f, prepared, store, key, adapter, order, result }
}
it('prepares durable exact bytes without a wallet prompt, then explicit resume is query first', async () => {
  const f = await setup(), record = await prepareCollectionCommand(f)
  expect(f.store.read(f.key)).toEqual(record); expect(f.order).toEqual(['prepare'])
  await runCollectionCommand({ ...f, record, mode: 'resume' })
  expect(f.order).toEqual(['prepare', 'query', 'preflight', 'sign', 'verify', 'preflight', 'verify', 'broadcast', 'query'])
  expect(f.store.read(f.key)?.packet.phase).toBe('SIGNED')
})
it.each(['PREPARED', 'SIGNING', 'SIGNED'] as const)('cold %s query does not prepare, sign, broadcast or delete', async phase => {
  const f = await setup(), record = phase === 'SIGNED' ? f.record : { ...f.prepared, packet: { ...f.prepared.packet, phase } }
  await f.store.exclusive(f.key, async () => f.store.write(f.key, record, true))
  const reopened = browserCollectionCommandStore(), restored = reopened.discover(f.c.id)[0]
  expect(restored).toEqual(record)
  await runCollectionCommand({ record: restored, store: reopened, adapter: f.adapter, mode: 'query' })
  expect(f.order).toEqual(['query']); expect(reopened.read(f.key)?.packet.bytes).toBe(record.packet.bytes)
})
it('storage failure blocks wallet signing and does not fall back to memory', async () => {
  const f = await setup()
  vi.spyOn(window.Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota exceeded') })
  await expect(prepareCollectionCommand(f)).rejects.toThrow('Quota exceeded')
  expect(f.adapter.sign).not.toHaveBeenCalled(); expect(f.adapter.broadcast).not.toHaveBeenCalled()
})
it('readback failure blocks signing', async () => {
  const f = await setup(), original = window.Storage.prototype.getItem
  vi.spyOn(window.Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key) { return key === f.key && original.call(this, key) !== null ? null : original.call(this, key) })
  await expect(prepareCollectionCommand(f)).rejects.toThrow('JOURNAL_READBACK_FAILED')
  expect(f.adapter.sign).not.toHaveBeenCalled()
})
it('cross-tab lock rejects parallel work on the same Collection and author', async () => {
  const f = await setup(), other = browserCollectionCommandStore(); let unlock!: () => void
  const pending = f.store.exclusive(f.key, () => new Promise<void>(resolve => { unlock = resolve }))
  await expect(other.exclusive(f.key, async () => {})).rejects.toThrow('JOURNAL_BUSY'); unlock(); await pending
})
it('unknown old callable release blocks a second request through the same scope head', async () => {
  const f = await setup(); await prepareCollectionCommand(f)
  const p = structuredClone(f.plan), old = p.objects.find(row => row.objectId === p.target.callablePackageId)!, raw = bcs.Object.parse(fromBase64(old.bcs))
  p.target.callablePackageId = cid(123); old.objectId = cid(123); raw.data.Package!.id = cid(123)
  old.bcs = toBase64(bcs.Object.serialize(raw).toBytes()); old.digest = collectionCommandHash('Object', fromBase64(old.bcs)); p.target.callableDigest = old.digest
  const next = parseCollectionCommandPlan(p)
  expect(collectionCommandKey(next)).toBe(f.key)
  await expect(prepareCollectionCommand({ ...f, plan: next })).rejects.toThrow('RECOVERY_REQUIRED')
  expect(f.adapter.prepare).toHaveBeenCalledTimes(1); expect(f.store.read(f.key)?.plan.target).toEqual(f.target)
})
it('unknown signed request resumes the same signature and never rebuilds or re-signs', async () => {
  const f = await setup(); await f.store.exclusive(f.key, async () => f.store.write(f.key, f.record, true))
  await runCollectionCommand({ ...f, mode: 'resume' })
  expect(f.adapter.prepare).not.toHaveBeenCalled(); expect(f.adapter.sign).not.toHaveBeenCalled()
  expect(f.adapter.broadcast).toHaveBeenCalledWith(f.record)
})
it('known pending execution is query-only even when resume was clicked', async () => {
  const f = await setup(); await prepareCollectionCommand(f); f.result.status = 'PENDING'; f.order.length = 0
  await runCollectionCommand({ ...f, record: f.prepared, mode: 'resume' })
  expect(f.order).toEqual(['query'])
})
it.each(['SIGNING', 'SIGNED'] as const)('cannot cancel an unknown %s packet', async phase => {
  const f = await setup(), record = phase === 'SIGNED' ? f.record : { ...f.prepared, packet: { ...f.prepared.packet, phase } }
  await f.store.exclusive(f.key, async () => f.store.write(f.key, record, true))
  await expect(runCollectionCommand({ ...f, record, mode: 'cancel-unsigned' })).rejects.toThrow('CANNOT_CANCEL_UNKNOWN_SIGNATURE')
  expect(f.store.read(f.key)).toEqual(record)
})
it('unsigned cancellation retains bytes and archives before an explicit fresh preparation', async () => {
  const f = await setup(); await prepareCollectionCommand(f)
  const cancelled = await runCollectionCommand({ ...f, record: f.prepared, mode: 'cancel-unsigned' })
  expect(cancelled.record.packet.phase).toBe('CANCELLED'); expect(cancelled.record.packet.bytes).toBe(f.prepared.packet.bytes)
  await prepareCollectionCommand(f)
  expect(f.store.history(f.key)).toEqual([cancelled.record]); expect(f.store.read(f.key)?.packet.phase).toBe('PREPARED')
})
it('signer rejection leaves a SIGNING recovery packet, not a false cancellation', async () => {
  const f = await setup(); await prepareCollectionCommand(f)
  vi.mocked(f.adapter.sign).mockRejectedValueOnce(new Error('Wallet closed'))
  await expect(runCollectionCommand({ ...f, record: f.prepared, mode: 'resume' })).rejects.toThrow('Wallet closed')
  expect(f.store.read(f.key)?.packet.phase).toBe('SIGNING'); expect(f.adapter.broadcast).not.toHaveBeenCalled()
})
it('persists a valid late signature before a changed lifecycle blocks broadcast', async () => {
  const f = await setup(); await prepareCollectionCommand(f); let changed = false
  vi.mocked(f.adapter.sign).mockImplementation(async () => { changed = true; return { bytes: f.record.packet.bytes, signature: f.record.packet.signature! } })
  vi.mocked(f.adapter.preflight).mockImplementation(async () => { if (changed) throw new Error('Wallet/client/release ABA') })
  await expect(runCollectionCommand({ ...f, record: f.prepared, mode: 'resume' })).rejects.toThrow('Wallet/client/release ABA')
  expect(f.store.read(f.key)?.packet).toEqual(f.record.packet); expect(f.adapter.broadcast).not.toHaveBeenCalled()
})
it('network timeout after broadcast leaves original signed bytes queryable on a cold store', async () => {
  const f = await setup(); await prepareCollectionCommand(f)
  vi.mocked(f.adapter.broadcast).mockRejectedValueOnce(new Error('Network timeout'))
  await expect(runCollectionCommand({ ...f, record: f.prepared, mode: 'resume' })).rejects.toThrow('Network timeout')
  const restored = browserCollectionCommandStore().read(f.key)!
  expect(restored.packet).toEqual(f.record.packet)
  await runCollectionCommand({ ...f, record: restored, mode: 'query' }); expect(f.adapter.prepare).toHaveBeenCalledTimes(1)
})
it('query reconciliation is monotone and contradictory terminal results remain errors', async () => {
  const f = await setup(); await prepareCollectionCommand(f); f.result.status = 'SUCCEEDED'; f.result.checkpoint = '42'
  const complete = await runCollectionCommand({ ...f, record: f.prepared, mode: 'query' })
  expect(complete.record.packet.phase).toBe('SUCCEEDED'); f.result.status = 'MISSING'
  await expect(runCollectionCommand({ ...f, record: complete.record, mode: 'query' })).rejects.toThrow('JOURNAL_RESULT_UNCONFIRMED')
  expect(f.store.read(f.key)?.packet.phase).toBe('SUCCEEDED')
})
it('export/import roundtrip is query-only and verifies retained signatures before admission', async () => {
  const f = await setup(), input = JSON.parse(JSON.stringify(f.record))
  const restored = await importCollectionCommand({ ...f, input, collectionId: f.c.id })
  expect(restored).toEqual(f.record); expect(f.order).toEqual(['verify', 'query'])
  expect(f.adapter.sign).not.toHaveBeenCalled(); expect(f.adapter.broadcast).not.toHaveBeenCalled()
  await expect(importCollectionCommand({ ...f, input, collectionId: cid(1) })).rejects.toThrow('IMPORT_COLLECTION_MISMATCH')
})
it('unknown schema/corrupt local heads fail closed instead of disappearing from discovery', async () => {
  const f = await setup(); window.localStorage.setItem(f.key, JSON.stringify({ ...f.record, schema: 'future.v99' }))
  expect(() => f.store.discover(f.c.id)).toThrow('RECORD_SCHEMA')
  await expect(prepareCollectionCommand(f)).rejects.toThrow('RECORD_SCHEMA')
  expect(window.localStorage.getItem(f.key)).toContain('future.v99')
})
