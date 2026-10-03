import { afterEach, expect, it, vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { toBase58 } from '@mysten/sui/utils'
import { browserNativeMarketReadbackFixture as fixture } from './fixtures/browser-native-market-readback'
import { lid } from './fixtures/market-list-operation'
import { NativeSoulStateBcs, NativeSoulBindingBcs, NativeSoulBcs } from '../../web/lib/animacraft/native-receive'
import { NativeMarketListingBcs } from '../../web/lib/animacraft/native-market'
import { deriveKioskItemFieldId, KioskItemFieldBcs, SoulPublicKioskBcs, SoulPublicCollectionBcs, SoulPublicCollectionRightBcs } from '@soulidity/sdk'
import { fixtureKioskItem } from './fixtures/native-receive'

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })
it.each(['buy', 'list', 'reprice', 'cancel-listing'] as const)('confirms %s from actual SDK bytes and raw current/historical objects', async kind => {
  const f = await fixture(kind)
  expect(await f.confirm()).toBe('COMPLETE'); expect(f.execute).not.toHaveBeenCalled()
  expect(f.get.mock.calls.some(([request]) => request.objectId === lid(14) && request.version === 3n)).toBe(true)
})
it('confirms a newly created buyer Kiosk without any backend or wallet', async () => {
  const f = await fixture('buy', true); expect(await f.confirm()).toBe('COMPLETE')
  f.effects.V2.changedObjects = f.effects.V2.changedObjects.filter(([id]: any) => id !== f.kioskId)
  f.refreshEffects(); await expect(f.confirm()).rejects.toThrow()
})
it.each(['missing-effect', 'effect-parent', 'not-created', 'missing-history', 'history-digest', 'history-parent', 'history-key', 'history-value', 'direct-kiosk'] as const)(
  'rejects purchase wrapper %s even with valid current custody', async problem => {
    const f = await fixture('buy'), fieldId = deriveKioskItemFieldId(f.kioskId, lid(12)), row = f.history.get(fieldId)
    const effect = f.effects.V2.changedObjects.find(([id]: any) => id === fieldId)[1]
    if (problem === 'missing-effect') f.effects.V2.changedObjects = f.effects.V2.changedObjects.filter(([id]: any) => id !== fieldId)
    if (problem === 'effect-parent') effect.outputState.ObjectWrite[1].ObjectOwner = lid(99)
    if (problem === 'not-created') effect.idOperation = { None: true }
    if (problem === 'missing-history') f.history.delete(fieldId)
    if (problem === 'history-digest') row.digest = f.digest(9)
    if (problem === 'history-parent') row.owner.address = lid(99)
    if (problem === 'direct-kiosk') f.history.get(lid(12)).owner.address = f.kioskId
    if (problem === 'history-key' || problem === 'history-value') f.edit(fieldId, KioskItemFieldBcs, value => {
      if (problem === 'history-key') value.name.name.id = lid(99)
      else value.value = lid(99)
    }, f.history)
    f.refreshEffects(); await expect(f.confirm()).rejects.toThrow()
  })
