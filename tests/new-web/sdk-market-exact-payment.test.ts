import { bcs } from '@mysten/sui/bcs'
import { Transaction } from '@mysten/sui/transactions'
import { buildBuyCollectionTx, buildExactPaymentCoin } from '@soulidity/sdk'
import { expect, it } from 'vitest'

const id = (n: number) => '0x' + n.toString(16).padStart(64, '0')
const target = { packageId: id(1), marketConfigId: id(2), kioskRegistryId: id(3),
  collectionPolicyId: id(4), kioskPackageId: id(5) }
const params = {
  sellerKioskId: id(6), collectionObjectId: id(7), listingObjectId: id(8),
  buyerKioskId: id(9), buyerKioskCapOnChainId: id(10),
  totalAtomic: 1n, paymentCoinObjectIds: [id(11)],
}
const invalid = [
  { label: 'zero total', totalAtomic: 0n },
  { label: 'out-of-range total', totalAtomic: 1n << 64n },
  { label: 'same coin in short and full forms', paymentCoinObjectIds: ['0xB', id(11)] },
  { label: 'malformed ID', paymentCoinObjectIds: ['not-a-coin'] },
  { label: 'no coins', paymentCoinObjectIds: [] },
]

it.each(invalid)('preserves the caller’s prior commands on Collection Right purchase with $label', override => {
  const tx = new Transaction()
  tx.moveCall({ target: `${id(1)}::market::assert_collection_command_snapshot`, arguments: [tx.object(id(7))] })
  const before = structuredClone(tx.getData())
  expect(() => buildBuyCollectionTx({ ...params, ...override }, target, tx)).toThrow()
  expect(tx.getData()).toEqual(before)
})

it('rejects an overflowing payment before adding merge inputs to the supplied transaction', () => {
  const tx = new Transaction()
  const before = structuredClone(tx.getData())
  expect(() => buildExactPaymentCoin(tx, [id(11), id(12)], 1n << 64n)).toThrow()
  expect(tx.getData()).toEqual(before)
})

it('splits an exact maximum u64 from a valid short-form coin', () => {
  const tx = new Transaction()
  const total = (1n << 64n) - 1n
  buildExactPaymentCoin(tx, ['0xB'], total)
  const data = tx.getData()
  expect(data.inputs[0].UnresolvedObject?.objectId).toBe(id(11))
  const split = data.commands.find(command => command.SplitCoins)?.SplitCoins
  expect(split).toBeDefined()
  const amount = split!.amounts[0]
  expect(amount.$kind).toBe('Input')
  if (amount.$kind !== 'Input') throw Error('Expected an exact pure amount')
  expect(bcs.u64().parse(Buffer.from(data.inputs[amount.Input].Pure!.bytes, 'base64'))).toBe(String(total))
})
