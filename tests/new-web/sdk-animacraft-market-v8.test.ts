import { describe, expect, it } from 'vitest'
import { Inputs, Transaction } from '@mysten/sui/transactions'
import { bcs } from '@mysten/sui/bcs'
import { fromBase64 } from '@mysten/sui/utils'
import {
  appendListAnimacraftV8Soul, buildListAnimacraftV8SoulTx,
  buildBuyAnimacraftV8SoulTx, buildCancelAnimacraftV8SoulListingTx,
  buildRepriceAnimacraftV8SoulTx,
} from '../../packages/soulidity-sdk/src/tx/animacraft-market-v8'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const target = { soulidityCallablePackageId: id(1), marketConfigV2Id: id(2), kioskRegistryId: id(3),
  soulTransferPolicyId: id(4), kioskPackageId: id(5) }
const listing = () => ({ target: { ...target }, soulStateId: id(10), provenanceBindingId: id(11),
  currentKioskId: id(12), currentKioskCapOnChainId: id(13), priceAtomic: 10001n })
const cancel = () => ({ soulidityCallablePackageId: id(1), soulStateId: id(10), listingId: id(14),
  currentKioskId: id(12), currentKioskCapOnChainId: id(13) })
const buy = () => ({ target: { ...target }, soulStateId: id(10), provenanceBindingId: id(11),
  listingId: id(14), sellerKioskId: id(12), buyerKioskId: id(15), buyerKioskCapOnChainId: id(16),
  priceAtomic: 10001n, paymentCoinObjectIds: [id(17), id(18)] })
const moves = (tx: Transaction) => tx.getData().commands.flatMap(c => c.MoveCall ? [c.MoveCall] : [])
function objectArgs(tx: Transaction, args: any[]) {
  const inputs = tx.getData().inputs
  return args.map(arg => arg.Input === undefined ? arg : inputs[arg.Input]?.UnresolvedObject?.objectId
    ?? inputs[arg.Input]?.Object?.SharedObject?.objectId ?? inputs[arg.Input]?.Object?.ImmOrOwnedObject?.objectId)
}
function amount(tx: Transaction, arg: any) {
  return BigInt(bcs.u64().parse(fromBase64(tx.getData().inputs[arg.Input].Pure!.bytes)))
}
async function roundtrip(tx: Transaction) {
  // Object resolver fixture only: tests real SDK BCS, not live ownership/dry run.
  const resolve = async (data: any, _options: any, next: () => Promise<void>) => {
    data.inputs = data.inputs.map((input: any) => input.UnresolvedObject
      ? Inputs.SharedObjectRef({ objectId: input.UnresolvedObject.objectId, initialSharedVersion: '1', mutable: true }) : input)
    await next()
  }
  const bytes = await tx.build({ onlyTransactionKind: true,
    client: { core: { resolveTransactionPlugin: () => resolve } } as any })
  const restored = Transaction.fromKind(bytes)
  expect(await restored.build({ onlyTransactionKind: true })).toEqual(bytes)
  return restored
}

