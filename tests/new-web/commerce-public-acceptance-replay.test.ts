import { expect, it, vi } from 'vitest'
import { normalizeStructTag } from '@mysten/sui/utils'
import { replayCommerceAcceptance } from '../../web/lib/soulidity/commerce/public-acceptance-replay'
import { collectionBuyFixture, installCollectionBuyAfterFixture } from './fixtures/collection-buy'
import { completePreflightFixture, installNativePaidSettlementFixture } from './fixtures/commerce-new-paid-preflight'
import { nativeSaleLifecycleWireFixture } from './fixtures/commerce-native-sale-lifecycle-wire'

const schema = 'soulidity.commerce.public-acceptance-case.v1'
const signal = () => new AbortController().signal

it('replays an original Soul sale with the exact payout, effects and kiosk evidence', async () => {
  const f = await nativeSaleLifecycleWireFixture('', true)
  const expected = { schema, assetType: 'SOUL', originalDigest: f.review.purchaseDigest, buyer: f.review.buyer,
    counterparty: f.review.seller, coinType: f.plan.coinType, totalAtomic: f.plan.reviewedTotal,
    soulId: f.plan.soulId, offerId: f.plan.offerId }
  const input = { originalText: f.purchaseText, client: f.client as never, signal: signal() }
  const result = await replayCommerceAcceptance(expected, input)
  expect(result).toMatchObject({
    status: 'ORIGINAL_SETTLEMENT_PROVED', counterpartyRole: 'SELLER',
    checkpoint: { sequence: '100', digest: expect.any(String), effectsDigest: expect.any(String) },
    settlement: { buyerGrossDebitAtomic: f.plan.reviewedTotal,
      payouts: expect.arrayContaining([expect.objectContaining({ owner: f.review.seller, amount: '101' })]),
      protocolCredit: { kind: 'LEDGER', objectId: f.plan.configId }, netGasMist: expect.any(String) },
    laneEvidence: { creator: f.creator, collectionHolder: f.collectionHolder, originalCustody: { buyerKioskId: f.plan.buyerKioskId } },
    walletStepsOutstanding: expect.arrayContaining(['Buyer reopens the original Soul content', 'Former holder access denial']),
  })
  await expect(replayCommerceAcceptance({ ...expected, counterparty: f.creator }, input)).rejects.toThrow('ACCEPTANCE_COUNTERPARTY_MISMATCH')
})

it('reports exact Collection payout Coins, buyer returns and current Kiosk handoff', async () => {
  const f = await collectionBuyFixture({ addressGas: true, feeRecipientBuyer: true })
  installCollectionBuyAfterFixture(f)
  const { plan, packet } = f.record
  const expected = { schema, assetType: 'COLLECTION_RIGHT', originalDigest: packet.digest, buyer: plan.author,
    counterparty: plan.sellerAddress, coinType: normalizeStructTag(plan.target.paymentCoinType), totalAtomic: plan.quote.buyerTotalAtomic,
    collectionId: plan.request.collectionId, listingId: plan.request.listingId, rightId: plan.rightId }
  const input = { originalText: JSON.stringify(f.record), client: f.client, signal: signal() }
  const result = await replayCommerceAcceptance(expected, input)
  expect(result).toMatchObject({
    status: 'ORIGINAL_SETTLEMENT_PROVED', checkpoint: { sequence: '42', digest: f.evidence.checkpoint.digest, effectsDigest: f.evidence.ledger.effects.digest },
    settlement: { buyerGrossDebitAtomic: plan.quote.buyerTotalAtomic, buyerNetBusinessDebitAtomic: plan.quote.priceAtomic,
      payouts: expect.arrayContaining([
        { coinId: expect.any(String), owner: plan.sellerAddress, amount: plan.quote.priceAtomic },
        { coinId: expect.any(String), owner: plan.author, amount: plan.quote.feeAtomic },
      ]), protocolCredit: { kind: 'DIRECT_PAYOUT', amountAtomic: plan.quote.feeAtomic }, netGasMist: '1' },
    laneEvidence: { currentCustody: { status: 'BUYER_HANDOFF_VERIFIED', holder: plan.author } },
  })
  f.client.ledgerService.getTransaction.mockRejectedValueOnce({ code: 'NOT_FOUND' })
  const missing = await replayCommerceAcceptance(expected, input)
  expect(missing).toMatchObject({ status: 'MISSING' })
  expect(missing).not.toHaveProperty('settlement')
})

it('binds the paid record guard before any transaction lookup and reports only the public subscription receipt', async () => {
  const f = await completePreflightFixture()
  const { prepared: selected } = await f.runComplete()
  const { format, intent, packet, reviewedGas, context } = selected
  f.client.ledgerService.getCheckpoint = vi.fn()
  const found = await installNativePaidSettlementFixture(f, packet.digest)
  const getTransaction = vi.fn(found.found)
  f.client.ledgerService.getTransaction = getTransaction as never
  const expected = { schema, assetType: 'PAID_CONTENT', originalDigest: packet.digest, buyer: intent.buyer,
    counterparty: context.originalQuotedOffer.issuer, coinType: normalizeStructTag(intent.coinType), totalAtomic: intent.quote.total,
    soulId: context.originalReceiptContext.soulId, namespace: intent.recordGuard!.namespace, recordIndex: intent.recordGuard!.index }
  const input = { originalText: JSON.stringify({ format, intent, packet, reviewedGas, context }), client: f.client as never, signal: signal() }
  await expect(replayCommerceAcceptance({ ...expected, recordIndex: expected.recordIndex + 1 }, input)).rejects.toThrow('ACCEPTANCE_PAID_RECORD_MISMATCH')
  await expect(replayCommerceAcceptance({ ...expected, counterparty: expected.buyer }, input)).rejects.toThrow('ACCEPTANCE_CASE_WALLETS')
  expect(getTransaction).not.toHaveBeenCalled()
  await expect(replayCommerceAcceptance(expected, input)).resolves.toMatchObject({
    status: 'ORIGINAL_SETTLEMENT_PROVED', counterpartyRole: 'BENEFICIARY',
    settlement: { buyerGrossDebitAtomic: '104', buyerNetBusinessDebitAtomic: '104',
      payouts: [{ coinId: expect.any(String), owner: expected.counterparty, amount: '101' }],
      protocolCredit: { kind: 'LEDGER', amountAtomic: '3', objectId: intent.config.objectId } },
    laneEvidence: { kind: intent.kind, originalPlatformLedger: { before: expect.any(Object), after: expect.any(Object) } },
    walletStepsOutstanding: expect.arrayContaining(['Buyer opens the expected content version with Seal', 'Same-kind Entry reuse without a second payment']),
  })
})
