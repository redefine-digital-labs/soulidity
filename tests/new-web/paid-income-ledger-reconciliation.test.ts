import { expect, it } from 'vitest'
import { EconomicsConfigBcs } from '../../web/lib/soulidity/commerce/economics-bcs'
import { incomeLedgerWitness, relateIncomeLedgerWitness } from '../../web/lib/soulidity/commerce/income-ledger-witness'
import { confirmPaidIncomeOriginals, confirmPaidIncomePurchase, readCurrentPaidIncomeAfterPurchase, readCurrentPaidIncomeLedger, reconcilePaidIncomeOriginals } from '../../web/lib/soulidity/commerce/paid-income-ledger-reconciliation'
import { adigest, aid } from './fixtures/activity-transaction-evidence'
import { paidIncomeReconciliationFixture as fixture } from './fixtures/paid-income-ledger-reconciliation'

it('joins actual purchase and withdrawal verifiers through the exact credited Config', async () => {
  const f = await fixture()
  const result = await f.run()
  expect(result).toMatchObject({
    status: 'PAID_INCOME_LEDGER_RECONCILED', isolatedFeeCase: true,
    purchase: { checkpoint: '100', money: { buyerGrossDebit: '104', payout: { owner: f.review.beneficiary, amount: '101' },
      protocolIncome: '3', platformLedger: { before: { balance: '0' }, after: { digest: f.purchaseConfig.digest, balance: '3' } } } },
    withdrawal: { checkpoint: '101', recipient: f.review.recipient, paymentCoinId: f.withdrawal.payoutId, amountAtomic: '3',
      ledger: { before: { digest: f.purchaseConfig.digest }, after: { balance: '0', collected: '3', withdrawn: '3' } } },
    purchaseToWithdrawal: { kind: 'SAME_CONFIG_REFERENCE' },
    withdrawalToCurrent: { kind: 'SAME_CONFIG_REFERENCE' },
    current: { digest: f.current.digest, balance: '0', requests: '1' },
  })
  expect(f.client.ledgerService.getTransaction.mock.calls.map(([request]) => request.digest)).toEqual([f.review.purchaseDigest, f.review.withdrawalDigest])
})

it('reports intervening inflow and withdrawals without attributing the pooled payout to the checkout fee', async () => {
  const f = await fixture(true)
  await expect(f.run()).resolves.toMatchObject({
    status: 'PAID_INCOME_LEDGER_RECONCILED', isolatedFeeCase: false,
    purchaseToWithdrawal: { kind: 'INTERVENING_CONFIG_WRITES', revisionDelta: '2', collectedDelta: '5',
      withdrawnDelta: '2', withdrawalRequestsDelta: '1' },
    current: { balance: '3', collected: '8', withdrawn: '5', requests: '2' },
  })
})

it('preserves original execution without confirming a withdrawal when source qualification is absent', async () => {
  const f = await fixture()
  await expect(f.run(false)).resolves.toMatchObject({ stage: 'WITHDRAWAL', status: 'FINALIZED_EXECUTION',
    transactionDigest: f.review.withdrawalDigest, purchase: { money: { protocolIncome: '3' } }, completeBusinessOutputVerified: false })
  expect(f.client.core.getChainIdentifier).not.toHaveBeenCalled()
})

it('stops on the original purchase digest when the outcome is missing', async () => {
  const f = await fixture()
  f.client.ledgerService.getTransaction.mockRejectedValueOnce(Object.assign(Error('Unavailable'), { code: 'NOT_FOUND' }))
  await expect(f.run()).resolves.toEqual({ stage: 'PURCHASE', status: 'MISSING', transactionDigest: f.review.purchaseDigest })
  expect(f.client.ledgerService.getTransaction).toHaveBeenCalledTimes(1)
})

it('rejects a different withdrawal recipient before querying either original', async () => {
  const f = await fixture()
  f.review.recipient = aid(999)
  await expect(f.run()).rejects.toThrow('PAID_INCOME_ORIGINAL_CASE_MISMATCH')
  expect(f.client.ledgerService.getTransaction).not.toHaveBeenCalled()
})

