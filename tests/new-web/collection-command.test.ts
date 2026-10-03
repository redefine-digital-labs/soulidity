import { afterEach, describe, expect, it, vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { SoulPublicCollectionBcs, SoulPublicCollectionRightBcs, SoulPublicMarketConfigBcs, CollectionPersonalKioskCapBcs,
  CollectionKioskRegistrationFieldBcs, CollectionKioskListingFieldBcs, CollectionPublicListingBcs } from '@soulidity/sdk'
import { parseCollectionCommandPlan, collectionCommandRaw, collectionCommandHash, collectionCommandMarker, type CollectionCommandRequest } from '../../web/lib/collections/collection-command-plan'
import { prepareCollectionCommandPlan, assertCollectionCommandCurrent } from '../../web/lib/collections/collection-command-state'
import { parseCollectionCommandRecord, buildCollectionCommandTransaction } from '../../web/lib/collections/collection-command-operation'
import { proveCollectionCommandHistory } from '../../web/lib/collections/collection-command-history'
import { collectionCommandFixture, cid } from './fixtures/collection-command'

afterEach(() => vi.restoreAllMocks())
const actions: CollectionCommandRequest['action'][] = ['list', 'reprice', 'delist']
describe('Collection command raw plan and exact packet', () => {
  it.each(['replace', 'mutate'] as const)('captures complete historical inputs before first await: %s', async kind => {
    const f = await collectionCommandFixture(), params = { client: f.client as never, record: structuredClone(f.record), effects: structuredClone(f.effects),
      events: new Uint8Array(f.evidence.ledger.events.bcs.value), signal: new AbortController().signal }
    const promise = proveCollectionCommandHistory(params)
    if (kind === 'replace') { params.effects = {} as never; params.record = {} as never; params.events = new Uint8Array(); params.client = {} as never }
    else { params.effects.V2!.changedObjects.length = 0; params.record.packet.digest = ''; params.events.fill(0) }
    expect(await promise).toMatchObject({ collectionId: f.c.id, newListingId: f.newListing!.id })
  })
  it('does not bind decoded Success to a later mutated Failure checkpoint buffer', async () => {
    const f = await collectionCommandFixture(), response = structuredClone(f.evidence.ledger)
    f.client.ledgerService.getTransaction.mockImplementation(async () => ({ response: { transaction: response } }))
    const checkpoint = f.client.ledgerService.getCheckpoint.getMockImplementation()!
    f.client.ledgerService.getCheckpoint.mockImplementation(async (...args) => {
      f.effects.V2!.status = { $kind: 'Failure', Failure: { error: { $kind: 'InsufficientGas', InsufficientGas: true }, command: null } }
      f.evidence.rehashEffects(); response.effects.bcs.value = f.evidence.ledger.effects.bcs.value
      return checkpoint(...args)
    })
    await expect(f.adapter.query(f.record)).rejects.toThrow('CHECKPOINT_MEMBERSHIP')
  })
  it('isolates complete raw response and original buffers from later transport mutation', async () => {
    const f = await collectionCommandFixture(), response = structuredClone(f.evidence.ledger)
    f.client.ledgerService.getTransaction.mockImplementation(async () => ({ response: { transaction: response } }))
    const checkpoint = f.client.ledgerService.getCheckpoint.getMockImplementation()!
    f.client.ledgerService.getCheckpoint.mockImplementation(async (...args) => {
      response.effects.bcs.value.fill(0); response.events.bcs.value.fill(0); response.transaction.bcs.value.fill(0)
      response.digest = ''; response.effects.status.success = false
      return checkpoint(...args)
    })
    expect((await f.adapter.query(f.record)).status).toBe('SUCCEEDED')
  })
  it.each(actions)('%s verifies full raw custody, builds exact SDK bytes and proves historical effects', async action => {
    const f = await collectionCommandFixture(action)
    expect(parseCollectionCommandRecord(f.record).packet.digest).toBe(f.record.packet.digest)
    expect(Object.isFrozen(parseCollectionCommandPlan(f.plan).expected)).toBe(true)
    await f.adapter.verifySignature(f.record)
    f.client.ledgerService.batchGetObjects.mockClear(); f.getAddress.mockClear(); f.setAddress(null)
    const result = await f.adapter.query(f.record)
    expect(result).toMatchObject({ status: 'SUCCEEDED', checkpoint: '42', receipt: { collectionId: f.c.id, rightId: f.right.id,
      oldListingId: action === 'list' ? null : f.listing.id, newListingId: f.newListing?.id ?? null } })
    expect(f.client.ledgerService.batchGetObjects).not.toHaveBeenCalled(); expect(f.getAddress).not.toHaveBeenCalled()
    expect(f.client.ledgerService.getObject.mock.calls.every(([row]) => row.version !== undefined)).toBe(true)
  })
  it.each(actions)('%s proves exact wrapped PurchaseCap UID lifecycle without allowing unknown effects', async action => {
    for (const mutation of ['missing', 'id-operation', 'standalone-input', 'standalone-output', 'unrelated-uid']) {
      const f = await collectionCommandFixture(action), e = f.effects.V2!, objectId = action === 'list' ? f.newListing!.purchase_cap.id : f.listing.purchase_cap.id
      const entry = e.changedObjects.find(([id]) => id === objectId)!, row = entry[1]
      expect(row.inputState.$kind).toBe('NotExist'); expect(row.outputState.$kind).toBe('NotExist')
      expect(row.idOperation.$kind).toBe(action === 'list' ? 'Created' : 'Deleted')
      if (action === 'reprice') expect(e.changedObjects.find(([id]) => id === f.newListing!.purchase_cap.id)?.[1].idOperation.$kind).toBe('Created')
      if (mutation === 'missing') e.changedObjects = e.changedObjects.filter(([id]) => id !== objectId)
      if (mutation === 'id-operation') row.idOperation = { $kind: 'None', None: true }
      if (mutation === 'standalone-input') row.inputState = structuredClone(e.changedObjects[0][1].inputState)
      if (mutation === 'standalone-output') row.outputState = structuredClone(e.changedObjects[0][1].outputState)
      if (mutation === 'unrelated-uid') entry[0] = cid(888)
      f.evidence.rehashEffects(); await expect(f.adapter.query(f.record)).rejects.toThrow()
    }
  })
  it.each(['list', 'reprice'] as const)('%s rejects new PurchaseCap aliasing the preserved inner personal Kiosk cap', async action => {
    const f = await collectionCommandFixture(action), e = f.effects.V2!, next = { ...f.newListing!, purchase_cap: { ...f.newListing!.purchase_cap, id: f.cap.cap.id } }
    const output = f.full(next.id, f.types.listing, CollectionPublicListingBcs, next, { Shared: { initialSharedVersion: '12' } }, '12', f.record.packet.digest)
    const listing = e.changedObjects.find(([id]) => id === next.id)![1]
    listing.outputState.ObjectWrite![0] = output.digest
    e.changedObjects.find(([id]) => id === f.newListing!.purchase_cap.id)![0] = f.cap.cap.id
    f.evidence.rehashEffects(); await expect(f.adapter.query(f.record)).rejects.toThrow('HISTORY_WRAPPED_CAP_PRESERVATION')
  })
  it.each([false, true])('reprice accepts protocol minimized unchanged-child=%s while proving old inactive/new active', async markerOptimized => {
    const f = await collectionCommandFixture('reprice', { markerOptimized })
    expect((await f.adapter.query(f.record)).status).toBe('SUCCEEDED')
  })
  it('delisting remains possible with the on-chain secondary market paused', async () => {
    const f = await collectionCommandFixture('delist', { paused: true })
    expect(f.plan.expected.marketBcs).toBeNull(); expect(f.plan.objects.some(row => row.objectId === f.target.marketConfigId)).toBe(false)
    expect((await f.adapter.query(f.record)).status).toBe('SUCCEEDED')
  })
  it.each([0, 1, 50, 10000])('quotes exact BASE_PLUS_FEES for %s bps without seller deduction', async feeBps => {
    const f = await collectionCommandFixture('list', { feeBps, price: '9007199254740993' })
    const fee = (9007199254740993n * BigInt(feeBps) + 9999n) / 10000n
    expect(f.plan.quote).toEqual({ priceAtomic: '9007199254740993', feeBps, feeAtomic: String(fee),
      buyerTotalAtomic: String(9007199254740993n + fee), sellerReceivesAtomic: '9007199254740993' })
  })
  it('uses the raw immutable package without redundant package projections', async () => {
    const f = await collectionCommandFixture(); expect(f.current.get(f.target.callablePackageId).package).toBeUndefined()
    expect(await prepareCollectionCommandPlan(f.params)).toEqual(f.plan)
  })
  it('detects canonical bytes falsely labelled with an unchanged digest', async () => {
    const f = await collectionCommandFixture(), row = f.current.get(f.c.id)
    const full = bcs.Object.parse(row.bcs.value), c = SoulPublicCollectionBcs.parse(full.data.Move!.contents)
    c.current_holder = cid(800); full.data.Move!.contents = SoulPublicCollectionBcs.serialize(c).toBytes()
    row.bcs.value = bcs.Object.serialize(full).toBytes(); row.contents.value = full.data.Move!.contents
    await expect(prepareCollectionCommandPlan(f.params)).rejects.toThrow('OBJECT_DIGEST')
  })
  it.each([
    ['holder', (f: Awaited<ReturnType<typeof collectionCommandFixture>>) => f.editCurrent(f.c.id, SoulPublicCollectionBcs, c => { c.current_holder = cid(800) })],
    ['Right root', f => f.editCurrent(f.right.id, SoulPublicCollectionRightBcs, r => { r.collection_id = cid(800) })],
    ['Right creator', f => f.editCurrent(f.right.id, SoulPublicCollectionRightBcs, r => { r.creator = cid(800) })],
    ['registration', f => f.editCurrent(f.regId, CollectionKioskRegistrationFieldBcs, r => { r.value.kiosk_id = cid(800) })],
    ['wrapped cap', f => f.editCurrent(f.cap.id, CollectionPersonalKioskCapBcs, c => { c.cap.for = cid(800) })],
    ['secondary gate', f => f.editCurrent(f.market.id, SoulPublicMarketConfigBcs, m => { m.secondary_enabled = false })],
    ['schema version', f => f.editCurrent(f.c.id, SoulPublicCollectionBcs, c => { c.version = '2' })],
    ['supply', f => f.editCurrent(f.c.id, SoulPublicCollectionBcs, c => { c.current_supply = '2'; c.max_supply = '1' })],
    ['tradeable', f => f.editCurrent(f.c.id, SoulPublicCollectionBcs, c => { c.tradeable = false })],
  ] as Array<[string, (f: Awaited<ReturnType<typeof collectionCommandFixture>>) => void]>)('rejects rehashed %s semantic mismatch', async (_name, mutate) => {
    const f = await collectionCommandFixture(); mutate(f); await expect(prepareCollectionCommandPlan(f.params)).rejects.toThrow()
  })
  it.each(['list', 'reprice'] as const)('%s rejects unavailable market and price overflow', async action => {
    await expect(collectionCommandFixture(action, { paused: true })).rejects.toThrow('SECONDARY_MARKET_UNAVAILABLE')
    await expect(collectionCommandFixture(action, { price: '18446744073709551615' })).rejects.toThrow('QUOTE_MISMATCH')
  })
  it('preserves allowed chain holder ABA with equal frozen values; does not invent a Collection ownership epoch', async () => {
    const f = await collectionCommandFixture()
    f.editCurrent(f.c.id, SoulPublicCollectionBcs, c => { c.current_holder = cid(800) })
    f.editCurrent(f.c.id, SoulPublicCollectionBcs, c => { c.current_holder = f.author })
    expect(await assertCollectionCommandCurrent({ client: f.client as never, plan: f.plan })).toEqual(f.plan)
    expect(f.plan).not.toHaveProperty('ownershipEpoch')
  })
  it('rejects stale candidate rather than silently adopting another active listing', async () => {
    const f = await collectionCommandFixture('reprice')
    f.editCurrent(f.listing.id, CollectionPublicListingBcs, l => { l.is_active = false; l.purchase_cap = null })
    await expect(prepareCollectionCommandPlan(f.params)).rejects.toThrow('ACTIVE_LISTING')
  })
  it('uses exact zero exclusive reservation and absence of ordinary reservation', async () => {
    const f = await collectionCommandFixture('reprice')
    f.editCurrent(f.markerId, CollectionKioskListingFieldBcs, m => { m.value = '1' })
    await expect(prepareCollectionCommandPlan(f.params)).rejects.toThrow('EXCLUSIVE_RESERVATION')
    const g = await collectionCommandFixture(), markerId = collectionCommandMarker(g.kiosk.id, g.right.id, false)
    g.full(markerId, g.types.marker, CollectionKioskListingFieldBcs, { id: markerId, name: { id: g.right.id, is_exclusive: false }, value: '0' }, { ObjectOwner: g.kiosk.id })
    await expect(prepareCollectionCommandPlan(g.params)).rejects.toThrow('ORDINARY_RESERVATION')
  })
  it('treats unavailable dynamic fields as errors, not absent', async () => {
    const f = await collectionCommandFixture()
    f.client.ledgerService.batchGetObjects.mockResolvedValueOnce({ response: { objects: [{ result: { oneofKind: 'error', error: { code: 14 } } }] } })
    await expect(prepareCollectionCommandPlan(f.params)).rejects.toThrow('OBJECT_UNAVAILABLE')
  })
  it.each(['quote', 'pure', 'command', 'sender', 'cap', 'shared', 'gas'] as const)('rejects tampered %s in imported plan/packet', async mode => {
    const f = await collectionCommandFixture('reprice')
    if (mode === 'quote') {
      const record = structuredClone(f.record); record.plan.quote.feeAtomic = '1'; expect(() => parseCollectionCommandRecord(record)).toThrow('QUOTE_MISMATCH'); return
    }
    const record = await f.packet(data => {
      if (mode === 'pure') data.inputs.find(row => row.Pure)!.Pure!.bytes = toBase64(new Uint8Array([1]))
      if (mode === 'command') data.commands.reverse()
      if (mode === 'sender') data.sender = cid(800)
      if (mode === 'cap') data.inputs.find(row => row.Object?.ImmOrOwnedObject)!.Object!.ImmOrOwnedObject!.version = '10'
      if (mode === 'shared') data.inputs.find(row => row.Object?.SharedObject)!.Object!.SharedObject!.initialSharedVersion = '2'
      if (mode === 'gas') data.gasData.payment![0].objectId = f.c.id
    })
    expect(() => parseCollectionCommandRecord(record)).toThrow()
  })
  it('includes root/listing/market guards before the original atomic cancel→list flow', async () => {
    const f = await collectionCommandFixture('reprice')
    expect(buildCollectionCommandTransaction(f.plan).getData().commands.map(c => c.MoveCall?.function)).toEqual([
      'assert_collection_command_snapshot', 'assert_collection_listing_snapshot', 'assert_collection_market_snapshot_v2',
      'cancel_collection_listing', 'ensure_personal_kiosk_registered_v2', 'list_collection_right_fixed_price_v2', 'finalize_collection_listing',
    ])
  })
})

describe('Collection historical proof and adapter', () => {
  it('query requires canonical checkpoint membership even for failed execution', async () => {
    const f = await collectionCommandFixture()
    f.effects.V2!.status = bcs.TransactionEffects.parse(bcs.TransactionEffects.serialize({ V2: { ...f.effects.V2!,
      status: { Failure: { error: { InsufficientGas: true }, command: null } } } }).toBytes()).V2!.status
    f.evidence.rehashEffects(); expect((await f.adapter.query(f.record)).status).toBe('FAILED')
    f.evidence.checkpoint.contents.bcs.value[0] ^= 1
    await expect(f.adapter.query(f.record)).rejects.toThrow()
  })
  it('distinguishes missing, pending and unavailable without current-state guesses', async () => {
    const f = await collectionCommandFixture()
    f.client.ledgerService.getTransaction.mockRejectedValueOnce({ code: 'NOT_FOUND' })
    expect((await f.adapter.query(f.record)).status).toBe('MISSING')
    f.evidence.ledger.checkpoint = undefined; expect((await f.adapter.query(f.record)).status).toBe('PENDING')
    f.client.ledgerService.getTransaction.mockRejectedValueOnce({ code: 'UNAVAILABLE' })
    await expect(f.adapter.query(f.record)).rejects.toEqual({ code: 'UNAVAILABLE' })
  })
  it.each(['event sender', 'event price', 'event order', 'extra event', 'missing root', 'extra effect', 'missing marker', 'gas amount', 'inactive output'] as const)(
    'rejects rehashed historical %s forgery', async mode => {
      const f = await collectionCommandFixture('reprice')
      if (mode === 'event sender') f.evidence.eventsData.data[0].sender = cid(800)
      if (mode === 'event price') f.evidence.eventsData.data[1].contents[167] ^= 1
      if (mode === 'event order') f.evidence.eventsData.data.reverse()
      if (mode === 'extra event') f.evidence.eventsData.data.push(f.evidence.eventsData.data[0])
      if (mode === 'missing root') f.effects.V2!.unchangedConsensusObjects = f.effects.V2!.unchangedConsensusObjects.filter(([id]) => id !== f.c.id)
      if (mode === 'extra effect') f.effects.V2!.changedObjects.push([cid(800), structuredClone(f.effects.V2!.changedObjects[0][1])])
      if (mode === 'missing marker') f.effects.V2!.changedObjects.find(([id]) => id === f.markerId)![1].outputState = { $kind: 'NotExist', NotExist: true }
      if (mode === 'gas amount') f.effects.V2!.gasUsed.computationCost = '10'
      if (mode === 'inactive output') {
        const id = f.newListing!.id, value = { ...f.newListing!, is_active: false, purchase_cap: null }
        const row = f.full(id, f.types.listing, CollectionPublicListingBcs, value, { Shared: { initialSharedVersion: '12' } }, '12', f.record.packet.digest)
        f.effects.V2!.changedObjects.find(([changed]) => changed === id)![1].outputState.ObjectWrite![0] = row.digest
      }
      f.evidence.rehashEvents(); await expect(f.adapter.query(f.record)).rejects.toThrow()
    })
  it('does not accept history output BCS under a false effects digest', async () => {
    const f = await collectionCommandFixture(), row = f.rows.get(`${f.newListing!.id}:12`)
    const raw = bcs.Object.parse(row.bcs.value); raw.data.Move!.contents[10] ^= 1
    row.bcs.value = bcs.Object.serialize(raw).toBytes(); row.contents.value = raw.data.Move!.contents
    await expect(f.adapter.query(f.record)).rejects.toThrow('OBJECT_DIGEST')
  })
  it('prepares, signs exact bytes and broadcasts only the stored signature', async () => {
    const f = await collectionCommandFixture('delist'), prepared = await f.adapter.prepare(f.plan), signed = await f.adapter.sign(prepared)
    const record = { ...prepared, packet: { ...prepared.packet, phase: 'SIGNED' as const, signature: signed.signature } }
    await f.adapter.broadcast(record)
    expect(f.client.core.executeTransaction.mock.calls[0][0]).toEqual({ transaction: fromBase64(prepared.packet.bytes), signatures: [signed.signature] })
  })
  it('rejects changed wallet, expiration, simulation and returned bytes before broadcast', async () => {
    const f = await collectionCommandFixture(); f.setAddress(null)
    await expect(f.adapter.prepare(f.plan)).rejects.toThrow('WALLET_OR_LIFECYCLE_CHANGED'); f.setAddress(f.author)
    f.client.ledgerService.getEpoch.mockResolvedValueOnce({ response: { epoch: { epoch: 11n } } })
    await expect(f.adapter.preflight(f.record, false)).rejects.toThrow('EXPIRED_QUERY_ONLY')
    f.client.transactionExecutionService.simulateTransaction.mockResolvedValueOnce({ response: { transaction: { transaction: { bcs: { value: fromBase64(f.record.packet.bytes) } }, effects: { status: { success: false } } } } })
    await expect(f.adapter.preflight(f.record, false)).rejects.toThrow('SIMULATION_REJECTED')
    f.sign.mockResolvedValueOnce({ bytes: 'AQ==', signature: f.record.packet.signature! })
    await expect(f.adapter.sign({ ...f.record, packet: { ...f.record.packet, phase: 'PREPARED', signature: null } })).rejects.toThrow('WALLET_CHANGED_BYTES')
    expect(f.client.core.executeTransaction).not.toHaveBeenCalled()
  })
  it('rechecks the wallet after asynchronous simulation and before opening the signer', async () => {
    const f = await collectionCommandFixture(), original = f.client.transactionExecutionService.simulateTransaction.getMockImplementation()!
    f.client.transactionExecutionService.simulateTransaction.mockImplementation(async input => {
      const result = await original(input); f.setAddress(cid(333)); return result
    })
    await expect(f.adapter.sign({ ...f.record, packet: { ...f.record.packet, phase: 'PREPARED', signature: null } }))
      .rejects.toThrow('WALLET_OR_LIFECYCLE_CHANGED')
    expect(f.sign).not.toHaveBeenCalled(); expect(f.client.core.executeTransaction).not.toHaveBeenCalled()
  })
})
