import { expect, it } from 'vitest'
import { Transaction } from '@mysten/sui/transactions'
import { bcs } from '@mysten/sui/bcs'
import { fromBase64 } from '@mysten/sui/utils'
import { buildCollectionAuthoringInput } from '../../web/lib/soulidity/collection-authoring-input'
import { createSoulAuthoringTransactionComposer } from '../../web/lib/soulidity/soul-authoring-transaction'
import { soulAuthoringRequestFixture, soulAuthoringManifestFixture } from './fixtures/soul-authoring'
const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
it.each(['99999999999999999999', '9007199254740993'])('actual launch writer freezes and serializes exact floor %s', async floor => {
  const params = { name: 'Collection', description: 'Description', coverImageFile: new File(['cover'], 'cover.png'),
    extraRoyaltyBps: 250, tradeable: true, floorPriceAtomic: floor, souls: [] }
  const pending = buildCollectionAuthoringInput(params, soulAuthoringRequestFixture(id(10)).target, id(10), new AbortController().signal)
  params.floorPriceAtomic = '0'
  const built = await pending
  const f = await soulAuthoringManifestFixture(r => { r.collection = built.request.collection; r.mints = [] })
  const tx = new Transaction()
  createSoulAuthoringTransactionComposer(f.manifest, f.preparation).appendRegistrationBusiness(tx,
    { kind: 'EXISTING', kioskId: id(20), capId: id(21) })
  const call = tx.getData().commands.flatMap(c => c.MoveCall ? [c.MoveCall] : [])
    .find(c => c.function === 'create_collection_in_personal_kiosk_v2')!
  expect(bcs.option(bcs.u128()).parse(fromBase64(tx.getData().inputs[(call.arguments[11] as any).Input].Pure!.bytes))).toBe(floor)
  expect(built.request.collection?.floorPriceAtomic).toBe(floor)
})
