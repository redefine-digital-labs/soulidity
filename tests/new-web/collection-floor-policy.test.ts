import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { Transaction } from '@mysten/sui/transactions'
import { bcs } from '@mysten/sui/bcs'
import { fromBase64 } from '@mysten/sui/utils'
import { normalizeCollectionFloorAtomic, isBelowCollectionFloor, MAX_COLLECTION_FLOOR_ATOMIC as max } from '../../packages/soulidity-sdk/src/collection-floor-policy'
import { appendCreateCollectionMoveCalls, buildCreateCollectionTx, buildCreateCollectionWithListTx } from '../../packages/soulidity-sdk/src/tx/collection'
const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const base = { currentKioskId: id(10), currentKioskCapOnChainId: id(11), name: 'Collection', description: 'Description',
  imageUrl: 'https://example.com/image', extraRoyaltyBps: 250, tradeable: true }
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUI_NETWORK', 'mainnet')
  for (const [key, value] of Object.entries({ CALLABLE_PACKAGE_ID: id(1), MARKET_CONFIG_V2_ID: id(2),
    KIOSK_REGISTRY_ID: id(3), COLLECTION_TRANSFER_POLICY_ID: id(5) })) vi.stubEnv(`NEXT_PUBLIC_SOULIDITY_${key}`, value)
})
afterEach(() => vi.unstubAllEnvs())
function floor(tx: Transaction) {
  const call = tx.getData().commands.flatMap(c => c.MoveCall ? [c.MoveCall] : [])
    .find(c => c.function === 'create_collection_in_personal_kiosk_v2')!
  expect(call.arguments).toHaveLength(12)
  const arg = call.arguments[11] as { Input: number }
  return bcs.option(bcs.u128()).parse(fromBase64(tx.getData().inputs[arg.Input].Pure!.bytes))
}
it.each([undefined, null, '0', '18446744073709551616', max.toString()])('all three real builders preserve %s', async value => {
  const params = { ...base, floorPriceAtomic: value }
  const tx = new Transaction()
  const created = appendCreateCollectionMoveCalls(tx, params); created.finalizeCollection(); created.finalizePersonalKiosk()
  for (const built of [tx, await buildCreateCollectionTx(params),
    await buildCreateCollectionWithListTx({ ...params, collectionRightListingPriceAtomic: 100n })]) {
    expect(floor(built)).toBe(value ?? null)
  }
})
it.each([-1n, max + 1n, '1.1', 'bad', 9007199254740992, {}, '', '-1'])('rejects invalid %s before callbacks', async value => {
  const attachBeforeCreate = vi.fn()
  await expect(buildCreateCollectionTx({ ...base, floorPriceAtomic: value as any, attachBeforeCreate })).rejects.toThrow('COLLECTION_FLOOR_INVALID')
  expect(attachBeforeCreate).not.toHaveBeenCalled()
})
it('snapshots floor before asynchronous attachment and compares without precision loss', async () => {
  const params = { ...base, floorPriceAtomic: max.toString(), attachBeforeCreate: async () => { params.floorPriceAtomic = '0' } }
  expect(floor(await buildCreateCollectionTx(params))).toBe(max.toString())
  expect(normalizeCollectionFloorAtomic('000')).toBe(0n)
  expect(isBelowCollectionFloor(max - 1n, max)).toBe(true)
  expect(isBelowCollectionFloor(max, max)).toBe(false)
  expect(isBelowCollectionFloor(1n, null)).toBe(false)
  expect(isBelowCollectionFloor(1n, '0')).toBe(false)
})