it.each(['list', 'reprice', 'cancel-listing'] as const)('does not require unchanged Item wrapper writes for %s', async kind => {
  const f = await fixture(kind), fieldId = deriveKioskItemFieldId(f.kioskId, lid(12))
  expect(f.effects.V2.changedObjects.some(([id]: any) => id === fieldId)).toBe(false)
  f.history.delete(fieldId)
  expect(await f.confirm()).toBe('COMPLETE')
  expect(f.get.mock.calls.some(([r]) => r.objectId === fieldId && r.version !== undefined)).toBe(false)
})
it.each(['soul-input-parent', 'soul-input-version', 'wrapper-transaction', 'soul-transaction', 'missing-deletion',
  'deletion-parent', 'deletion-operation', 'deletion-output', 'deletion-input-version', 'seller-history-missing',
  'seller-history-version', 'seller-history-digest', 'seller-history-parent', 'seller-history-value'] as const)(
  'rejects disconnected purchase custody lifecycle: %s', async problem => {
    const f = await fixture('buy'), buyerFieldId = deriveKioskItemFieldId(f.kioskId, lid(12))
    const soulEffect = f.effects.V2.changedObjects.find(([id]: any) => id === lid(12))[1]
    const deleted = f.effects.V2.changedObjects.find(([id]: any) => id === f.sellerFieldId)[1]
    const old = f.history.get(f.sellerFieldId!)
    if (problem === 'soul-input-parent') soulEffect.inputState.Exist[1].ObjectOwner = lid(99)
    if (problem === 'soul-input-version') soulEffect.inputState.Exist[0][0] = '3'
    if (problem === 'wrapper-transaction') f.history.get(buyerFieldId).previousTransaction = f.digest(9)
    if (problem === 'soul-transaction') f.history.get(lid(12)).previousTransaction = f.digest(9)
    if (problem === 'missing-deletion') f.effects.V2.changedObjects = f.effects.V2.changedObjects.filter(([id]: any) => id !== f.sellerFieldId)
    if (problem === 'deletion-parent') deleted.inputState.Exist[1].ObjectOwner = lid(99)
    if (problem === 'deletion-operation') deleted.idOperation = { None: true }
    if (problem === 'deletion-output') deleted.outputState = { ObjectWrite: [f.digest(), { ObjectOwner: f.kioskId }] }
    if (problem === 'deletion-input-version') deleted.inputState.Exist[0][0] = '3'
    if (problem === 'seller-history-missing') f.history.delete(f.sellerFieldId!)
    if (problem === 'seller-history-version') old.version = 1n
    if (problem === 'seller-history-digest') old.digest = f.digest(9)
    if (problem === 'seller-history-parent') old.owner.address = lid(99)
    if (problem === 'seller-history-value') f.edit(f.sellerFieldId!, KioskItemFieldBcs, v => { v.value = lid(99) }, f.history)
    f.refreshEffects(); await expect(f.confirm()).rejects.toThrow()
  })
