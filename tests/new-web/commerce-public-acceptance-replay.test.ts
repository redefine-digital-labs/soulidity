import { expect, it, vi } from 'vitest'
import { normalizeStructTag } from '@mysten/sui/utils'
import { replayCommerceAcceptance } from '../../web/lib/soulidity/commerce/public-acceptance-replay'
import { collectionBuyFixture, installCollectionBuyAfterFixture } from './fixtures/collection-buy'
import { completePreflightFixture, installNativePaidSettlementFixture } from './fixtures/commerce-new-paid-preflight'
import { nativeSaleLifecycleWireFixture } from './fixtures/commerce-native-sale-lifecycle-wire'
import { paidIncomeReconciliationFixture } from './fixtures/paid-income-ledger-reconciliation'

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

async function paidWithdrawalCase(interleaved = false) {
  const recordGuard = { namespace: '616263', index: 3 }
  const fixture = await paidIncomeReconciliationFixture(interleaved, recordGuard)
  const { review, client, purchaseText, withdrawalText, executionRegistry } = fixture
  const purchase = { schema, assetType: 'PAID_CONTENT', originalDigest: review.purchaseDigest, buyer: review.buyer,
    counterparty: review.beneficiary, soulId: review.soulId, coinType: review.economics.coinType, totalAtomic: '104',
    namespace: recordGuard.namespace, recordIndex: recordGuard.index }
  const expected = { ...purchase, withdrawal: { originalDigest: review.withdrawalDigest, operator: review.operator,
    adminId: review.adminId, recipient: review.recipient, amountAtomic: review.amountAtomic } }
  const input = { originalText: purchaseText, withdrawalText, executionRegistry, client: client as never, signal: signal() }
  return { fixture, expected, purchase, input }
}

it.each([false, true])('joins each original once and distinguishes isolated and pooled income (%s)', async interleaved => {
  const { fixture: f, expected, input } = await paidWithdrawalCase(interleaved)
  const result = await replayCommerceAcceptance(expected, input)
  expect(result).toMatchObject({ status: 'ORIGINAL_SETTLEMENT_PROVED',
    withdrawalEvidence: { status: 'PAID_INCOME_LEDGER_RECONCILED', isolatedFeeCase: !interleaved,
      purchaseToWithdrawal: { kind: interleaved ? 'INTERVENING_CONFIG_WRITES' : 'SAME_CONFIG_REFERENCE' },
      withdrawalToCurrent: { kind: 'SAME_CONFIG_REFERENCE' },
      withdrawal: { transactionDigest: f.review.withdrawalDigest, paymentCoinId: f.withdrawal.payoutId,
        checkpointProof: { checkpoint: '101', digest: f.withdrawal.f.checkpoint.digest, effectsDigest: f.withdrawal.f.ledger.effects.digest },
        operator: f.review.operator, adminInput: { objectId: f.review.adminId }, recipient: f.review.recipient,
        amountAtomic: f.review.amountAtomic, gas: { netGasCharge: '3' } },
      current: { digest: f.current.digest, balance: interleaved ? '3' : '0' },
    } })
  expect(result.walletStepsOutstanding).not.toContain('Authorized income withdrawal and wallet proceeds')
  expect(result.walletStepsOutstanding).toContain('Buyer opens the expected content version with Seal')
  expect(f.client.ledgerService.getTransaction.mock.calls.map(([request]) => request.digest))
    .toEqual([f.review.purchaseDigest, f.review.withdrawalDigest])
  expect(result.withdrawalEvidence).not.toHaveProperty('purchase')
})

it('rejects unmatched withdrawal expectations or files before reading either original', async () => {
  const { fixture: f, purchase, expected, input } = await paidWithdrawalCase()
  await expect(replayCommerceAcceptance({ ...expected, withdrawal: { ...expected.withdrawal, recipient: expected.buyer } }, input))
    .rejects.toThrow('ACCEPTANCE_WITHDRAWAL_ORIGINAL_MISMATCH')
  await expect(replayCommerceAcceptance(purchase, input)).rejects.toThrow('ACCEPTANCE_WITHDRAWAL_FILE_PAIR')
  await expect(replayCommerceAcceptance(expected, { ...input, withdrawalText: undefined })).rejects.toThrow('ACCEPTANCE_WITHDRAWAL_FILE_PAIR')
  expect(f.client.ledgerService.getTransaction).not.toHaveBeenCalled()
})

it('keeps the proven purchase and raw withdrawal finality while approved source qualification is missing', async () => {
  const { fixture: f, expected, input } = await paidWithdrawalCase()
  const result = await replayCommerceAcceptance(expected, { ...input, executionRegistry: undefined })
  expect(result).toMatchObject({ status: 'ORIGINAL_SETTLEMENT_PROVED',
    withdrawalEvidence: { status: 'FINALIZED_EXECUTION', transactionDigest: f.review.withdrawalDigest,
      checkpointProof: { checkpoint: '101', digest: f.withdrawal.f.checkpoint.digest, effectsDigest: f.withdrawal.f.ledger.effects.digest } } })
  expect(result.withdrawalEvidence).not.toHaveProperty('withdrawal')
  expect(result.walletStepsOutstanding).toContain('Authorized income withdrawal and wallet proceeds')
})

it('keeps both original payouts when the current Config regresses and rejects the stale purchase-only view', async () => {
  const { fixture: f, expected, purchase, input } = await paidWithdrawalCase()
  const read = f.client.ledgerService.getObject.getMockImplementation()!
  f.client.ledgerService.getObject.mockImplementation((request, options) =>
    request.objectId === f.purchaseConfig.objectId && request.version === undefined
      ? Promise.resolve({ response: { object: f.purchaseConfig } }) : read(request, options))
  const result = await replayCommerceAcceptance(expected, input)
  expect(result).toMatchObject({ status: 'ORIGINAL_SETTLEMENT_PROVED',
    withdrawalEvidence: { status: 'PAID_INCOME_CURRENT_UNVERIFIED', reason: 'CONFIG_REFERENCE_CONFLICT',
      withdrawal: { paymentCoinId: f.withdrawal.payoutId } } })
  expect(result.withdrawalEvidence).not.toHaveProperty('current')
  expect(result.walletStepsOutstanding).toContain('Authorized income withdrawal and wallet proceeds')

  f.client.ledgerService.getObject.mockImplementation((request, options) =>
    request.objectId === f.purchaseConfig.objectId && request.version === undefined
      ? read({ ...request, version: 9n }, options) : read(request, options))
  await expect(replayCommerceAcceptance(purchase, { ...input, withdrawalText: undefined })).resolves.toMatchObject({
    status: 'ORIGINAL_SETTLEMENT_PROVED',
    laneEvidence: { currentIncome: { status: 'PAID_INCOME_CURRENT_UNVERIFIED', reason: 'CONFIG_REFERENCE_CONFLICT' } },
  })
})
