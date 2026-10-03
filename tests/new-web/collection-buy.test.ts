import { afterEach, describe, expect, it, vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { SoulPublicCollectionBcs, SoulPublicCollectionRightBcs, SoulPublicMarketConfigBcs, SoulPublicKioskBcs,
  CollectionPersonalKioskCapBcs, CollectionKioskRegistrationFieldBcs, CollectionPublicListingBcs } from '@soulidity/sdk'
import { collectionCommandHash } from '../../web/lib/collections/collection-command-plan'
import { parseCollectionBuyPlan, CollectionBuyCoinBcs, CollectionBuyPolicyBcs, CollectionBuyLockBcs, CollectionBuyOwnerMarkerBcs,
  CollectionBuyRuleBoolBcs, collectionBuyRuleIds, collectionBuyOwnerMarker } from '../../web/lib/collections/collection-buy-plan'
import { prepareCollectionBuyPlan, assertCollectionBuyCurrent } from '../../web/lib/collections/collection-buy-state'
import { parseCollectionBuyRecord, buildCollectionBuyTransaction, createCollectionBuyAdapter } from '../../web/lib/collections/collection-buy-operation'
import { proveCollectionBuyHistory } from '../../web/lib/collections/collection-buy-history'
import { collectionBuyFixture, cid } from './fixtures/collection-buy'

afterEach(() => vi.restoreAllMocks())
type Fixture = Awaited<ReturnType<typeof collectionBuyFixture>>
function historicalEdit(f: Fixture, objectId: string, version: string, codec: { parse(bytes: Uint8Array): any; serialize(value: any): { toBytes(): Uint8Array } },
  mutate: (value: any) => void, owner?: Parameters<typeof bcs.Owner.serialize>[0]) {
  const row = f.rows.get(`${objectId}:${version}`), raw = bcs.Object.parse(row.bcs.value), value = codec.parse(raw.data.Move!.contents); mutate(value)
  const next = f.full(objectId, row.objectType, codec, value, owner ?? raw.owner, version, raw.previousTransaction)
  const full = bcs.Object.parse(next.bcs.value), change = f.effects.V2!.changedObjects.find(([id]) => id === objectId)?.[1]
  if (version === '12') { if (!change?.outputState.ObjectWrite) throw new Error('Output fixture missing'); change.outputState.ObjectWrite = [next.digest, full.owner] }
  else if (change?.inputState.Exist) change.inputState.Exist = [[version, next.digest], full.owner]
  else { const read = f.effects.V2!.unchangedConsensusObjects.find(([id]) => id === objectId)?.[1]; if (!read?.ReadOnlyRoot) throw new Error('Input fixture missing'); read.ReadOnlyRoot = [version, next.digest] }
  f.evidence.rehashEffects()
}
describe('Collection buy exact raw plan and canonical history', () => {
  it.each([false, true])('proves complete purchase with new personal Kiosk=%s', async newKiosk => {
    const f = await collectionBuyFixture({ newKiosk, sellerLocked: true })
    expect(parseCollectionBuyRecord(f.record).packet.digest).toBe(f.record.packet.digest)
    expect(Object.isFrozen(parseCollectionBuyPlan(f.plan).expected)).toBe(true)
    await f.adapter.verifySignature(f.record)
    f.client.ledgerService.batchGetObjects.mockClear(); f.getAddress.mockClear(); f.setAddress(null)
    const result = await f.adapter.query(f.record)
    expect(result).toMatchObject({ status: 'SUCCEEDED', checkpoint: '42', receipt: { collectionId: f.c.id, rightId: f.right.id,
      listingId: f.listing.id, buyerAddress: f.author, buyerKioskId: f.buyerKiosk.id, buyerKioskCapId: f.cap.id,
      sellerAddress: f.sellerKiosk.owner, priceAtomic: '1000001', platformFeeAtomic: '5001', totalPaymentAtomic: '1005002' } })
    expect(f.client.ledgerService.batchGetObjects).not.toHaveBeenCalled(); expect(f.getAddress).not.toHaveBeenCalled()
    expect(f.client.ledgerService.getObject.mock.calls.every(([row]) => row.version !== undefined)).toBe(true)
  })
  it.each([0, 1, 50, 10000])('BASE_PLUS_FEES uses exact ceil and never deducts from seller at %s bps', async feeBps => {
    const price = '9007199254740993', f = await collectionBuyFixture({ price, feeBps, paymentBalances: ['18014398509481986'] })
    const fee = (BigInt(price) * BigInt(feeBps) + 9999n) / 10000n
    expect(f.plan.quote).toEqual({ priceAtomic: price, feeBps, feeAtomic: String(fee), buyerTotalAtomic: String(BigInt(price) + fee), sellerReceivesAtomic: price })
    expect((await f.adapter.query(f.record)).status).toBe('SUCCEEDED')
  })
  it('supports same fee recipient as seller with two exact payouts and zero-change coin', async () => {
    const f = await collectionBuyFixture({ feeRecipientSeller: true, paymentBalances: ['1005002'] })
    expect((await f.adapter.query(f.record)).status).toBe('SUCCEEDED')
  })
  it('proves gas smashing with exact original refs, deleted secondary coin and total net charge', async () => {
    const f = await collectionBuyFixture({ gasBalances: ['10000000', '20000000'] })
    expect((await f.adapter.query(f.record)).status).toBe('SUCCEEDED')
    const secondary = f.effects.V2!.changedObjects.find(([id]) => id === cid(901))![1]
    expect(secondary.inputState.$kind).toBe('Exist'); expect(secondary.outputState.$kind).toBe('NotExist'); expect(secondary.idOperation.$kind).toBe('Deleted')
    secondary.idOperation = { $kind: 'None', None: true }; f.evidence.rehashEffects()
    await expect(f.adapter.query(f.record)).rejects.toThrow('HISTORY_GAS_MERGE')
  })
  it.each([
    ['holder', (f: Fixture) => f.editCurrent(f.c.id, SoulPublicCollectionBcs, c => { c.current_holder = cid(800) })],
    ['Right root', f => f.editCurrent(f.right.id, SoulPublicCollectionRightBcs, r => { r.collection_id = cid(800) })],
    ['Right creator', f => f.editCurrent(f.right.id, SoulPublicCollectionRightBcs, r => { r.creator = cid(800) })],
    ['registration', f => f.editCurrent(f.regId, CollectionKioskRegistrationFieldBcs, r => { r.value.kiosk_id = cid(800) })],
    ['wrapped cap', f => f.editCurrent(f.cap.id, CollectionPersonalKioskCapBcs, c => { c.cap.for = cid(800) })],
    ['secondary gate', f => f.editCurrent(f.market.id, SoulPublicMarketConfigBcs, m => { m.secondary_enabled = false })],
    ['schema', f => f.editCurrent(f.c.id, SoulPublicCollectionBcs, c => { c.version = '2' })],
    ['supply', f => f.editCurrent(f.c.id, SoulPublicCollectionBcs, c => { c.current_supply = '2'; c.max_supply = '1' })],
    ['tradeable', f => f.editCurrent(f.c.id, SoulPublicCollectionBcs, c => { c.tradeable = false })],
    ['listing', f => f.editCurrent(f.listing.id, CollectionPublicListingBcs, l => { l.is_active = false })],
    ['personal owner marker', f => f.editCurrent(collectionBuyOwnerMarker(f.target, f.sellerKiosk.id), CollectionBuyOwnerMarkerBcs, m => { m.value = cid(800) })],
    ['transfer rules', f => f.editCurrent(f.policy.id, CollectionBuyPolicyBcs, p => { p.rules.contents.pop() })],
    ['transfer rule configuration', f => f.editCurrent(collectionBuyRuleIds(f.target)[1], CollectionBuyRuleBoolBcs, r => { r.value = false })],
    ['insufficient coin', f => f.editCurrent(f.paymentCoinObjectIds[0], CollectionBuyCoinBcs, c => { c.balance = '0' })],
  ] as Array<[string, (f: Fixture) => void]>)('rejects rehashed %s mismatch', async (_name, mutate) => {
    const f = await collectionBuyFixture(); mutate(f); await expect(prepareCollectionBuyPlan(f.params)).rejects.toThrow()
  })
  it('rejects false full-object digest despite matching contents projection', async () => {
    const f = await collectionBuyFixture(), row = f.current.get(f.c.id), full = bcs.Object.parse(row.bcs.value)
    const c = SoulPublicCollectionBcs.parse(full.data.Move!.contents); c.current_holder = cid(800)
    full.data.Move!.contents = SoulPublicCollectionBcs.serialize(c).toBytes(); row.bcs.value = bcs.Object.serialize(full).toBytes(); row.contents.value = full.data.Move!.contents
    await expect(prepareCollectionBuyPlan(f.params)).rejects.toThrow('OBJECT_DIGEST')
  })
  it('pins synchronous caller inputs before first await', async () => {
    const f = await collectionBuyFixture(), params = { ...f.params, paymentCoinObjectIds: [...f.paymentCoinObjectIds] }
    const promise = prepareCollectionBuyPlan(params)
    params.client = {} as never; params.paymentCoinObjectIds[0] = cid(999); params.request = { collectionId: cid(999), listingId: cid(998) }
    expect(await promise).toEqual(f.plan)
  })
  it('selects raw validated coins and rereads only selected coins', async () => {
    const f = await collectionBuyFixture(), plan = await prepareCollectionBuyPlan({ ...f.params, paymentCoinObjectIds: undefined })
    expect(plan.paymentCoinIds).toEqual(f.paymentCoinObjectIds)
    expect(f.client.stateService.listOwnedObjects).toHaveBeenCalledOnce()
  })
  it('does not interpret a transport failure as absence or create-new permission', async () => {
    const f = await collectionBuyFixture()
    f.client.ledgerService.batchGetObjects.mockRejectedValueOnce(new Error('network'))
    await expect(prepareCollectionBuyPlan(f.params)).rejects.toThrow('network')
  })
  it('rejects malformed response identity and non-not-found optional errors', async () => {
    const f = await collectionBuyFixture(), original = f.client.ledgerService.batchGetObjects.getMockImplementation()!
    f.client.ledgerService.batchGetObjects.mockImplementationOnce(async input => {
      const response = await original(input)
      if (response.response.objects[0].result.oneofKind === 'object') response.response.objects[0].result.object.objectId = cid(888)
      return response
    })
    await expect(prepareCollectionBuyPlan(f.params)).rejects.toThrow()
    f.client.ledgerService.batchGetObjects.mockImplementation(async input => input.requests[0].objectId === f.sourceLockId
      ? { response: { objects: [{ result: { oneofKind: 'error', error: { code: 3 } } }] } } : original(input))
    await expect(prepareCollectionBuyPlan(f.params)).rejects.toThrow('OBJECT_UNAVAILABLE')
  })
  it('rejects changes between initial read and final readset verification', async () => {
    const f = await collectionBuyFixture(), original = f.client.ledgerService.batchGetObjects.getMockImplementation()!; let count = 0
    f.client.ledgerService.batchGetObjects.mockImplementation(async input => {
      if (input.requests[0].objectId === f.c.id && ++count === 2) f.editCurrent(f.c.id, SoulPublicCollectionBcs, c => { c.extra_royalty_bps++ })
      return original(input)
    })
    await expect(prepareCollectionBuyPlan(f.params)).rejects.toThrow('READSET_CHANGED')
  })
  it('never truncates a failed coin scan into sufficient funds or repeats cursor pages', async () => {
    const f = await collectionBuyFixture(), empty = { response: { objects: [] as Array<{ objectId: string }>, nextPageToken: new Uint8Array([1]) } }
    f.client.stateService.listOwnedObjects.mockResolvedValue(empty)
    await expect(prepareCollectionBuyPlan({ ...f.params, paymentCoinObjectIds: undefined })).rejects.toThrow('PAYMENT_SCAN_CURSOR')
    expect(f.client.stateService.listOwnedObjects).toHaveBeenCalledTimes(2)
  })
  it('rejects u64 merge overflow and duplicate explicit payment refs', async () => {
    await expect(collectionBuyFixture({ paymentBalances: ['18446744073709551615', '1'] })).rejects.toThrow('PAYMENT_BALANCE')
    const f = await collectionBuyFixture()
    await expect(prepareCollectionBuyPlan({ ...f.params, paymentCoinObjectIds: [f.paymentCoinObjectIds[0], f.paymentCoinObjectIds[0]] })).rejects.toThrow('PAYMENT_SELECTION')
  })
  it('validates canonical compact MoveObjectType::Coin raw wire objects', async () => {
    const f = await collectionBuyFixture(), row = f.plan.objects.find(row => row.objectId === f.paymentCoinObjectIds[0])!
    expect(bcs.Object.parse(fromBase64(row.bcs)).data.Move?.type.Coin).toBe(f.target.paymentCoinType)
    expect((await f.adapter.query(f.record)).status).toBe('SUCCEEDED')
  })
  it('allows equal-domain shared version changes but pins every owned payment/cap reference', async () => {
    const f = await collectionBuyFixture(), current = f.current.get(f.c.id)
    const next = f.full(f.c.id, f.types.collection, SoulPublicCollectionBcs, f.c, { Shared: { initialSharedVersion: '1' } }, '13')
    f.current.set(f.c.id, next); await expect(assertCollectionBuyCurrent({ client: f.client as never, plan: f.plan })).resolves.toBeTruthy()
    f.current.set(f.c.id, current)
    const coinId = f.paymentCoinObjectIds[0], coin = f.full(coinId, f.types.coin, CollectionBuyCoinBcs, { id: coinId, balance: '900000' }, { AddressOwner: f.author }, '13')
    f.current.set(coinId, coin)
    await expect(assertCollectionBuyCurrent({ client: f.client as never, plan: f.plan })).rejects.toThrow('FROZEN_REFERENCE_CHANGED')
    expect((await f.adapter.query(f.record)).status).toBe('SUCCEEDED')
  })
  it.each(['quote', 'extra', 'absence', 'package', 'policy', 'coin'] as const)('rejects imported plan %s tampering', async kind => {
    const f = await collectionBuyFixture(), p = structuredClone(f.plan)
    if (kind === 'quote') p.quote.buyerTotalAtomic = '1'
    if (kind === 'extra') p.objects.push({ ...p.objects[0] })
    if (kind === 'absence') p.absentIds.push(cid(888))
    if (kind === 'package') p.target.callableDigest = f.record.packet.digest
    if (kind === 'policy') p.expected.policyBcs = p.expected.marketBcs
    if (kind === 'coin') p.paymentCoinIds.reverse()
    if (kind === 'coin') { const r = { ...f.record, plan: p }; expect(() => parseCollectionBuyRecord(r)).toThrow('REFERENCE_CHANGED') }
    else expect(() => parseCollectionBuyPlan(p)).toThrow()
  })
  it('exact SDK template includes three guards then existing/new personal Kiosk plumbing', async () => {
    for (const newKiosk of [false, true]) {
      const f = await collectionBuyFixture({ newKiosk }), tx = buildCollectionBuyTransaction(f.plan).getData()
      expect(tx.commands.slice(0, 3).map(row => row.MoveCall?.function)).toEqual(['assert_collection_command_snapshot', 'assert_collection_listing_snapshot', 'assert_collection_market_snapshot_v2'])
      expect(tx.commands.filter(row => row.MoveCall?.function === 'buy_collection_right_fixed_price_v2')).toHaveLength(1)
      expect(tx.commands.some(row => row.MoveCall?.function === 'transfer_to_sender')).toBe(newKiosk)
    }
  })
  it.each(['pure', 'command', 'sender', 'gas', 'expiry', 'shared'] as const)('rejects rehashed transaction %s tampering', async kind => {
    const f = await collectionBuyFixture(), record = await f.packet(data => {
      if (kind === 'pure') data.inputs.find(row => row.Pure)!.Pure!.bytes = toBase64(new Uint8Array([0]))
      if (kind === 'command') data.commands.pop()
      if (kind === 'sender') data.sender = cid(888)
      if (kind === 'gas') data.gasData.payment![0].objectId = f.paymentCoinObjectIds[0]
      if (kind === 'expiry') data.expiration = { Epoch: '11', $kind: 'Epoch' }
      if (kind === 'shared') data.inputs.find(row => row.Object?.SharedObject)!.Object!.SharedObject!.mutable = false
    })
    expect(() => parseCollectionBuyRecord(record)).toThrow()
  })
  it('prepares and simulates exact bytes, verifies and broadcasts same bytes/signature', async () => {
    const f = await collectionBuyFixture(), r = await f.adapter.prepare(f.plan), signed = await f.adapter.sign(r)
    const record = { ...r, packet: { ...r.packet, phase: 'SIGNED' as const, signature: signed.signature } }
    await f.adapter.broadcast(record)
    expect(f.client.core.executeTransaction).toHaveBeenLastCalledWith({ transaction: fromBase64(record.packet.bytes), signatures: [signed.signature] })
  })
  it('rejects wrong wallet, expiration, protocol limits, simulation and changed wallet bytes', async () => {
    const f = await collectionBuyFixture(); f.setAddress(cid(800)); await expect(f.adapter.preflight(f.record, true)).rejects.toThrow('WALLET_OR_LIFECYCLE_CHANGED')
    f.setAddress(f.author); f.client.ledgerService.getEpoch.mockResolvedValueOnce({ response: { epoch: { epoch: 11n } } })
    await expect(f.adapter.preflight(f.record, true)).rejects.toThrow('EXPIRED_QUERY_ONLY')
    f.client.core.getProtocolConfig.mockResolvedValueOnce({ protocolConfig: { attributes: { max_tx_size_bytes: '1', max_programmable_tx_commands: '1024', max_pure_argument_size: '16384' } } })
    await expect(f.adapter.preflight(f.record, true)).rejects.toThrow('PROTOCOL_LIMIT')
    const r = { ...f.record, packet: { ...f.record.packet, phase: 'PREPARED' as const, signature: null } }
    f.sign.mockResolvedValueOnce({ bytes: 'AA==', signature: f.record.packet.signature! })
    await expect(f.adapter.sign(r)).rejects.toThrow('WALLET_CHANGED_BYTES')
  })
  it('saves an exact late signature result before lifecycle preflight blocks broadcast', async () => {
    const f = await collectionBuyFixture(), r = { ...f.record, packet: { ...f.record.packet, phase: 'SIGNING' as const, signature: null } }
    f.sign.mockImplementationOnce(async tx => { f.setAddress(null); return f.signer.signTransaction(await tx.build()) })
    const signed = await f.adapter.sign(r); expect(signed.bytes).toBe(r.packet.bytes)
    await expect(f.adapter.broadcast({ ...r, packet: { ...r.packet, phase: 'SIGNED', signature: signed.signature } })).rejects.toThrow('WALLET_OR_LIFECYCLE_CHANGED')
  })
  it('uses default current-state validation rather than an injected read in real adapter', async () => {
    const f = await collectionBuyFixture(), adapter = createCollectionBuyAdapter({ client: f.client as never, getAddress: f.getAddress, sign: f.sign })
    const later = f.full(f.market.id, f.types.market, SoulPublicMarketConfigBcs, { ...f.market, platform_fee_bps: f.market.platform_fee_bps + 1 },
      { Shared: { initialSharedVersion: '1' } }, '13')
    f.current.set(f.market.id, later)
    await expect(adapter.preflight(f.record, true)).rejects.toThrow('AUTHORITY_CHANGED')
    expect((await adapter.query(f.record)).status).toBe('SUCCEEDED')
  })
  it.each([
    ['root holder', (f: Fixture) => historicalEdit(f, f.c.id, '12', SoulPublicCollectionBcs, c => { c.current_holder = cid(800) })],
    ['root kiosk', f => historicalEdit(f, f.c.id, '12', SoulPublicCollectionBcs, c => { c.current_holder_kiosk_id = cid(800) })],
    ['creator', f => historicalEdit(f, f.c.id, '12', SoulPublicCollectionBcs, c => { c.creator = f.author })],
    ['supply', f => historicalEdit(f, f.c.id, '12', SoulPublicCollectionBcs, c => { c.current_supply = '1' })],
    ['active listing', f => historicalEdit(f, f.listing.id, '12', CollectionPublicListingBcs, l => { l.is_active = true })],
    ['surviving cap', f => historicalEdit(f, f.listing.id, '12', CollectionPublicListingBcs, l => { l.purchase_cap = f.listing.purchase_cap })],
    ['seller count', f => historicalEdit(f, f.sellerKiosk.id, '12', SoulPublicKioskBcs, k => { k.item_count = 1 })],
    ['seller profits', f => historicalEdit(f, f.sellerKiosk.id, '12', SoulPublicKioskBcs, k => { k.profits = '1' })],
    ['buyer count', f => historicalEdit(f, f.buyerKiosk.id, '12', SoulPublicKioskBcs, k => { k.item_count = 2 })],
    ['buyer owner', f => historicalEdit(f, f.buyerKiosk.id, '12', SoulPublicKioskBcs, k => { k.owner = cid(800) })],
    ['Right custody', f => historicalEdit(f, f.right.id, '12', SoulPublicCollectionRightBcs, () => {}, { ObjectOwner: f.itemId })],
    ['Right metadata', f => historicalEdit(f, f.right.id, '12', SoulPublicCollectionRightBcs, r => { r.name = 'replaced' })],
    ['destination lock', f => historicalEdit(f, f.destinationLockId, '12', CollectionBuyLockBcs, l => { l.value = false })],
    ['seller payout', f => historicalEdit(f, cid(1400), '12', CollectionBuyCoinBcs, c => { c.balance = '1000000' })],
    ['fee payout', f => historicalEdit(f, cid(1401), '12', CollectionBuyCoinBcs, c => { c.balance = '5000' })],
    ['fee owner', f => historicalEdit(f, cid(1401), '12', CollectionBuyCoinBcs, () => {}, { AddressOwner: cid(800) })],
    ['change', f => historicalEdit(f, f.paymentCoinObjectIds[0], '12', CollectionBuyCoinBcs, c => { c.balance = '1' })],
    ['change owner', f => historicalEdit(f, f.paymentCoinObjectIds[0], '12', CollectionBuyCoinBcs, () => {}, { AddressOwner: cid(800) })],
    ['payment input', f => historicalEdit(f, f.paymentCoinObjectIds[0], '11', CollectionBuyCoinBcs, c => { c.balance = '900001' })],
    ['gas', f => historicalEdit(f, cid(900), '12', CollectionBuyCoinBcs, c => { c.balance = '9999998' })],
    ['policy drift', f => historicalEdit(f, f.policy.id, '11', CollectionBuyPolicyBcs, p => { p.balance = '1' })],
  ] as Array<[string, (f: Fixture) => void]>)('rejects digest/checkpoint-rehashed historical %s', async (_name, mutate) => {
    const f = await collectionBuyFixture(); mutate(f); await expect(f.adapter.query(f.record)).rejects.toThrow()
  })
  it.each([
    ['personal cap ownership', (f: Fixture) => historicalEdit(f, f.cap.id, '12', CollectionPersonalKioskCapBcs, () => {}, { AddressOwner: cid(800) })],
    ['personal cap lineage', f => historicalEdit(f, f.cap.id, '12', CollectionPersonalKioskCapBcs, c => { c.cap.for = cid(800) })],
    ['registered kiosk', f => historicalEdit(f, f.regId, '12', CollectionKioskRegistrationFieldBcs, r => { r.value.kiosk_id = cid(800) })],
    ['registered cap', f => historicalEdit(f, f.regId, '12', CollectionKioskRegistrationFieldBcs, r => { r.value.kiosk_cap_id = cid(800) })],
    ['personal marker', f => historicalEdit(f, collectionBuyOwnerMarker(f.target, f.buyerKiosk.id), '12', CollectionBuyOwnerMarkerBcs, m => { m.value = cid(800) })],
  ] as Array<[string, (f: Fixture) => void]>)('rejects rehashed new-Kiosk %s', async (_name, mutate) => {
    const f = await collectionBuyFixture({ newKiosk: true }); mutate(f); await expect(f.adapter.query(f.record)).rejects.toThrow()
  })
  it.each(['source item', 'destination item', 'reservation', 'source lock', 'fee', 'readonly policy', 'duplicate', 'unexpected', 'gas index'] as const)('rejects missing or inconsistent %s effects', async kind => {
    const f = await collectionBuyFixture({ sellerLocked: true }), e = f.effects.V2!
    const remove = (objectId: string) => { e.changedObjects = e.changedObjects.filter(([id]) => id !== objectId) }
    if (kind === 'source item') remove(f.itemId)
    if (kind === 'destination item') remove(f.destinationItemId)
    if (kind === 'reservation') remove(f.markerId)
    if (kind === 'source lock') remove(f.sourceLockId)
    if (kind === 'fee') remove(cid(1401))
    if (kind === 'readonly policy') e.unchangedConsensusObjects = e.unchangedConsensusObjects.filter(([id]) => id !== f.policy.id)
    if (kind === 'duplicate') e.changedObjects.push(structuredClone(e.changedObjects[0]))
    if (kind === 'unexpected') e.changedObjects.push([cid(888), structuredClone(e.changedObjects[0][1])])
    if (kind === 'gas index') e.gasObjectIndex = 1
    f.evidence.rehashEffects(); await expect(f.adapter.query(f.record)).rejects.toThrow()
  })
  it.each(['purchase', 'new-kiosk'] as const)('requires exact created/deleted wrapped UID effect for %s cap', async kind => {
    for (const mutation of ['missing', 'id-operation', 'standalone-input', 'standalone-output', 'unrelated-uid']) {
      const f = await collectionBuyFixture({ newKiosk: true }), e = f.effects.V2!, objectId = kind === 'purchase' ? f.listing.purchase_cap.id : f.cap.cap.id
      const entry = e.changedObjects.find(([id]) => id === objectId)!, row = entry[1]
      expect(row.inputState.$kind).toBe('NotExist'); expect(row.outputState.$kind).toBe('NotExist')
      expect(row.idOperation.$kind).toBe(kind === 'purchase' ? 'Deleted' : 'Created')
      if (mutation === 'missing') e.changedObjects = e.changedObjects.filter(([id]) => id !== objectId)
      if (mutation === 'id-operation') row.idOperation = { $kind: 'None', None: true }
      if (mutation === 'standalone-input') row.inputState = structuredClone(e.changedObjects[0][1].inputState)
      if (mutation === 'standalone-output') row.outputState = structuredClone(e.changedObjects[0][1].outputState)
      if (mutation === 'unrelated-uid') entry[0] = cid(888)
      f.evidence.rehashEffects(); await expect(f.adapter.query(f.record)).rejects.toThrow()
    }
  })
  it('rejects a created payout UID aliasing the preserved inner buyer Kiosk cap', async () => {
    const f = await collectionBuyFixture(), e = f.effects.V2!, output = f.full(f.cap.cap.id, f.types.coin, CollectionBuyCoinBcs,
      { id: f.cap.cap.id, balance: f.plan.quote.priceAtomic }, { AddressOwner: f.sellerKiosk.owner }, '12', f.record.packet.digest)
    const payout = e.changedObjects.find(([id]) => id === cid(1400))!
    payout[0] = f.cap.cap.id; payout[1].outputState.ObjectWrite![0] = output.digest
    f.evidence.rehashEffects(); await expect(f.adapter.query(f.record)).rejects.toThrow('HISTORY_WRAPPED_CAP_PRESERVATION')
  })
  it.each(['sender', 'type', 'package', 'contents', 'count'] as const)('rejects rehashed event %s', async kind => {
    const f = await collectionBuyFixture(), event = f.evidence.eventsData.data[0]
    if (kind === 'sender') event.sender = cid(800)
    if (kind === 'type') event.type_.address = cid(800)
    if (kind === 'package') event.package_id = cid(800)
    if (kind === 'contents') event.contents[event.contents.length - 1] ^= 1
    if (kind === 'count') f.evidence.eventsData.data.push(structuredClone(event))
    f.evidence.rehashEvents(); await expect(f.adapter.query(f.record)).rejects.toThrow()
  })
  it('requires immutable package historical readback rather than imported package hashes alone', async () => {
    const f = await collectionBuyFixture(), row = f.rows.get(`${f.target.callablePackageId}:2`), raw = bcs.Object.parse(row.bcs.value)
    raw.data.Package!.typeOriginTable[0].package = cid(800); row.bcs.value = bcs.Object.serialize(raw).toBytes(); row.digest = collectionCommandHash('Object', row.bcs.value)
    await expect(f.adapter.query(f.record)).rejects.toThrow('HISTORY_PACKAGE_EVIDENCE')
  })
  it.each(['replace', 'mutate'] as const)('captures complete historical inputs before first await: %s', async kind => {
    const f = await collectionBuyFixture(), params = { client: f.client as never, record: structuredClone(f.record), effects: structuredClone(f.effects),
      events: new Uint8Array(f.evidence.ledger.events.bcs.value), signal: new AbortController().signal }
    const promise = proveCollectionBuyHistory(params)
    if (kind === 'replace') { params.effects = {} as never; params.record = {} as never; params.events = new Uint8Array(); params.client = {} as never }
    else { params.effects.V2!.changedObjects.length = 0; params.record.packet.digest = ''; params.events.fill(0) }
    expect(await promise).toMatchObject({ collectionId: f.c.id, buyerKioskId: f.buyerKiosk.id })
  })
  it('requires checkpoint membership and original committed signature, including SIGNING recovery', async () => {
    const f = await collectionBuyFixture(), unsigned = { ...f.record, packet: { ...f.record.packet, phase: 'SIGNING' as const, signature: null } }
    expect((await f.adapter.query(unsigned)).status).toBe('SUCCEEDED')
    const contents = f.evidence.contentsData
    if (contents.V1) contents.V1.user_signatures[1][0][0] ^= 1
    else contents.V2!.transactions[1].user_signatures[0][0][0] ^= 1
    f.evidence.rehashContents()
    await expect(f.adapter.query(f.record)).rejects.toThrow('CHECKPOINT_SIGNATURE')
    await expect(f.adapter.query(unsigned)).rejects.toThrow()
  })
  it('does not bind decoded Success to a later mutated Failure checkpoint buffer', async () => {
    const f = await collectionBuyFixture(), response = structuredClone(f.evidence.ledger)
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
    const f = await collectionBuyFixture(), response = structuredClone(f.evidence.ledger)
    f.client.ledgerService.getTransaction.mockImplementation(async () => ({ response: { transaction: response } }))
    const checkpoint = f.client.ledgerService.getCheckpoint.getMockImplementation()!
    f.client.ledgerService.getCheckpoint.mockImplementation(async (...args) => {
      response.effects.bcs.value.fill(0); response.events.bcs.value.fill(0); response.transaction.bcs.value.fill(0)
      response.digest = ''; response.effects.status.success = false
      return checkpoint(...args)
    })
    expect((await f.adapter.query(f.record)).status).toBe('SUCCEEDED')
  })
  it('returns only a checkpoint-proven failure and treats uncheckpointed execution as pending', async () => {
    const f = await collectionBuyFixture(); delete f.evidence.ledger.checkpoint
    expect(await f.adapter.query(f.record)).toEqual({ status: 'PENDING' })
    f.evidence.ledger.checkpoint = 42n
    f.effects.V2!.status = { $kind: 'Failure', Failure: { error: { $kind: 'InsufficientGas', InsufficientGas: true }, command: null } }
    f.evidence.rehashEffects(); expect(await f.adapter.query(f.record)).toEqual({ status: 'FAILED', checkpoint: '42' })
  })
  it('does not promote missing, unavailable or future-epoch transaction evidence to failure/success', async () => {
    const f = await collectionBuyFixture()
    f.client.ledgerService.getTransaction.mockRejectedValueOnce({ code: 'NOT_FOUND' })
    expect(await f.adapter.query(f.record)).toEqual({ status: 'MISSING' })
    f.client.ledgerService.getTransaction.mockRejectedValueOnce(new Error('network'))
    await expect(f.adapter.query(f.record)).rejects.toThrow('network')
    f.effects.V2!.executedEpoch = '11'; f.evidence.rehashEffects()
    await expect(f.adapter.query(f.record)).rejects.toThrow('EFFECTS_STATUS')
  })
})
