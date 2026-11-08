import { expect, it } from 'vitest'
import { CollectionKioskListingFieldBcs, SoulPublicCollectionBcs, SoulPublicCollectionRightBcs, SoulPublicMarketConfigBcs } from '@soulidity/sdk'
import { CollectionBuyLockBcs } from '../../web/lib/collections/collection-buy-plan'
import { readCollectionBuyHandoff } from '../../web/lib/collections/collection-buy-handoff'
import { collectionCommandMarker } from '../../web/lib/collections/collection-command-plan'
import { collectionBuyFixture, installCollectionBuyAfterFixture } from './fixtures/collection-buy'

async function fixture(newKiosk = false) {
  const f = await collectionBuyFixture({ newKiosk, addressGas: true, sellerLocked: true })
  const outcome = await f.adapter.query(f.record)
  expect(outcome.status).toBe('SUCCEEDED')
  expect(outcome.receipt).toBeDefined()
  installCollectionBuyAfterFixture(f)
  f.client.ledgerService.batchGetObjects.mockClear()
  return { f, read: () => readCollectionBuyHandoff({ client: f.params.client, plan: f.plan, receipt: outcome.receipt! }) }
}

it.each([false, true])('reads the exact original buyer Kiosk, Cap and lock in a paused market (new Kiosk: %s)', async newKiosk => {
  const { f, read } = await fixture(newKiosk)
  f.current.set(f.market.id, f.full(f.market.id, f.types.market, SoulPublicMarketConfigBcs,
    { ...f.market, secondary_enabled: false }, { Shared: { initialSharedVersion: '1' } }, '50'))
  await expect(read()).resolves.toEqual({ status: 'BUYER_HANDOFF_VERIFIED', holder: f.author,
    kioskId: f.buyerKiosk.id, kioskCapId: f.cap.id, lockId: f.destinationLockId, rightId: f.right.id,
    reserved: false, formerKioskId: f.sellerKiosk.id, formerKioskCustodyAndReservationsAbsent: true })
  expect(f.client.ledgerService.batchGetObjects.mock.calls.flatMap(([r]) => r.requests.map(request => request.objectId))).not.toContain(f.market.id)
  expect(f.client.core.executeTransaction).not.toHaveBeenCalled()
  expect(f.client.transactionExecutionService.simulateTransaction).not.toHaveBeenCalled()
})

it.each(['cap', 'lock', 'former lock'])('fails closed on missing or contradictory %s proof', async mode => {
  const { f, read } = await fixture()
  if (mode === 'cap') f.current.delete(f.cap.id)
  if (mode === 'lock') f.current.set(f.destinationLockId, f.full(f.destinationLockId, f.types.lock, CollectionBuyLockBcs,
    { id: f.destinationLockId, name: { id: f.right.id }, value: false }, { ObjectOwner: f.buyerKiosk.id }, '50'))
  if (mode === 'former lock') f.current.set(f.sourceLockId, f.rows.get(`${f.sourceLockId}:11`))
  await expect(read()).rejects.toThrow(mode === 'cap' ? 'OBJECT_UNAVAILABLE' : mode === 'lock' ? 'HANDOFF_LOCK' : 'HANDOFF_FORMER_KIOSK')
})

it('observes a current reservation without inferring a new transaction quote', async () => {
  const { f, read } = await fixture()
  const marker = collectionCommandMarker(f.buyerKiosk.id, f.right.id, true)
  f.current.set(marker, f.full(marker, f.types.marker, CollectionKioskListingFieldBcs,
    { id: marker, name: { id: f.right.id, is_exclusive: true }, value: '0' }, { ObjectOwner: f.buyerKiosk.id }, '50'))
  await expect(read()).resolves.toMatchObject({ status: 'BUYER_HANDOFF_VERIFIED', reserved: true })
})

it('reports later custody after verifying the new holder’s actual Right and item', async () => {
  const { f, read } = await fixture()
  f.current.set(f.c.id, f.full(f.c.id, f.types.collection, SoulPublicCollectionBcs, f.c, { Shared: { initialSharedVersion: '1' } }, '50'))
  f.current.set(f.itemId, f.rows.get(`${f.itemId}:11`))
  f.current.set(f.sellerKiosk.id, f.rows.get(`${f.sellerKiosk.id}:11`))
  f.current.set(f.right.id, f.full(f.right.id, f.types.right, SoulPublicCollectionRightBcs, f.right, { ObjectOwner: f.itemId }, '50'))
  await expect(read()).resolves.toEqual({ status: 'CUSTODY_CHANGED', holder: f.plan.sellerAddress, kioskId: f.sellerKiosk.id, rightId: f.right.id })
})

it('rejects a changed object inside the current read window', async () => {
  const { f, read } = await fixture()
  const query = f.client.ledgerService.batchGetObjects, original = query.getMockImplementation()!
  let reads = 0
  query.mockImplementation(async (...args) => {
    if (args[0].requests[0].objectId === f.c.id && ++reads === 2) {
      f.current.set(f.c.id, f.full(f.c.id, f.types.collection, SoulPublicCollectionBcs,
        { ...f.c, current_holder: f.author, current_holder_kiosk_id: f.buyerKiosk.id }, { Shared: { initialSharedVersion: '1' } }, '99'))
    }
    return original(...args)
  })
  await expect(read()).rejects.toThrow('READSET_CHANGED')
})