it('proves the original purchase after a later move to a different Kiosk', async () => {
  const f = await fixture('buy'), oldBuyerField = deriveKioskItemFieldId(f.kioskId, lid(12)), laterKiosk = lid(101)
  f.later(state => { state.current_owner = lid(99); state.current_kiosk_id = laterKiosk; state.ownership_epoch = '5' })
  f.objects.delete(oldBuyerField)
  f.objects.get(lid(12)).version = 4n; f.objects.get(lid(12)).digest = f.digest(4)
  f.objects.get(lid(12)).previousTransaction = f.digest(4)
  fixtureKioskItem(f.objects, laterKiosk, lid(12))
  f.objects.set(laterKiosk, { objectId: laterKiosk, version: 4n, digest: f.digest(4), owner: { kind: 3, version: 4n },
    objectType: '0x2::kiosk::Kiosk', contents: { value: SoulPublicKioskBcs.serialize({
      id: laterKiosk, owner: lid(99), profits: '0', item_count: 1, allow_extensions: true }).toBytes() } })
  expect(await f.confirm()).toBe('SUPERSEDED')
  expect(f.get.mock.calls.some(([r]) => r.objectId === oldBuyerField && r.version === 3n)).toBe(true)
  expect(f.get.mock.calls.some(([r]) => r.objectId === f.sellerFieldId && r.version === 2n)).toBe(true)
})
it.each(['buy', 'list', 'cancel-listing'] as const)('ignores current write gates for successful %s', async kind => {
  const f = await fixture(kind); f.target.marketWritesEnabled = false
  const s = f.record.kind === 'cancel-listing' ? f.record : f.record.snapshot
  s.release.writesEnabled = false
  expect(await f.confirm()).toBe('COMPLETE')
})
it.each(['buy', 'list', 'cancel-listing'] as const)('proves later custody before superseding %s even when old listing is gone', async kind => {
  const f = await fixture(kind)
  f.later(state => { state.current_owner = lid(99); state.ownership_epoch = '5'; state.is_listed = false })
  f.edit(f.kioskId, SoulPublicKioskBcs, kiosk => { kiosk.owner = lid(99) })
  f.objects.delete(f.listingId)
  expect(await f.confirm()).toBe('SUPERSEDED')
})
it.each(['buy', 'cancel-listing'] as const)('recognizes a proven later relisting after %s', async kind => {
  const f = await fixture(kind); f.later(state => { state.is_listed = true }); f.objects.delete(f.listingId)
  expect(await f.confirm()).toBe('SUPERSEDED')
})
it('recognizes old listing deactivation after atomic reprice', async () => {
  const f = await fixture('list'); f.later(() => {})
  const row = f.objects.get(f.listingId); row.version = 4n; row.digest = f.digest(4)
  f.edit(f.listingId, NativeMarketListingBcs, listing => { listing.is_active = false; listing.purchase_cap = null })
  expect(await f.confirm()).toBe('SUPERSEDED')
})
it.each(['buy', 'list', 'cancel-listing'] as const)('never turns incomplete later %s evidence into superseded', async kind => {
  const f = await fixture(kind); f.later(state => { state.current_owner = lid(99); state.ownership_epoch = '5' })
  await expect(f.confirm()).rejects.toThrow('Kiosk custody')
})
it.each(['phase', 'digest', 'target', 'protocol', 'original', 'effects-state', 'effects-shared', 'checkpoint', 'status', 'bytes', 'events'] as const)
  ('rejects invalid saved/finalized %s proof', async problem => {
    const f = await fixture()
    if (problem === 'phase') f.record.phase = 'SIGNED'
    if (problem === 'digest') f.record.digest = f.digest(7)
    if (problem === 'target') f.target.soulidityCallableDigest = f.digest(7)
    if (problem === 'protocol') f.target.protocolConfigId = lid(99)
    if (problem === 'original') f.target.soulidityOriginalPackageId = lid(99)
    if (problem === 'effects-state') { f.effects.V2.changedObjects.shift(); f.refreshEffects() }
    if (problem === 'effects-shared') { f.effects.V2.changedObjects[0][1].outputState.ObjectWrite[1].Shared.initialSharedVersion = '2'; f.refreshEffects() }
    if (problem === 'checkpoint') f.ledger.checkpoint = undefined
    if (problem === 'status') f.ledger.effects.status.success = false
    if (problem === 'bytes') f.ledger.transaction.bcs.value = new Uint8Array([1])
    if (problem === 'events') f.ledger.events.digest = f.digest(7)
    await expect(f.confirm()).rejects.toThrow(); expect(f.execute).not.toHaveBeenCalled()
  })
it.each(['missing', 'version', 'digest', 'owner', 'epoch', 'listed', 'soul', 'creator'] as const)('rejects historical State %s', async problem => {
  const f = await fixture(), row = f.history.get(lid(14))
  if (problem === 'missing') f.history.delete(lid(14))
  if (problem === 'version') row.version = 2n
  if (problem === 'digest') row.digest = f.digest(7)
  if (['owner', 'epoch', 'listed', 'soul', 'creator'].includes(problem)) f.edit(lid(14), NativeSoulStateBcs, state => {
    if (problem === 'owner') state.current_owner = lid(99)
    if (problem === 'epoch') state.ownership_epoch = '2'
    if (problem === 'listed') state.is_listed = false
    if (problem === 'soul') state.soul_id = lid(99)
    if (problem === 'creator') state.creator = lid(99)
  }, f.history)
  await expect(f.confirm()).rejects.toThrow()
})
it.each(['stale', 'same-version-bytes', 'same-version-digest', 'epoch', 'custody-epoch', 'binding', 'soul', 'kiosk', 'shared-birth', 'raw-digest'] as const)
  ('rejects current %s even with successful transaction proof', async problem => {
    const f = await fixture(), row = f.objects.get(lid(14))
    if (problem === 'stale') row.version = 2n
    if (problem === 'same-version-digest') row.digest = f.digest(7)
    if (problem === 'same-version-bytes') f.edit(lid(14), NativeSoulStateBcs, state => { state.grant_capacity = '2' })
    if (problem === 'epoch') f.later(state => { state.ownership_epoch = '2' })
    if (problem === 'custody-epoch') f.later(state => { state.current_owner = lid(99) })
    if (problem === 'binding') f.edit(lid(13), NativeSoulBindingBcs, binding => { binding.soul_id = lid(99) })
    if (problem === 'soul') f.edit(lid(12), NativeSoulBcs, soul => { soul.provenance_kind = 0 })
    if (problem === 'kiosk') f.edit(f.kioskId, SoulPublicKioskBcs, kiosk => { kiosk.owner = lid(99) })
    if (problem === 'shared-birth') row.owner.version = 2n
    if (problem === 'raw-digest') row.digest = 'not-a-digest'
    await expect(f.confirm()).rejects.toThrow()
  })