it('rejects same-version digest conflicts and regressions across authenticated references', async () => {
  const f = await fixture()
  const config = EconomicsConfigBcs.parse(f.purchaseConfig.contents.value)
  const witness = incomeLedgerWitness(config, { version: '10', digest: f.purchaseConfig.digest }, '1')
  expect(() => relateIncomeLedgerWitness(witness, { ...witness, digest: adigest(9) })).toThrow('INCOME_LEDGER_CONTINUITY')
  expect(() => relateIncomeLedgerWitness(witness, { ...witness, version: '9', digest: adigest(9) })).toThrow('INCOME_LEDGER_CONTINUITY')
  expect(() => relateIncomeLedgerWitness(witness, { ...witness, requestsTableId: aid(999) })).toThrow('INCOME_LEDGER_LINEAGE')
})

it('keeps both authenticated receipts while rejecting a stale current Config reference', async () => {
  const f = await fixture()
  const read = f.client.ledgerService.getObject.getMockImplementation()!
  f.client.ledgerService.getObject.mockImplementation((request, options) => {
    if (request.objectId === f.purchaseConfig.objectId && request.version === undefined) {
      return Promise.resolve({ response: { object: f.purchaseConfig } })
    }
    return read(request, options)
  })
  const result = await f.run()
  expect(result).toMatchObject({ status: 'PAID_INCOME_CURRENT_UNVERIFIED', reason: 'CONFIG_REFERENCE_CONFLICT',
    purchase: { transactionDigest: f.review.purchaseDigest }, withdrawal: { transactionDigest: f.review.withdrawalDigest } })
  expect(result).not.toHaveProperty('current')
  expect(result).not.toHaveProperty('withdrawalToCurrent')
})

it('returns exact historical results on a failed Config read and retries only the current ledger', async () => {
  const f = await fixture()
  const input = { purchaseText: f.purchaseText, withdrawalText: f.withdrawalText, soulId: f.review.soulId,
    executionRegistry: f.executionRegistry, client: f.client as never, signal: new AbortController().signal }
  const confirmed = await confirmPaidIncomeOriginals(input)
  if (confirmed.status !== 'PAID_INCOME_ORIGINALS_CONFIRMED') throw Error(confirmed.status)
  expect(f.client.core.getChainIdentifier).not.toHaveBeenCalled()
  f.client.core.getChainIdentifier.mockRejectedValueOnce(Error('RPC unavailable'))
  const result = await readCurrentPaidIncomeLedger({ ...input, confirmed })
  expect(result).toMatchObject({ ...confirmed.evidence, status: 'PAID_INCOME_CURRENT_UNVERIFIED', reason: 'CONFIG_READ_FAILED' })
  expect(result).not.toHaveProperty('current')
  await expect(readCurrentPaidIncomeLedger({ ...input, confirmed })).resolves.toMatchObject({
    status: 'PAID_INCOME_LEDGER_RECONCILED', current: { digest: f.current.digest },
  })
  expect(f.client.ledgerService.getTransaction.mock.calls.map(([request]) => request.digest)).toEqual([
    f.review.purchaseDigest, f.review.withdrawalDigest,
  ])
})

it('propagates cancellation of a current read independently of a read failure', async () => {
  const f = await fixture(), controller = new AbortController()
  const input = { purchaseText: f.purchaseText, withdrawalText: f.withdrawalText, soulId: f.review.soulId,
    executionRegistry: f.executionRegistry, client: f.client as never, signal: controller.signal }
  const confirmed = await confirmPaidIncomeOriginals(input)
  if (confirmed.status !== 'PAID_INCOME_ORIGINALS_CONFIRMED') throw Error(confirmed.status)
  f.client.core.getChainIdentifier.mockImplementationOnce(() => {
    controller.abort()
    return Promise.reject(Error('Transport closed'))
  })
  await expect(readCurrentPaidIncomeLedger({ ...input, confirmed })).rejects.toMatchObject({ name: 'AbortError' })
})

