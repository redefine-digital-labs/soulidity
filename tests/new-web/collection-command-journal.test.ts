import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { collectionCommandTestDom, type CollectionCommandTestDom } from './fixtures/collection-command-dom'
import { Transaction } from '@mysten/sui/transactions'
import { CollectionPersonalKioskCapBcs } from '@soulidity/sdk'
import { bcs } from '@mysten/sui/bcs'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { activityEvidenceFixture, activityGenesis } from './fixtures/activity-transaction-evidence'
import { collectionBuyFixture } from './fixtures/collection-buy'
import { browserCollectionBuyStore, collectionBuyKey, prepareCollectionBuy, runCollectionBuy } from '../../web/lib/collections/collection-buy-journal'
import { prepareCollectionCommandPlan } from '../../web/lib/collections/collection-command-state'
import { addressGasWindow, collectionCommandFixture, cid } from './fixtures/collection-command'
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


async function expiryCheckpoint(client: Awaited<ReturnType<typeof collectionCommandFixture>>['client'],
  candidate?: Awaited<ReturnType<typeof activityEvidenceFixture>>) {
  const expiry = await activityEvidenceFixture()
  expiry.summaryData.epoch = '11'
  expiry.summaryData.sequence_number = '812'
  expiry.rehashSummary()
  expiry.checkpoint.signature = { epoch: 11n, signature: new Uint8Array(48).fill(1), bitmap: new Uint8Array([1]) }
  const read = client.ledgerService.getCheckpoint.getMockImplementation()!
  client.ledgerService.getCheckpoint.mockImplementation(async request => {
    const id = request.checkpointId
    if (id?.oneofKind === undefined || id.sequenceNumber === 812n) return { response: { checkpoint: expiry.checkpoint } }
    if (candidate && id.sequenceNumber === 800n) return { response: { checkpoint: candidate.checkpoint } }
    return read(request)
  })
  return expiry
}

it('retires an address-gas Collection purchase only after proving the exact payment Coin and archives before replacement', async () => {
  const f = await collectionBuyFixture({ addressGas: true, newKiosk: true })
  const store = browserCollectionBuyStore(), key = collectionBuyKey(f.plan)
  await store.exclusive(key, async () => store.write(key, f.record, true))
  const expiry = await expiryCheckpoint(f.client), coinId = f.plan.paymentCoinIds[0], row = f.current.get(coinId)
  const index = vi.fn(async (_url, request: RequestInit) => {
    expect(JSON.parse(String(request.body)).variables).toMatchObject({ coin: coinId, digest: f.record.packet.digest })
    return new Response(JSON.stringify({ data: { chainIdentifier: activityGenesis, checkpoint: {
      sequenceNumber: 812, epoch: { epochId: 11 }, digest: expiry.checkpoint.digest,
      query: { transaction: null, object: { address: coinId, version: 11, digest: row.digest, objectBcs: toBase64(row.bcs.value) } },
    } } }))
  })
  vi.stubGlobal('fetch', index)
  const retire = () => runCollectionBuy({ ...f, store, mode: 'retire' })
  // The first exact lookup misses, the original is found again after the witness.
  f.client.ledgerService.getTransaction.mockRejectedValueOnce({ code: 'NOT_FOUND' })
  await expect(retire()).rejects.toThrow('RETIREMENT_ORIGINAL_FOUND')
  expect(store.read(key)).toEqual(f.record)
  f.client.ledgerService.getTransaction.mockRejectedValue({ code: 'NOT_FOUND' })
  const { record } = await retire()
  expect(record).toMatchObject({ packet: { ...f.record.packet, phase: 'RETIRED' },
    retirement: { checkpoint: { epoch: '11', sequenceNumber: '812' }, objectId: coinId } })
  expect(store.read(key)).toEqual(record)
  const readIndex = index.getMockImplementation()!
  index.mockRejectedValueOnce(Error('INDEX_UNAVAILABLE'))
  await expect(prepareCollectionBuy({ ...f, store })).rejects.toThrow('INDEX_UNAVAILABLE')
  expect(store.read(key)).toEqual(record)
  expect(store.history(key)).toEqual([])
  index.mockImplementation(readIndex)
  f.client.ledgerService.getEpoch.mockResolvedValue({ response: { epoch: { epoch: 11n } } })
  const next = await prepareCollectionBuy({ ...f, store })
  expect(next.packet).toMatchObject({ phase: 'PREPARED', signature: null, expirationEpoch: '12' })
  expect(next.packet.digest).not.toBe(record.packet.digest)
  expect(store.history(key)).toEqual([record])
  await expect(runCollectionBuy({ record, store, adapter: f.adapter, mode: 'query' })).resolves.toMatchObject({ status: 'MISSING', record })
  expect(f.sign).not.toHaveBeenCalled()
  expect(f.client.core.executeTransaction).not.toHaveBeenCalled()
})

