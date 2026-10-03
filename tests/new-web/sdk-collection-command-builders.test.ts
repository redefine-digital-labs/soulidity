import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Transaction } from '@mysten/sui/transactions'
import { bcs } from '@mysten/sui/bcs'
import { buildListCollectionTx, buildDelistCollectionTx, buildUpdateCollectionListingPriceTx } from '@soulidity/sdk'

const id = (n: number) => '0x' + n.toString(16).padStart(64, '0')
const target = { packageId: id(1), marketConfigId: id(2), kioskRegistryId: id(3) }
const common = { currentKioskId: id(10), currentKioskCapOnChainId: id(11), collectionObjectId: id(12),
  listingObjectId: id(13), priceAtomic: 9007199254740993n, newPriceAtomic: 9007199254740994n }
const builders = {
  list: (explicit = false, tx?: Transaction) => buildListCollectionTx(common, explicit ? target : undefined, tx),
  delist: (explicit = false, tx?: Transaction) => buildDelistCollectionTx(common, explicit ? { packageId: target.packageId } : undefined, tx),
  reprice: (explicit = false, tx?: Transaction) => buildUpdateCollectionListingPriceTx(common, explicit ? target : undefined, tx),
}
const names = {
  list: ['ensure_personal_kiosk_registered_v2', 'list_collection_right_fixed_price_v2', 'finalize_collection_listing'],
  delist: ['cancel_collection_listing'],
  reprice: ['cancel_collection_listing', 'ensure_personal_kiosk_registered_v2', 'list_collection_right_fixed_price_v2', 'finalize_collection_listing'],
}
type Action = keyof typeof builders
const actions = Object.keys(builders) as Action[]
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID', target.packageId)
  vi.stubEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID', target.marketConfigId)
  vi.stubEnv('NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID', target.kioskRegistryId)
})
afterEach(() => vi.unstubAllEnvs())
it.each(actions)('%s preserves existing one-argument caller semantics', action => {
  const original = builders[action](), explicit = builders[action](true)
  expect(original).not.toBe(explicit)
  expect(original.getData()).toEqual(explicit.getData())
  expect(original.getData().commands.map(c => c.MoveCall?.function)).toEqual(names[action])
})
it.each(actions)('%s uses only the frozen target despite contradictory ambient configuration', action => {
  for (const key of ['CALLABLE_PACKAGE_ID', 'MARKET_CONFIG_V2_ID', 'KIOSK_REGISTRY_ID'])
    vi.stubEnv('NEXT_PUBLIC_SOULIDITY_' + key, 'not-an-object-id')
  const data = builders[action](true).getData()
  expect(data.commands.every(c => c.MoveCall?.package === target.packageId)).toBe(true)
  const objects = data.inputs.flatMap(input => input.UnresolvedObject ? [input.UnresolvedObject.objectId] : [])
  if (action !== 'delist') { expect(objects).toContain(target.marketConfigId); expect(objects).toContain(target.kioskRegistryId) }
  else { expect(objects).not.toContain(target.marketConfigId); expect(objects).not.toContain(target.kioskRegistryId) }
})
it.each(actions)('%s appends to the same precondition transaction without replacing prefix, refs or result indices', action => {
  const tx = new Transaction()
  tx.moveCall({ target: target.packageId + '::market::assert_collection_command_snapshot',
    arguments: [tx.sharedObjectRef({ objectId: common.collectionObjectId, initialSharedVersion: '7', mutable: false }), tx.pure.vector('u8', [1, 2, 3])] })
  tx.moveCall({ target: target.packageId + '::market::guard_fixture', arguments: [tx.pure.u64('42')] })
  tx.objectRef({ objectId: common.currentKioskCapOnChainId, version: '8', digest: '11111111111111111111111111111111' })
  tx.setSender(id(99)); tx.setGasBudget('9000')
  const prefix = structuredClone(tx.getData().commands)
  expect(builders[action](true, tx)).toBe(tx)
  const data = tx.getData()
  expect(data.commands.slice(0, 2)).toEqual(prefix)
  expect(data.commands.slice(2).map(c => c.MoveCall?.function)).toEqual(names[action])
  expect(data.sender).toBe(id(99)); expect(data.gasData.budget).toBe('9000')
  expect(data.inputs.find(input => input.Object?.ImmOrOwnedObject)?.Object?.ImmOrOwnedObject).toMatchObject({
    objectId: common.currentKioskCapOnChainId, version: '8',
  })
  if (action !== 'delist') {
    expect(data.inputs.filter(input => input.Object?.SharedObject?.objectId === common.collectionObjectId)).toHaveLength(1)
    const final = data.commands.at(-1)!.MoveCall!
    expect(final.arguments).toEqual([{ Result: data.commands.length - 2, $kind: 'Result' }])
    const listing = data.commands.at(-2)!.MoveCall!, priceArg = listing.arguments.at(-1)!
    expect(priceArg.$kind).toBe('Input')
    if (priceArg.$kind !== 'Input') throw Error('Missing price input')
    const price = data.inputs[priceArg.Input].Pure!.bytes
    expect(bcs.u64().parse(Buffer.from(price, 'base64'))).toBe(String(action === 'list' ? common.priceAtomic : common.newPriceAtomic))
  }
})
it.each([0n, -1n])('retains positive-price validation for standalone and appended requests: %s', price => {
  expect(() => buildListCollectionTx({ ...common, priceAtomic: price }, target, new Transaction())).toThrow('positive')
  expect(() => buildUpdateCollectionListingPriceTx({ ...common, newPriceAtomic: price }, target, new Transaction())).toThrow('positive')
})