it.each(['missing', 'price', 'cap', 'no-later-state'] as const)('retains pending for old listing %s', async problem => {
  const f = await fixture()
  if (problem === 'missing') f.objects.delete(f.listingId)
  else {
    f.objects.get(f.listingId).version = 4n; f.objects.get(f.listingId).digest = f.digest(4)
    f.edit(f.listingId, NativeMarketListingBcs, listing => {
      if (problem === 'price') listing.price = '1'
      if (problem === 'cap') listing.purchase_cap = null
      if (problem === 'no-later-state') { listing.is_active = false; listing.purchase_cap = null }
    })
  }
  await expect(f.confirm()).rejects.toThrow()
})
it('rejects same-reference byte drift during dependent reads', async () => {
  const f = await fixture(), implementation = f.get.getMockImplementation()!; let count = 0
  f.get.mockImplementation(((request: any, options: any) => {
    if (request.objectId === lid(14) && request.version === undefined && ++count === 2)
      f.edit(lid(14), NativeSoulStateBcs, state => { state.grant_capacity = '2' })
    return implementation(request, options)
  }) as any)
  await expect(f.confirm()).rejects.toThrow('changed during readback')
})
it('aborts an uncooperative transport without accepting a late response', async () => {
  const f = await fixture(), controller = new AbortController()
  f.transaction.mockImplementation((() => new Promise(() => {})) as any)
  const pending = f.confirm(controller.signal); controller.abort()
  await expect(pending).rejects.toThrow(); expect(f.execute).not.toHaveBeenCalled()
})