it('rejects a mismatched Foundation pin in the withdrawal original before reading either transaction', async () => {
  const f = await fixture(), other = await fixture()
  const text = JSON.parse(other.withdrawalText)
  text.target.foundation.originalPackageId = aid(999)
  const { exportIncomeWithdrawalRecoveryRecord } = await import('../../web/lib/soulidity/commerce/income-withdrawal-recovery-record')
  const withdrawalText = exportIncomeWithdrawalRecoveryRecord(text)
  await expect(reconcilePaidIncomeOriginals({ purchaseText: f.purchaseText, withdrawalText, soulId: f.review.soulId,
    executionRegistry: f.executionRegistry, client: f.client as never, signal: new AbortController().signal })).rejects.toThrow('PAID_INCOME_ORIGINAL_CONFIG_MISMATCH')
  expect(f.client.ledgerService.getTransaction).not.toHaveBeenCalled()
})

it('checks the exact credit and current Config before any withdrawal exists', async () => {
  const f = await fixture(), signal = new AbortController().signal
  const input = { purchaseText: f.purchaseText, soulId: f.review.soulId, client: f.client as never, signal }
  const read = f.client.ledgerService.getObject.getMockImplementation()!
  f.client.ledgerService.getObject.mockImplementation((request, options) =>
    request.objectId === f.purchaseConfig.objectId && request.version === undefined
      ? Promise.resolve({ response: { object: f.purchaseConfig } })
      : read(request, options))
  const confirmed = await confirmPaidIncomePurchase(input)
  if (confirmed.status !== 'PAID_INCOME_PURCHASE_CONFIRMED') throw Error(confirmed.status)
  await expect(readCurrentPaidIncomeAfterPurchase({ ...input, confirmed })).resolves.toMatchObject({
    status: 'PAID_INCOME_PURCHASE_LEDGER_OBSERVED', purchase: { transactionDigest: f.review.purchaseDigest,
      money: { protocolIncome: '3', platformLedger: { before: { balance: '0' }, after: { balance: '3' } } } },
    purchaseToCurrent: { kind: 'SAME_CONFIG_REFERENCE' },
    current: { balance: '3', collected: '3', withdrawn: '0', digest: f.purchaseConfig.digest },
  })
  expect(f.client.ledgerService.getTransaction.mock.calls.map(([request]) => request.digest)).toEqual([f.review.purchaseDigest])
})

it('keeps original credit on failed current read and reports only pooled ledger changes on retry', async () => {
  const f = await fixture(true), signal = new AbortController().signal
  const input = { purchaseText: f.purchaseText, soulId: f.review.soulId, client: f.client as never, signal }
  const confirmed = await confirmPaidIncomePurchase(input)
  if (confirmed.status !== 'PAID_INCOME_PURCHASE_CONFIRMED') throw Error(confirmed.status)
  f.client.core.getChainIdentifier.mockRejectedValueOnce(Error('Current ledger temporarily unavailable'))
  const failed = await readCurrentPaidIncomeAfterPurchase({ ...input, confirmed })
  expect(failed).toMatchObject({ status: 'PAID_INCOME_CURRENT_UNVERIFIED', reason: 'CONFIG_READ_FAILED', purchase: confirmed.purchase })
  expect(failed).not.toHaveProperty('current')
  await expect(readCurrentPaidIncomeAfterPurchase({ ...input, confirmed })).resolves.toMatchObject({
    status: 'PAID_INCOME_PURCHASE_LEDGER_OBSERVED',
    purchaseToCurrent: { kind: 'INTERVENING_CONFIG_WRITES', collectedDelta: '5', withdrawnDelta: '5' },
    current: { balance: '3', collected: '8', withdrawn: '5' },
  })
  expect(f.client.ledgerService.getTransaction.mock.calls.map(([request]) => request.digest)).toEqual([f.review.purchaseDigest])
})
