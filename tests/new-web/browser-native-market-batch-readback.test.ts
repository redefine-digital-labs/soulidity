import { afterEach, expect, it, vi } from 'vitest'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { deriveDynamicFieldID, toBase64 } from '@mysten/sui/utils'
import { SoulPublicKioskBcs } from '@soulidity/sdk'
import { browserNativeMarketReadbackFixture } from './fixtures/browser-native-market-readback'
import { marketBatchListFixture, marketBatchListEvents } from './fixtures/market-batch-list-operation'
import { fixtureKioskItem } from './fixtures/native-receive'
import { lid } from './fixtures/market-list-operation'
import { NativeSoulBcs, NativeSoulStateBcs, NativeSoulBindingBcs } from '../../web/lib/animacraft/native-receive'
import { EquipmentPointerBcs } from '../../web/lib/animacraft/native-equipment'
import { NativeMarketListingBcs } from '../../web/lib/animacraft/native-market'
import { confirmBrowserNativeMarketBatchList } from '../../web/lib/animacraft/browser-native-market-readback'

afterEach(() => vi.restoreAllMocks())

// Compose existing raw-object and real SDK packet fixtures locally. No proof
// validator is mocked: both Souls share one transaction, events and read set.
async function fixture() {
  const f = await browserNativeMarketReadbackFixture(), batch = await marketBatchListFixture(false)
  const record = batch.record
  for (const { snapshot } of record.rows) Object.assign(snapshot.release, {
    marketConfigV2Id: lid(206), soulidityOriginalPackageId: f.target.soulidityOriginalPackageId,
    soulidityCallableDigest: f.target.soulidityCallableDigest,
  })
  const data = batch.tx.getData()
  for (const input of data.inputs) if (input.Object?.SharedObject?.objectId === lid(6)) input.Object.SharedObject.objectId = lid(206)
  const bytes = await Transaction.from(JSON.stringify(data)).build()
  Object.assign(record, { bytes: toBase64(bytes), digest: TransactionDataBuilder.getDigestFromBytes(bytes), phase: 'SUCCEEDED', syncStatus: 'PENDING' })
  const clone = (from: string, to: string, codec: any, edit: (value: any) => void) => {
    const row = structuredClone(f.objects.get(from)); row.objectId = to
    f.objects.set(to, row); f.edit(to, codec, edit)
  }
  clone(lid(12), lid(112), NativeSoulBcs, v => { v.id = lid(112) })
  clone(lid(14), lid(114), NativeSoulStateBcs, v => { v.id = lid(114); v.soul_id = lid(112) })
  clone(lid(13), lid(113), NativeSoulBindingBcs, v => { v.id = lid(113); v.soul_id = lid(112); v.soul_state_id = lid(114) })
  const oldField = deriveDynamicFieldID(lid(14), 'u8', new Uint8Array([9]))
  const newField = deriveDynamicFieldID(lid(114), 'u8', new Uint8Array([9]))
  clone(oldField, newField, EquipmentPointerBcs, v => { v.id = newField; v.value = lid(113) })
  f.objects.get(newField).owner.address = lid(114)
  fixtureKioskItem(f.objects, f.kioskId, lid(112))
  f.edit(f.kioskId, SoulPublicKioskBcs, v => { v.item_count = 2 })
  record.rows.forEach(({ snapshot, priceAtomic }, index) => {
    clone(f.listingId, lid(300 + index), NativeMarketListingBcs, v => {
      v.id = lid(300 + index); v.soul_id = snapshot.soulId; v.state_id = snapshot.stateId; v.price = priceAtomic
      v.purchase_cap.id = lid(330 + index); v.purchase_cap.item_id = snapshot.soulId
    })
  })
  f.history.clear()
  for (const [id, row] of f.objects) f.history.set(id, structuredClone(row))
  const stateChange = structuredClone(f.effects.V2.changedObjects[0])
  const listingChange = structuredClone(f.effects.V2.changedObjects[1])
  f.effects.V2.changedObjects = record.rows.flatMap(({ snapshot }, index) => {
    const state = structuredClone(stateChange), listing = structuredClone(listingChange)
    state[0] = snapshot.stateId; listing[0] = lid(300 + index); return [state, listing]
  })
  f.ledger.events = marketBatchListEvents(record)
  f.effects.V2.transactionDigest = record.digest; f.effects.V2.eventsDigest = f.ledger.events.digest
  f.ledger.digest = record.digest; f.ledger.transaction = { digest: record.digest, bcs: { value: bytes } }
  f.ledger.effects.transactionDigest = record.digest; f.refreshEffects()
  const confirm = () => confirmBrowserNativeMarketBatchList(record, { target: f.target }, { client: f.client })
  const later = (index: number, mutate: (value: any) => void) => {
    const id = record.rows[index].snapshot.stateId, row = f.objects.get(id)
    row.version = 4n; row.digest = f.digest(4); f.edit(id, NativeSoulStateBcs, mutate)
  }
  return { ...f, record, confirm, later }
}