async function collectionFixture(kind: 'buy' | 'cancel-listing') {
  const f = await fixture(kind), collectionId = lid(91), rightId = lid(92)
  // add_soul requires the holder also to be this Soul's creator.
  if (f.record.kind === 'buy') f.record.snapshot.creator = f.owner
  for (const map of [f.history, f.objects]) {
    f.edit(lid(14), NativeSoulStateBcs, state => { state.creator = f.owner }, map)
    f.edit(lid(12), NativeSoulBcs, soul => { soul.creator = f.owner }, map)
    f.edit(lid(13), NativeSoulBindingBcs, binding => { binding.original_holder = f.owner }, map)
  }
  const pkg = f.objects.get(lid(5)).package
  pkg.modules.push({ name: 'collection', contents: new Uint8Array([161, 28, 235, 11, 7]) })
  for (const datatypeName of ['SoulCollection', 'SoulCollectionRight']) pkg.typeOrigins.push({ moduleName: 'collection', datatypeName, packageId: f.target.soulidityOriginalPackageId })
  f.objects.set(collectionId, { objectId: collectionId, version: 4n, digest: f.digest(4), owner: { kind: 3, version: 1n },
    objectType: `${f.target.soulidityOriginalPackageId}::collection::SoulCollection`, contents: { value: SoulPublicCollectionBcs.serialize({
      id: collectionId, version: '1', creator: f.owner, extra_royalty_bps: 500, tradeable: true, current_holder: f.owner,
      current_holder_kiosk_id: f.kioskId, right_id: rightId, max_supply: null, current_supply: '1',
    }).toBytes() } })
  f.objects.set(rightId, { objectId: rightId, version: 4n, digest: f.digest(4), owner: { kind: 2, address: f.kioskId },
    objectType: `${f.target.soulidityOriginalPackageId}::collection::SoulCollectionRight`, contents: { value: SoulPublicCollectionRightBcs.serialize({
      id: rightId, version: '1', collection_id: collectionId, creator: f.owner, name: 'Collection', description: '', image_url: '',
    }).toBytes() } })
  fixtureKioskItem(f.objects, f.kioskId, rightId)
  f.later(state => { state.collection_id = collectionId })
  return { ...f, collectionId, rightId }
}
it.each(['buy', 'cancel-listing'] as const)('supersedes %s after a proven later same-owner collection membership', async kind => {
  const f = await collectionFixture(kind); expect(await f.confirm()).toBe('SUPERSEDED')
})
it.each(['missing', 'creator', 'supply', 'right', 'custody', 'origin', 'listed', 'same-version'] as const)
  ('rejects malformed later Collection %s', async problem => {
    const f = await collectionFixture('cancel-listing')
    if (problem === 'missing') f.objects.delete(f.collectionId)
    if (problem === 'creator') f.edit(f.collectionId, SoulPublicCollectionBcs, collection => { collection.creator = lid(99) })
    if (problem === 'supply') f.edit(f.collectionId, SoulPublicCollectionBcs, collection => { collection.current_supply = '0' })
    if (problem === 'right') f.edit(f.rightId, SoulPublicCollectionRightBcs, right => { right.collection_id = lid(99) })
    if (problem === 'custody') f.objects.get(f.rightId).owner.address = lid(99)
    if (problem === 'origin') f.objects.get(lid(5)).package.typeOrigins.pop()
    if (problem === 'listed') f.edit(lid(14), NativeSoulStateBcs, state => { state.is_listed = true })
    if (problem === 'same-version') f.objects.get(lid(14)).version = 3n
    await expect(f.confirm()).rejects.toThrow()
  })
it('bounds even a transport that ignores timeout and cancellation', async () => {
  vi.useFakeTimers()
  const f = await fixture(); f.transaction.mockImplementation((() => new Promise(() => {})) as any)
  // Stub the platform deadline, while preserving the same real abort path.
  const controller = new AbortController()
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => { setTimeout(() => controller.abort(new Error('deadline')), 25000); return controller.signal })
  const result = expect(f.confirm()).rejects.toThrow('deadline')
  await vi.advanceTimersByTimeAsync(25001); await result
})
it('detaches captured arguments before asynchronous evidence reads', async () => {
  const f = await fixture(), pending = f.confirm()
  f.target.protocolConfigId = lid(99)
  if (f.record.kind === 'list' || f.record.kind === 'reprice') f.record.snapshot.owner = lid(99)
  expect(await pending).toBe('COMPLETE')
})
it.each(['deleted', 'not-exist-state', 'created-exist', 'created-birth', 'input-birth', 'input-version'] as const)
  ('rejects structurally impossible shared effects %s', async problem => {
    const f = await fixture(), [state, listing] = f.effects.V2.changedObjects
    if (problem === 'deleted') state[1].idOperation = { Deleted: true }
    if (problem === 'not-exist-state') state[1].inputState = { NotExist: true }
    if (problem === 'created-exist') listing[1].inputState = state[1].inputState
    if (problem === 'created-birth') listing[1].outputState.ObjectWrite[1].Shared.initialSharedVersion = '1'
    if (problem === 'input-birth') state[1].inputState.Exist[1].Shared.initialSharedVersion = '2'
    if (problem === 'input-version') state[1].inputState.Exist[0][0] = '3'
    f.refreshEffects(); await expect(f.confirm()).rejects.toThrow()
  })
