import { describe, expect, it } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { readCollectionListingSettlement } from '../../web/lib/collections/collection-listing-settlement'
import { CollectionBuyCoinBcs } from '../../web/lib/collections/collection-buy-plan'
import { collectionBuyFixture, installCollectionBuyAfterFixture } from './fixtures/collection-buy'
import { cid, collectionCommandFixture } from './fixtures/collection-command'
import type { CollectionCommandPlan, CollectionCommandQuery, CollectionCommandTarget } from '../../web/lib/collections/collection-command-plan'

type Buy = Awaited<ReturnType<typeof collectionBuyFixture>>
type Command = Awaited<ReturnType<typeof collectionCommandFixture>>

function sellerRequest(f: Buy | Command, target: CollectionCommandTarget, plan: CollectionCommandPlan) {
  const receipt: NonNullable<CollectionCommandQuery['receipt']> = {
    collectionId: f.c.id, rightId: f.right.id, oldListingId: null, newListingId: f.listing.id, priceAtomic: f.listing.price,
  }
  const fullPackage = f.client.ledgerService.getObject.getMockImplementation()!
  f.client.ledgerService.getObject.mockImplementation(async args => {
    if (args.objectId === target.callablePackageId && args.version === undefined) {
      return { response: { object: structuredClone(f.current.get(target.callablePackageId)) } }
    }
    return fullPackage(args)
  })
  return {
    client: f.client as never,
    plan: { ...plan, target, request: { action: 'list' as const, collectionId: f.c.id, priceAtomic: f.listing.price }, oldListingId: null },
    receipt,
  }
}

async function purchased(options?: Parameters<typeof collectionBuyFixture>[0]) {
  const f = await collectionBuyFixture(options)
  const { kioskPackageId: _kiosk, collectionTransferPolicyId: _policy, ...target } = f.target
  const seller = await collectionCommandFixture('list', { price: f.listing.price })
  return { f, request: sellerRequest(f, target, seller.plan) }
}

describe('seller reads exact listing closure through raw final effects', () => {
  it.each([false, true])('proves exact debit, payouts and Right handoff with new Kiosk=%s', async newKiosk => {
    const { f, request } = await purchased({ newKiosk, addressGas: newKiosk, sellerLocked: true })
    installCollectionBuyAfterFixture(f)
    const result = await readCollectionListingSettlement(request)
    expect(result).toEqual({
      status: 'SOLD', checkpoint: '42', transactionDigest: f.record.packet.digest, buyer: f.author,
      buyerKioskId: f.buyerKiosk.id, rightId: f.right.id, totalAtomic: '1005002',
      seller: { owner: f.listing.seller, amount: '1000001' },
      platform: { owner: f.market.fee_recipient, amount: '5001' },
      payoutCoinIds: [cid(1400), cid(1401)],
    })
    expect(f.client.ledgerService.getTransaction).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ digest: f.record.packet.digest }), expect.anything(),
    )
    expect(f.client.core.executeTransaction).not.toHaveBeenCalled()
    expect(f.getAddress).not.toHaveBeenCalled()
  })
  it('keeps the payout roles distinct when the seller also receives the same-sized fee', async () => {
    const { f, request } = await purchased({ feeRecipientSeller: true, feeBps: 10000, price: '1000001', paymentBalances: ['2500000'] })
    installCollectionBuyAfterFixture(f)
    const result = await readCollectionListingSettlement(request)
    expect(result).toMatchObject({ status: 'SOLD', totalAtomic: '2000002',
      seller: { owner: f.listing.seller, amount: '1000001' }, platform: { owner: f.listing.seller, amount: '1000001' },
      payoutCoinIds: [cid(1400), cid(1401)] })
  })
  it('confirms a fee-free sale with one payout and a single payment coin', async () => {
    const { f, request } = await purchased({ feeBps: 0, paymentBalances: ['1200000'] })
    installCollectionBuyAfterFixture(f)
    await expect(readCollectionListingSettlement(request)).resolves.toMatchObject({
      status: 'SOLD', totalAtomic: '1000001', platform: null, payoutCoinIds: [cid(1400)],
    })
  })
  it('reads an active listing without requesting an unrelated transaction', async () => {
    const { f, request } = await purchased()
    expect(await readCollectionListingSettlement(request)).toEqual({ status: 'ACTIVE' })
    expect(f.client.ledgerService.getTransaction).not.toHaveBeenCalled()
  })
  it('proves a cancellation without reporting a payout', async () => {
    const f = await collectionCommandFixture('delist')
    f.current.set(f.listing.id, f.rows.get(`${f.listing.id}:12`))
    const result = await readCollectionListingSettlement(sellerRequest(f, f.target, f.plan))
    expect(result).toEqual({ status: 'CANCELLED', checkpoint: '42', transactionDigest: f.record.packet.digest })
  })
  it('rejects a settlement whose real platform payout is for a different address', async () => {
    const { f, request } = await purchased()
    installCollectionBuyAfterFixture(f)
    const feeId = cid(1401), amount = f.plan.quote.feeAtomic
    const wrong = f.full(feeId, f.types.coin, CollectionBuyCoinBcs, { id: feeId, balance: amount },
      { AddressOwner: cid(987) }, '12', f.record.packet.digest)
    const write = f.effects.V2!.changedObjects.find(([id]) => id === feeId)![1].outputState.ObjectWrite!
    write[0] = wrong.digest
    write[1] = bcs.Object.parse(wrong.bcs.value).owner
    f.evidence.rehashEffects()
    await expect(readCollectionListingSettlement(request)).rejects.toThrow('SETTLEMENT_PLATFORM_PAYOUT')
  })
  it('rejects a historical payment that left the buyer with the wrong change', async () => {
    const { f, request } = await purchased()
    installCollectionBuyAfterFixture(f)
    const coinId = f.paymentCoinObjectIds[0]
    const wrong = f.full(coinId, f.types.coin, CollectionBuyCoinBcs, { id: coinId, balance: '94999' },
      { AddressOwner: f.author }, '12', f.record.packet.digest)
    f.effects.V2!.changedObjects.find(([id]) => id === coinId)![1].outputState.ObjectWrite![0] = wrong.digest
    f.evidence.rehashEffects()
    await expect(readCollectionListingSettlement(request)).rejects.toThrow('SETTLEMENT_BUYER_DEBIT')
  })
  it('rejects a closure that does not match the actual version of this listing', async () => {
    const { f, request } = await purchased()
    installCollectionBuyAfterFixture(f)
    f.effects.V2!.changedObjects.find(([id]) => id === f.listing.id)![1].outputState.ObjectWrite![0] = f.rows.get(`${f.listing.id}:11`).digest
    f.evidence.rehashEffects()
    await expect(readCollectionListingSettlement(request)).rejects.toThrow('SETTLEMENT_LISTING_OUTPUT')
  })
})
