import { expect, it } from 'vitest'
import { normalizeStructTag } from '@mysten/sui/utils'
import { replayCommerceAcceptance } from '../../web/lib/soulidity/commerce/public-acceptance-replay'
import { collectionBuyerListingFixture } from './fixtures/collection-buyer-listing'
import { cid } from './fixtures/collection-command'

async function buyerListingCase(options: Parameters<typeof collectionBuyerListingFixture>[0] = {}) {
  const fixture = await collectionBuyerListingFixture(options)
  const { f, opened, closed, listingId } = fixture, { plan, packet } = f.record
  const expected = {
    schema: 'soulidity.commerce.public-acceptance-case.v1', assetType: 'COLLECTION_RIGHT',
    originalDigest: packet.digest, buyer: plan.author, counterparty: plan.sellerAddress, coinType: normalizeStructTag(plan.target.paymentCoinType),
    totalAtomic: plan.quote.buyerTotalAtomic, collectionId: plan.request.collectionId, listingId: plan.request.listingId, rightId: plan.rightId,
    buyerListing: { listingDigest: opened.record.packet.digest, cancellationDigest: closed.record.packet.digest, buyerListingId: listingId },
  }
  const input = { client: f.client, signal: new AbortController().signal, originalText: JSON.stringify(f.record),
    collectionFollowUp: { listingText: JSON.stringify(opened.record), cancellationText: JSON.stringify(closed.record) } }
  return { ...fixture, expected, input }
}

it.each([false, true])('authenticates the buyer list and cancel on the exact purchased Right with new Kiosk=%s', async newKiosk => {
  const { f, expected, input, opened, closed, purchasedRoot, openedRow } = await buyerListingCase({ newKiosk })
  const result = await replayCommerceAcceptance(expected, input)
  expect(result).toMatchObject({
    status: 'ORIGINAL_SETTLEMENT_PROVED',
    buyerListingEvidence: { status: 'BUYER_LIST_AND_CANCEL_PROVED', buyerListingId: expected.buyerListing.buyerListingId,
      custodyRoot: { objectId: f.c.id, version: '12', digest: purchasedRoot.digest },
      listing: { transactionDigest: opened.record.packet.digest, netGasMist: '1',
        checkpoint: { checkpoint: '43', digest: opened.evidence.checkpoint.digest, effectsDigest: opened.evidence.ledger.effects.digest },
        created: { objectId: openedRow.objectId, version: '14', digest: openedRow.digest } },
      cancellation: { transactionDigest: closed.record.packet.digest, netGasMist: '1',
        checkpoint: { checkpoint: '44', digest: closed.evidence.checkpoint.digest, effectsDigest: closed.evidence.ledger.effects.digest },
        closed: { objectId: expected.buyerListing.buyerListingId, version: '16', digest: f.current.get(openedRow.objectId).digest } } },
    laneEvidence: { currentCustody: { status: 'BUYER_HANDOFF_VERIFIED', holder: expected.buyer, reserved: false } },
  })
  expect(result.walletStepsOutstanding).not.toContain('Buyer lists and cancels the purchased Right')
  expect(result.walletStepsOutstanding).toContain('Former holder wallet is denied')
  expect(f.client.ledgerService.getTransaction.mock.calls.map(([request]) => request.digest))
    .toEqual([expected.originalDigest, expected.buyerListing.listingDigest, expected.buyerListing.cancellationDigest])
  expect(f.client.core.executeTransaction).not.toHaveBeenCalled()
})

it('rejects a list authorized by a different Collection root version with the same holder and Kiosk', async () => {
  const { f, expected, input } = await buyerListingCase({ alternateRoot: true })
  await expect(replayCommerceAcceptance(expected, input)).rejects.toThrow('BUYER_FOLLOW_UP_LISTING_LINK')
  expect(f.client.ledgerService.getTransaction).toHaveBeenCalledTimes(2)
})

it('rejects a cancellation using a different listing version with identical contents', async () => {
  const { expected, input } = await buyerListingCase({ alternateListing: true })
  await expect(replayCommerceAcceptance(expected, input)).rejects.toThrow('BUYER_FOLLOW_UP_CANCELLATION_LINK')
})

it('keeps the settled purchase and verified buyer listing when the original cancellation is missing', async () => {
  const { expected, input } = await buyerListingCase({ missingCancellation: true })
  const result = await replayCommerceAcceptance(expected, input)
  expect(result).toMatchObject({ status: 'ORIGINAL_SETTLEMENT_PROVED',
    buyerListingEvidence: { status: 'BUYER_CANCELLATION_UNPROVED',
      listing: { transactionDigest: expected.buyerListing.listingDigest },
      original: { status: 'MISSING', transactionDigest: expected.buyerListing.cancellationDigest } } })
  expect(result.walletStepsOutstanding).toContain('Buyer lists and cancels the purchased Right')
})

it('rejects an unrelated expected listing or missing original pair before any transaction lookup', async () => {
  const { f, expected, input } = await buyerListingCase()
  await expect(replayCommerceAcceptance({ ...expected, buyerListing: { ...expected.buyerListing, buyerListingId: cid(1999) } }, input))
    .rejects.toThrow('BUYER_FOLLOW_UP_ORIGINAL')
  await expect(replayCommerceAcceptance(expected, { ...input, collectionFollowUp: undefined }))
    .rejects.toThrow('ACCEPTANCE_BUYER_LISTING_FILE_PAIR')
  expect(f.client.ledgerService.getTransaction).not.toHaveBeenCalled()
})