it('uses an exact conflicting Personal Kiosk Cap spend to retire an address-gas Collection seller original', async () => {
  const f = await collectionCommandFixture('reprice', { addressGas: true })
  const store = browserCollectionCommandStore(), key = collectionCommandKey(f.plan)
  const cap = f.rows.get(f.cap.id + ':11'), spend = await activityEvidenceFixture({ empty: true })
  const tx = new Transaction()
  tx.setSender(f.author); tx.setGasOwner(f.author); tx.setGasPrice(1); tx.setGasBudget(1000); tx.setGasPayment([])
  tx.setExpiration({ ValidDuring: addressGasWindow })
  tx.moveCall({ target: `${cid(811)}::test::use_cap`, arguments: [tx.objectRef({ objectId: cap.objectId, version: '11', digest: cap.digest })] })
  spend.summaryData.epoch = '9'
  spend.summaryData.sequence_number = '800'
  Object.assign(spend.transactionData.V1, bcs.TransactionData.parse(await tx.build()).V1)
  spend.rehashTransaction()
  const candidate = spend.ledger.digest as string
  const raw = bcs.Object.parse(cap.bcs.value), next = f.full(cap.objectId, cap.objectType, CollectionPersonalKioskCapBcs,
    f.cap, raw.owner, '12', candidate)
  Object.assign(spend.effectsData.V2!, { executedEpoch: '9', lamportVersion: '12', gasObjectIndex: null,
    changedObjects: [[cap.objectId, { inputState: { Exist: [['11', cap.digest], raw.owner] },
      outputState: { ObjectWrite: [next.digest, raw.owner] }, idOperation: { None: true } }]] })
  spend.rehashEffects()
  await expiryCheckpoint(f.client, spend)
  const readCandidate = async ({ digest }: { digest: string }) => {
    if (digest === candidate) return { response: { transaction: structuredClone(spend.ledger) } }
    throw { code: 'NOT_FOUND' }
  }
  f.client.ledgerService.getTransaction.mockImplementation(readCandidate)
  const fetch = vi.fn().mockRejectedValue(Error('INDEX_UNAVAILABLE'))
  vi.stubGlobal('fetch', fetch)
  await store.exclusive(key, async () => store.write(key, f.record, true))
  const retire = (conflictDigest: string) => runCollectionCommand({ ...f, store, mode: 'retire', conflictDigest })
  await expect(retire(f.record.packet.digest)).rejects.toThrow('RETIREMENT_CONFLICT_DIGEST')
  expect(store.read(key)).toEqual(f.record)
  const { record } = await retire(candidate)
  expect(record).toMatchObject({ packet: { ...f.record.packet, phase: 'RETIRED' }, retirement: {
    objectId: cap.objectId, conflict: { digest: candidate, checkpoint: '800' },
  } })
  expect(fetch).not.toHaveBeenCalled()

  f.current.set(cap.objectId, next)
  const plan = await prepareCollectionCommandPlan(f.params)
  f.client.ledgerService.getEpoch.mockResolvedValue({ response: { epoch: { epoch: 11n } } })
  const prepared = await prepareCollectionCommand({ plan, store, adapter: f.adapter })
  expect(prepared.packet).toMatchObject({ phase: 'PREPARED', signature: null, expirationEpoch: '12' })
  expect(prepared.packet.digest).not.toBe(record.packet.digest)
  expect(store.history(key)).toEqual([record])
  await expect(runCollectionCommand({ record, store, adapter: f.adapter, mode: 'query' })).resolves.toMatchObject({ status: 'MISSING', record })
  expect(f.sign).not.toHaveBeenCalled()
  expect(f.client.core.executeTransaction).not.toHaveBeenCalled()
})
