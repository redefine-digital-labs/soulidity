import { expect, it } from 'vitest'
import { Transaction } from '@mysten/sui/transactions'
import { bcs } from '@mysten/sui/bcs'
import { appendListAnimacraftEquipmentV8, buildBuyAnimacraftEquipmentV8Tx,
  buildCancelAnimacraftEquipmentV8Tx, buildRecoverAnimacraftEquipmentV8Tx,
  buildRepriceAnimacraftEquipmentV8Tx, type AnimacraftEquipmentMarketV8Listing } from '@soulidity/sdk'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const target = () => ({ marketCallablePackageId: id(1), paymentCoinType: '0x2::sui::SUI',
  registryId: id(2), treasuryId: id(3), rootId: id(4), protocolConfigId: id(5),
  catalogId: id(6), replacementId: id(7), packageConfigId: id(8) })
const listing = (kind: 'base' | 'external'): AnimacraftEquipmentMarketV8Listing => ({
  target: target(), listingId: id(9), expectedRevision: '9007199254740993',
  receiving: { objectId: id(10), version: '9007199254740994', digest: '1'.repeat(32) },
  ...(kind === 'base' ? { kind, packRegistryId: id(11), definitionRegistryId: id(12) } : { kind }),
})
function calls(tx: Transaction) { return tx.getData().commands.flatMap(c => c.MoveCall ? [c.MoveCall] : []) }
function values(tx: Transaction, index = 0) {
  const data = tx.getData()
  return calls(tx)[index].arguments.map(a => {
    if (!('Input' in a)) return a
    const i = data.inputs[a.Input]
    if (i.UnresolvedObject) return i.UnresolvedObject.objectId
    if (i.Object) return i.Object.Receiving
    return bcs.u64().fromBase64(i.Pure!.bytes)
  })
}

it.each(['base', 'external'] as const)('lists only the selected %s with exact production ABI order', kind => {
  const tx = new Transaction(), asset = kind === 'base'
    ? { kind, itemId: id(10), packRegistryId: id(11), definitionRegistryId: id(12), baseRegistryId: id(13) }
    : { kind, itemId: id(10), productId: id(14) }
  appendListAnimacraftEquipmentV8(tx, { target: target(), asset, priceAtomic: 10000n })
  expect(calls(tx).map(c => c.function)).toEqual([`list_${kind}_equipment_v8`])
  expect(calls(tx)[0].module).toBe('market_v8')
  expect(calls(tx)[0].package).toBe(id(1))
  expect(values(tx)).toEqual([2, 3, 4, 5, 6, 7, 8, ...(kind === 'base' ? [11, 12, 13] : [14]), 10].map(id).concat('10000'))
  expect(tx.getData().commands).toHaveLength(1)
})

it.each(['base', 'external'] as const)('buys %s using typed Receiving, exact payment and CAS revision', kind => {
  const p = { ...listing(kind), protocolTreasuryId: id(15), priceAtomic: 10001n, paymentCoinObjectIds: [id(16), id(17)] }
  const before = structuredClone(p), tx = buildBuyAnimacraftEquipmentV8Tx(p)
  expect(p).toEqual(before)
  expect(tx.getData().commands.map(c => c.$kind)).toEqual(['MergeCoins', 'SplitCoins', 'MoveCall'])
  expect(calls(tx)[0].function).toBe(`purchase_${kind}_equipment_v8`)
  expect(values(tx)).toEqual([...[9, 2, 3, 4, 5, 15, 6, 7, 8, ...(kind === 'base' ? [11, 12] : [])].map(id),
    p.receiving, { NestedResult: [1, 0], $kind: 'NestedResult' }, '9007199254740993'])
  const split = tx.getData().commands[1].SplitCoins!
  const amount = split.amounts[0] as { Input: number }
  expect(bcs.u64().fromBase64(tx.getData().inputs[amount.Input].Pure!.bytes)).toBe('10001')
})

it.each(['base', 'external'] as const)('cancel/recover %s never adds payment or an arbitrary recipient', kind => {
  const p = listing(kind)
  for (const recover of [false, true]) {
    const tx = (recover ? buildRecoverAnimacraftEquipmentV8Tx : buildCancelAnimacraftEquipmentV8Tx)(p)
    expect(calls(tx)[0].function).toBe(`${recover ? 'recover' : 'cancel'}_${kind}_equipment_listing_v8`)
    expect(values(tx)).toEqual([...[9, 2, 3, 4, ...(recover ? [5] : []), 6, 7, 8,
      ...(kind === 'base' ? [11, 12] : [])].map(id), p.receiving, '9007199254740993'])
    expect(tx.getData().commands).toHaveLength(1)
  }
})

it('reprices the existing listing with expected revision before price, never cancel/relist', () => {
  const tx = buildRepriceAnimacraftEquipmentV8Tx({ target: target(), listingId: id(9), expectedRevision: '7', priceAtomic: 40n })
  expect(calls(tx)[0].function).toBe('reprice_equipment_listing_v8')
  expect(values(tx)).toEqual([...[9, 2, 3, 4, 5, 6, 7, 8].map(id), '7', '40'])
})

it.each([0n, 39n, -1n, 1n << 64n, 10000 as never])('rejects invalid price %s before append', priceAtomic => {
  const tx = new Transaction(); tx.moveCall({ target: `${id(1)}::existing::call` })
  const before = tx.getData()
  expect(() => appendListAnimacraftEquipmentV8(tx, { target: target(),
    asset: { kind: 'external', itemId: id(10), productId: id(14) }, priceAtomic })).toThrow()
  expect(tx.getData()).toEqual(before)
})

it.each(['bad version', 'bad digest', 'stale numeric revision', 'alias receiving', 'alias payment', 'duplicate coin', 'zero id', 'unknown kind'])('rejects %s', label => {
  const p = { ...listing('base'), protocolTreasuryId: id(15), priceAtomic: 10000n, paymentCoinObjectIds: [id(16)] }
  if (label === 'bad version') p.receiving.version = '01'
  if (label === 'bad digest') p.receiving.digest = 'bad'
  if (label === 'stale numeric revision') p.expectedRevision = 1 as never
  if (label === 'alias receiving') p.receiving.objectId = p.listingId
  if (label === 'alias payment') p.paymentCoinObjectIds = [p.target.rootId]
  if (label === 'duplicate coin') p.paymentCoinObjectIds.push(id(16))
  if (label === 'zero id') p.target.registryId = id(0)
  if (label === 'unknown kind') p.kind = 'physical' as never
  expect(() => buildBuyAnimacraftEquipmentV8Tx(p)).toThrow()
})