describe('native Soul Market exact SDK transaction assembly', () => {
  it('lists the native provenance and finalizes exactly the returned shared listing', async () => {
    const tx = buildListAnimacraftV8SoulTx(listing())
    const calls = moves(tx)
    expect(calls.map(c => c.function)).toEqual(['ensure_personal_kiosk_registered_v2',
      'list_animacraft_v8_soul_fixed_price', 'finalize_soul_listing'])
    expect(calls.every(c => c.package === id(1) && c.module === 'market' && c.typeArguments.length === 0)).toBe(true)
    expect(objectArgs(tx, calls[0].arguments)).toEqual([id(2), id(3), id(13)])
    expect(objectArgs(tx, calls[1].arguments.slice(0, 6))).toEqual([id(2), id(3), id(11), id(12), id(13), id(10)])
    expect(amount(tx, calls[1].arguments[6])).toBe(10001n)
    expect(calls[2].arguments[0]).toMatchObject({ Result: 1 })
    expect(moves(await roundtrip(tx))[1].function).toBe('list_animacraft_v8_soul_fixed_price')
  })
  it('cancel is a single native call without configuration, quotes or coin commands', async () => {
    const tx = buildCancelAnimacraftV8SoulListingTx(cancel())
    expect(tx.getData().commands).toHaveLength(1)
    expect(moves(tx)[0].function).toBe('cancel_animacraft_v8_soul_listing')
    expect(objectArgs(tx, moves(tx)[0].arguments)).toEqual([id(12), id(13), id(10), id(14)])
    await roundtrip(tx)
  })
  it('reprices in one transaction and finalizes the new listing, not the cancelled one', async () => {
    const tx = buildRepriceAnimacraftV8SoulTx({ ...listing(), listingId: id(14), priceAtomic: 777n })
    const calls = moves(tx)
    expect(calls.map(c => c.function)).toEqual(['cancel_animacraft_v8_soul_listing',
      'ensure_personal_kiosk_registered_v2', 'list_animacraft_v8_soul_fixed_price', 'finalize_soul_listing'])
    expect(amount(tx, calls[2].arguments[6])).toBe(777n)
    expect(calls[3].arguments[0]).toMatchObject({ Result: 2 })
    await roundtrip(tx)
  })
  it('purchases for the exact gross amount and existing buyer kiosk without legacy inputs', async () => {
    const tx = buildBuyAnimacraftV8SoulTx(buy())
    const calls = moves(tx)
    expect(calls.map(c => c.function)).toEqual(['ensure_personal_kiosk_registered_v2', 'buy_animacraft_v8_soul_fixed_price'])
    expect(objectArgs(tx, calls[1].arguments.slice(0, 9))).toEqual([id(2), id(3), id(4), id(11), id(12), id(15), id(16), id(10), id(14)])
    const split = tx.getData().commands.find(c => c.SplitCoins)!.SplitCoins!
    expect(amount(tx, split.amounts[0])).toBe(10001n)
    const splitIndex = tx.getData().commands.findIndex(c => c.SplitCoins)
    expect(calls[1].arguments[9]).toMatchObject({ NestedResult: [splitIndex, 0] })
    expect(tx.getData().inputs.filter(i => i.UnresolvedObject).map(i => i.UnresolvedObject!.objectId)).not.toContain(id(0))
    await roundtrip(tx)
  })
  it('creates, registers, uses, shares and returns a new buyer kiosk in the same PTB', async () => {
    const tx = buildBuyAnimacraftV8SoulTx({ ...buy(), buyerKioskId: null, buyerKioskCapOnChainId: null })
    const calls = moves(tx)
    expect(calls.map(c => c.function)).toEqual(['new', 'new', 'ensure_personal_kiosk_registered_v2',
      'buy_animacraft_v8_soul_fixed_price', 'public_share_object', 'transfer_to_sender'])
    expect(calls[1].package).toBe(id(5)); expect(calls[5].package).toBe(id(5))
    expect(calls[3].arguments[5]).toMatchObject({ NestedResult: [0, 0] })
    expect(calls[3].arguments[6]).toMatchObject({ NestedResult: [1, 0] })
    expect(calls[4].arguments[0]).toMatchObject({ NestedResult: [0, 0] })
    expect(calls[5].arguments[0]).toMatchObject({ NestedResult: [1, 0] })
    await roundtrip(tx)
  })
  it('appends after an explicit preparation command without implicitly removing equipment', () => {
    const tx = new Transaction()
    tx.moveCall({ target: `${id(1)}::animacraft_equipment_adapter_v8::close_empty_equipment_v8`, arguments: [] })
    appendListAnimacraftV8Soul(tx, listing())
    expect(moves(tx).map(c => c.function)).toEqual(['close_empty_equipment_v8',
      'ensure_personal_kiosk_registered_v2', 'list_animacraft_v8_soul_fixed_price', 'finalize_soul_listing'])
    expect(moves(tx).at(-1)!.arguments[0]).toMatchObject({ Result: 2 })
  })
  it.each([0n, -1n, 1n << 64n, 1, '100', NaN])('rejects invalid exact price %s before assembling', value => {
    expect(() => buildListAnimacraftV8SoulTx({ ...listing(), priceAtomic: value as bigint })).toThrow('priceAtomic')
    expect(() => buildBuyAnimacraftV8SoulTx({ ...buy(), priceAtomic: value as bigint })).toThrow('priceAtomic')
    expect(() => buildRepriceAnimacraftV8SoulTx({ ...listing(), listingId: id(14), priceAtomic: value as bigint })).toThrow('priceAtomic')
  })
  it.each(Object.keys(target))('requires explicit canonical target %s, not environment fallback', field => {
    for (const value of [undefined, '', '0x1', id(0)]) {
      const bad = { ...target, [field]: value } as any
      expect(() => buildListAnimacraftV8SoulTx({ ...listing(), target: bad })).toThrow(field)
      expect(() => buildBuyAnimacraftV8SoulTx({ ...buy(), target: bad })).toThrow(field)
    }
  })
  it('rejects missing native identity, malformed cancellation and mismatched buyer kiosk pair', () => {
    expect(() => buildListAnimacraftV8SoulTx({ ...listing(), provenanceBindingId: '' })).toThrow('provenanceBindingId')
    expect(() => buildCancelAnimacraftV8SoulListingTx({ ...cancel(), listingId: id(0) })).toThrow('listingId')
    expect(() => buildBuyAnimacraftV8SoulTx({ ...buy(), buyerKioskId: null })).toThrow('together')
    expect(() => buildBuyAnimacraftV8SoulTx({ ...buy(), buyerKioskCapOnChainId: null })).toThrow('together')
    expect(() => buildBuyAnimacraftV8SoulTx({ ...buy(), buyerKioskId: id(12) })).toThrow('must differ')
    expect(() => buildBuyAnimacraftV8SoulTx({ ...buy(), buyerKioskId: '' })).toThrow('buyerKioskId')
  })
  it.each([[], [id(17), id(17)], ['0x1'], [id(0)]])('rejects invalid payment selection %j', paymentCoinObjectIds => {
    expect(() => buildBuyAnimacraftV8SoulTx({ ...buy(), paymentCoinObjectIds })).toThrow()
  })
  it('does not retain mutable caller input', () => {
    const params = listing(); const tx = buildListAnimacraftV8SoulTx(params)
    params.target.soulidityCallablePackageId = id(99); params.provenanceBindingId = id(98); params.priceAtomic = 5n
    expect(moves(tx)[1].package).toBe(id(1))
    expect(objectArgs(tx, moves(tx)[1].arguments)[2]).toBe(id(11))
    expect(amount(tx, moves(tx)[1].arguments[6])).toBe(10001n)
  })
})
