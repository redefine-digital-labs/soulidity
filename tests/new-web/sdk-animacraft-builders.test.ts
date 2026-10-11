import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Transaction } from '@mysten/sui/transactions'
import { buildListSoulTx, buildUpdateListingPriceTx } from '@soulidity/sdk'

const id = (character: string) => '0x' + character.repeat(64)
const KIOSK_ID = id('7'), KIOSK_CAP_ID = id('8')
function moveCalls(tx: Transaction) { return tx.getData().commands.filter(c => c.$kind === 'MoveCall').map(c => c.MoveCall!) }
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID', id('1'))
  vi.stubEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID', id('9'))
  vi.stubEnv('NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID', id('5'))
  vi.stubEnv('NEXT_PUBLIC_SUI_NETWORK', 'mainnet')
})
afterEach(() => vi.unstubAllEnvs())

// Ordinary V2/generic rejection cases are retained unchanged. Retired issuer,
// V5 economics and V6 equipped-transfer evidence is preserved under fixtures,
// not counted as passing native capability acceptance.
describe('Generic listing builders reject obsolete Animacraft paths', () => {
  const base = { currentKioskId: KIOSK_ID, currentKioskCapOnChainId: KIOSK_CAP_ID,
    stateObjectId: id('c'), priceAtomic: 1_000_000n }
  it.each([null, id('e')])('lists ordinary Souls with V2 config and collection %s', collectionObjectId => {
    const calls = moveCalls(buildListSoulTx({ ...base, collectionObjectId }))
    expect(calls.map(call => call.function)).toEqual(['ensure_personal_kiosk_registered_v2',
      collectionObjectId ? 'list_soul_fixed_price_with_collection_v2' : 'list_soul_fixed_price_v2', 'finalize_soul_listing'])
  })
  it.each([4,5,6,7,8])('rejects Animacraft version %i in generic list/update', animacraftVersion => {
    expect(() => buildListSoulTx({ ...base, animacraftVersion })).toThrow('native V8')
    expect(() => buildUpdateListingPriceTx({ ...base, listingObjectId: id('f'),
      newPriceAtomic: 2_000_000n, animacraftVersion })).toThrow('native V8')
  })
  it.each([id('d'), ''])('rejects provenance %s even without a version hint', animacraftProvenanceObjectId => {
    expect(() => buildListSoulTx({ ...base, animacraftProvenanceObjectId })).toThrow('native V8')
    expect(() => buildUpdateListingPriceTx({ ...base, listingObjectId: id('f'),
      newPriceAtomic: 2_000_000n, animacraftProvenanceObjectId })).toThrow('native V8')
  })
})