it('confirms both real historical outputs and current custody without execution', async () => {
  const f = await fixture()
  expect(await f.confirm()).toBe('COMPLETE')
  for (const id of [lid(14), lid(114), lid(300), lid(301)])
    expect(f.get.mock.calls.some(([r]) => r.objectId === id && r.version === 3n)).toBe(true)
  expect(f.execute).not.toHaveBeenCalled()
  expect(f.record.syncStatus).toBe('PENDING')
})

it.each([lid(14), lid(114), lid(300), lid(301)])('missing historical %s keeps the whole batch pending', async id => {
  const f = await fixture(); f.history.delete(id)
  await expect(f.confirm()).rejects.toThrow()
  expect(f.record.syncStatus).toBe('PENDING'); expect(f.execute).not.toHaveBeenCalled()
})

it.each(['state-effect', 'listing-effect', 'custody', 'receipt-order'] as const)('second-row %s failure cannot partially complete', async problem => {
  const f = await fixture()
  if (problem.endsWith('effect')) {
    const id = problem === 'state-effect' ? lid(114) : lid(301)
    f.effects.V2.changedObjects = f.effects.V2.changedObjects.filter(([objectId]: any) => objectId !== id)
  }
  if (problem === 'custody') f.objects.delete(lid(113))
  if (problem === 'receipt-order') {
    f.ledger.events = marketBatchListEvents(f.record, rows => rows.reverse())
    f.effects.V2.eventsDigest = f.ledger.events.digest
  }
  f.refreshEffects()
  await expect(f.confirm()).rejects.toThrow()
  expect(f.record.syncStatus).toBe('PENDING'); expect(f.execute).not.toHaveBeenCalled()
})

it.each([0, 1])('proves later cancellation of row %i as superseded while still checking the other row', async index => {
  const f = await fixture(); f.later(index, v => { v.is_listed = false })
  f.objects.delete(lid(300 + index))
  expect(await f.confirm()).toBe('SUPERSEDED')
  f.history.delete(f.record.rows[1 - index].snapshot.stateId)
  await expect(f.confirm()).rejects.toThrow()
  expect(f.execute).not.toHaveBeenCalled()
})

it('proves later owner and Kiosk custody instead of treating missing listings as completion', async () => {
  const f = await fixture(), nextKiosk = lid(401)
  f.later(1, v => { v.current_owner = lid(400); v.current_kiosk_id = nextKiosk; v.ownership_epoch = '4'; v.is_listed = false })
  fixtureKioskItem(f.objects, nextKiosk, lid(112))
  const kiosk = structuredClone(f.objects.get(f.kioskId)); kiosk.objectId = nextKiosk
  f.objects.set(nextKiosk, kiosk)
  f.edit(nextKiosk, SoulPublicKioskBcs, v => { v.id = nextKiosk; v.owner = lid(400); v.item_count = 1 })
  f.objects.delete(lid(301))
  expect(await f.confirm()).toBe('SUPERSEDED')
  f.objects.delete(nextKiosk)
  await expect(f.confirm()).rejects.toThrow()
})

it('final shared-session verification detects first-row drift after the second row was read', async () => {
  const f = await fixture(), original = f.get.getMockImplementation()!
  let secondRead = false, drifted = false
  f.get.mockImplementation(((request: any, options: any) => {
    if (request.objectId === lid(114)) secondRead = true
    if (secondRead && !drifted && request.objectId === lid(14) && request.version === undefined) {
      drifted = true; f.edit(lid(14), NativeSoulStateBcs, v => { v.grant_capacity = '2' })
    }
    return original(request, options)
  }) as any)
  await expect(f.confirm()).rejects.toThrow('changed during readback')
  expect(drifted).toBe(true); expect(f.record.syncStatus).toBe('PENDING')
})

it('queries saved successful bytes independently of current write gates', async () => {
  const f = await fixture()
  Object.assign(f.target, { marketWritesEnabled: false })
  for (const row of f.record.rows) { row.snapshot.release.writesEnabled = false; row.snapshot.listAvailable = false }
  expect(await f.confirm()).toBe('COMPLETE'); expect(f.execute).not.toHaveBeenCalled()
})
