import { bcs, TypeTagSerializer } from '@mysten/sui/bcs'
import { expect, it, vi } from 'vitest'
import { readAuthenticatedEquipmentPurchaseCustody } from '../../web/lib/animacraft/browser-equipment-market-readback'
import { queryEquipmentMarketOperationEvidence } from '../../web/lib/animacraft/equipment-market-operation-evidence'
import { createEquipmentPurchaseOriginal, parseEquipmentPurchaseOriginal } from '../../web/lib/animacraft/equipment-market-purchase-original'
import { EquipmentMarketListingBcs } from '../../web/lib/animacraft/native-equipment-market-bcs'
import { activityHash } from './fixtures/activity-transaction-evidence'
import { equipmentMarketReadbackFixture } from './fixtures/equipment-market-readback'
import { equipmentMarketOperationFixture, emid } from './fixtures/equipment-market-operation'

vi.mock('../../web/lib/sui/package-object-client', () => ({ withPackageObjectIdentity: (client: unknown) => client }))

it.each(['base', 'external'] as const)('exports and reopens a %s purchase without journal authority', async kind => {
  const { record, itemId } = await equipmentMarketOperationFixture({ action: 'buy', kind })
  const file = createEquipmentPurchaseOriginal({ ...record, phase: 'SUCCEEDED', syncStatus: 'COMPLETE', signature: 'omitted' })
  expect(Object.keys(file.packet).sort()).toEqual(['bytes', 'digest', 'expirationEpoch'])
  expect(Object.keys(file).sort()).toEqual(['packet', 'paymentCoins', 'priceAtomic', 'schema', 'snapshot'])
  expect(parseEquipmentPurchaseOriginal(JSON.parse(JSON.stringify(file)), itemId)).toMatchObject({
    phase: 'PREPARED', signature: null, digest: record.digest, bytes: record.bytes, snapshot: record.snapshot,
  })
  expect(() => parseEquipmentPurchaseOriginal(file, emid(999))).toThrow('Original component ID mismatch')
  expect(() => parseEquipmentPurchaseOriginal({ ...file, packet: { ...file.packet, signature: 'forged' } }, itemId)).toThrow('original fields')
})

async function custodyFixture(kind: 'base' | 'external', mutateActive?: (value: ReturnType<typeof EquipmentMarketListingBcs.parse>) => void) {
  const f = await equipmentMarketReadbackFixture('buy', kind)
  const { record, listing, item, effects, history } = f, s = record.snapshot
  const previous = f.digest(16), shared = { Shared: { initialSharedVersion: '1' } }
  function full(row: typeof listing, owner: Parameters<typeof bcs.Owner.serialize>[0]) {
    const tag = TypeTagSerializer.parseFromStr(row.objectType).struct!
    row.bcs = { value: bcs.Object.serialize({
      data: { Move: { type: { Other: tag }, version: row.version, hasPublicTransfer: true, contents: row.contents.value } },
      owner, previousTransaction: row.previousTransaction, storageRebate: 0,
    }).toBytes() }
    row.digest = activityHash('Object', row.bcs.value)
    history.set(f.historyKey(row.objectId, row.version), structuredClone(row))
  }
  const active = EquipmentMarketListingBcs.parse(listing.contents.value)
  active.status = 0; active.revision = s.listing!.revision; active.terminal_recipient = emid(0)
  mutateActive?.(active)
  const prior = { ...listing, version: 2n, previousTransaction: previous, contents: { value: EquipmentMarketListingBcs.serialize(active).toBytes() } }
  full(prior, shared)
  full(listing, shared)
  full(item, { AddressOwner: s.actor })
  const listingEffect = effects.V2.changedObjects.find(([id]) => id === listing.objectId)![1]
  listingEffect.inputState = { Exist: [['2', prior.digest], shared] }
  listingEffect.outputState.ObjectWrite[0] = listing.digest
  effects.V2.changedObjects.find(([id]) => id === item.objectId)![1].outputState.ObjectWrite[0] = item.digest
  f.refresh()
  const original = await queryEquipmentMarketOperationEvidence(record, f.client)
  if (original.status !== 'SUCCEEDED') throw Error('Fixture purchase unavailable')
  const verify = () => readAuthenticatedEquipmentPurchaseCustody(record, original, f.client, new AbortController().signal)
  return { f, verify }
}

it.each(['base', 'external'] as const)('binds the original %s listing, delivered type and subsequent holder', async kind => {
  const { f, verify } = await custodyFixture(kind)
  const { snapshot: s } = f.record
  const expected = { itemType: f.item.objectType, sourceId: s.asset.kind === 'base' ? s.asset.baseRegistryId : s.asset.productId, originalHolder: s.actor }
  await expect(verify()).resolves.toMatchObject({ ...expected, status: 'COMPLETE', currentHolder: s.actor })
  f.laterHolder(emid(808), String(BigInt(s.ownershipEpoch) + 2n))
  await expect(verify()).resolves.toMatchObject({ ...expected, status: 'SUPERSEDED', currentHolder: emid(808) })
})

it('rejects an original active listing with a different source even if the settlement projection agrees', async () => {
  const { verify } = await custodyFixture('external', value => { value.custody.source_id = emid(808) })
  await expect(verify()).rejects.toThrow('Original component listing or delivery mismatch')
})

it('requires the full original delivered object, not a projection with the effects digest', async () => {
  const { f, verify } = await custodyFixture('external')
  delete f.history.get(f.historyKey(f.item.objectId, 3n)).bcs
  await expect(verify()).rejects.toThrow('BCS_BUDGET')
})