function useV1Effects(f: Awaited<ReturnType<typeof fixture>>) {
  const kind = f.record.kind, v2 = f.effects.V2
  const ref = (objectId: string) => ({ objectId, version: '3', digest: f.digest() })
  const shared = (birth = '1') => ({ Shared: { initialSharedVersion: birth } })
  f.ledger.effects.bcs.value = bcs.TransactionEffects.serialize({ V1: { status: { Success: true }, executedEpoch: '9', gasUsed: v2.gasUsed,
    modifiedAtVersions: [[lid(14), '2'], ...(kind === 'buy' ? [[lid(12), '2'] as [string, string], [f.sellerFieldId!, '2'] as [string, string]] : [])], sharedObjects: [{ objectId: lid(14), version: '2', digest: f.digest(2) }], transactionDigest: f.record.digest,
    created: kind === 'list' ? [[ref(f.listingId), shared('3')]] : kind === 'buy'
      ? [[ref(deriveKioskItemFieldId(f.kioskId, lid(12))), { ObjectOwner: f.kioskId }]] : [],
    mutated: [[ref(lid(14)), shared()], ...(kind === 'buy' ? [[ref(lid(12)), { ObjectOwner: deriveKioskItemFieldId(f.kioskId, lid(12)) }] as const] : [])], unwrapped: [],
    deleted: kind === 'buy' ? [{ ...ref(f.sellerFieldId!), digest: toBase58(new Uint8Array(32).fill(99)) }] : [],
    unwrappedThenDeleted: [], wrapped: [], gasObject: [ref(lid(200)), { AddressOwner: f.owner }], eventsDigest: v2.eventsDigest, dependencies: [],
  } }).toBytes()
}
it.each(['buy', 'list', 'cancel-listing'] as const)('reads canonical V1 %s output references', async kind => {
  const f = await fixture(kind); useV1Effects(f)
  expect(await f.confirm()).toBe('COMPLETE')
})
it.each(['missing', 'version', 'parent', 'type', 'identity', 'input-version'] as const)(
  'requires the V1 Soul predecessor parent proof: %s', async problem => {
    const f = await fixture('buy'); useV1Effects(f)
    const key = `${lid(12)}:2`, row = f.history.get(key)
    if (problem === 'missing') f.history.delete(key)
    if (problem === 'version') row.version = 1n
    if (problem === 'parent') row.owner.address = f.kioskId
    if (problem === 'type') row.objectType = '0x2::object::ID'
    if (problem === 'identity') {
      const soul = NativeSoulBcs.parse(row.contents.value); soul.id = lid(99)
      row.contents.value = NativeSoulBcs.serialize(soul).toBytes()
    }
    if (problem === 'input-version') {
      const effects = bcs.TransactionEffects.parse(f.ledger.effects.bcs.value)
      effects.V1!.modifiedAtVersions = effects.V1!.modifiedAtVersions.filter(([id]) => id !== lid(12))
      f.ledger.effects.bcs.value = bcs.TransactionEffects.serialize(effects).toBytes()
    }
    await expect(f.confirm()).rejects.toThrow()
  })
it('rejects final exact optional-field absence drift', async () => {
  const f = await fixture(), implementation = f.batch.getMockImplementation()!; let count = 0
  f.batch.mockImplementation(((request: any, options: any) => {
    if (++count > 1) return Promise.resolve({ response: { objects: [{ result: { oneofKind: 'error', error: { code: 14 } } }] } })
    return implementation(request, options)
  }) as any)
  await expect(f.confirm()).rejects.toThrow('Optional evidence unavailable')
})
it('rejects final immutable binding same-reference byte drift', async () => {
  const f = await fixture('buy'), implementation = f.get.getMockImplementation()!; let count = 0
  f.get.mockImplementation(((request: any, options: any) => {
    if (request.objectId === lid(13) && ++count === 2) f.edit(lid(13), NativeSoulBindingBcs, binding => { binding.maker_version = '2' })
    return implementation(request, options)
  }) as any)
  await expect(f.confirm()).rejects.toThrow('changed during readback')
})
