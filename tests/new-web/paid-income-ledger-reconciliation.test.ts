import { expect, it, vi } from 'vitest'
import { MAINNET_GENESIS_DIGEST } from '../../web/lib/animacraft/mainnet-chain'
import { EconomicsConfigBcs } from '../../web/lib/soulidity/commerce/economics-bcs'
import { incomeLedgerWitness, relateIncomeLedgerWitness } from '../../web/lib/soulidity/commerce/income-ledger-witness'
import { createIncomeWithdrawalRecoveryRecord, exportIncomeWithdrawalRecoveryRecord } from '../../web/lib/soulidity/commerce/income-withdrawal-recovery-record'
import { reconcilePaidIncomeLedger } from '../../web/lib/soulidity/commerce/paid-income-ledger-reconciliation'
import { adigest, aid } from './fixtures/activity-transaction-evidence'
import { purchaseRecoveryFixture } from './fixtures/commerce-purchase-recovery-original'
import { attachControlledIncomeProtocol, controlledFoundationIncomeQualification } from './fixtures/income-controlled-qualification'
import { incomeRecoveryImportFixture } from './fixtures/income-withdrawal-recovery-import'

async function fixture(interleaved = false) {
  const purchase = await purchaseRecoveryFixture('v2', 'money', { foundationRevenue: true })
  const original = purchase.original
  if (!('format' in original) || !purchase.history || !purchase.foundationObject) throw Error('V2 fixture required')
  const { economics, target, originalQuotedOffer } = original.context
  const purchaseConfig = purchase.history.rows.get(`${economics.configId}:10`)!
  const cfg = EconomicsConfigBcs.parse(purchaseConfig.contents.value)
  let withdrawalInput = purchaseConfig
  if (interleaved) {
    cfg.income = { ...cfg.income, revision: '3', collected: '8', withdrawn: '2', funds: '6',
      requests: { ...cfg.income.requests, size: '1' } }
    withdrawalInput = purchase.history.base.object(cfg.id, 11, purchaseConfig.objectType, EconomicsConfigBcs.serialize(cfg).toBytes(),
      { Shared: { initialSharedVersion: 1 } }, adigest(9))
  }
  const withdrawal = await incomeRecoveryImportFixture({
    target: economics, packageBytes: purchase.foundationObject.bcs.value, config: withdrawalInput, amount: '3',
  })
  const { f, rows, params } = withdrawal
  const outputVersion = Number(withdrawalInput.version) + 1
  const current = rows.get(`${cfg.id}:${outputVersion}`)
  const qualification = controlledFoundationIncomeQualification(params.target, f.pkg.bcs.value)
  const review = { schema: 'soulidity.commerce.paid-income-case.v1', soulId: purchase.soulId,
    buyer: original.intent.buyer, beneficiary: originalQuotedOffer.issuer, purchaseDigest: original.packet.digest,
    withdrawalDigest: params.packet.digest, target, economics, initialSharedVersion: '1',
    operator: params.intent.actor, adminId: params.intent.adminId, recipient: params.intent.recipient, amountAtomic: params.intent.amount }
  const getTransaction = vi.fn(async (request: { digest: string }) => {
    if (request.digest === review.purchaseDigest) return { response: { transaction: purchase.finality.ledger } }
    if (request.digest === review.withdrawalDigest) return { response: { transaction: f.ledger } }
    throw Error('Unexpected original digest')
  })
  const client = { core: { getChainIdentifier: vi.fn(async () => ({ chainIdentifier: MAINNET_GENESIS_DIGEST })) },
    ledgerService: { getTransaction,
      getObject: vi.fn(async (request: { objectId: string; version?: bigint }, options: unknown) => {
        const { objectId, version } = request
        if (objectId === cfg.id && version === undefined) return { response: { object: current } }
        const row = rows.get(`${objectId}:${version}`)
        if (row) return { response: { object: row } }
        return purchase.client.ledgerService.getObject(request, options)
      }),
      getCheckpoint: vi.fn(async (request: { checkpointId: { sequenceNumber: bigint } }) => ({
        response: { checkpoint: request.checkpointId.sequenceNumber === 101n ? f.checkpoint : purchase.finality.checkpoint },
      })),
    } }
  attachControlledIncomeProtocol(f, client)
  const run = (qualified = true) => reconcilePaidIncomeLedger({ review, purchaseText: purchase.text,
    withdrawalText: exportIncomeWithdrawalRecoveryRecord(createIncomeWithdrawalRecoveryRecord(params)),
    executionRegistry: qualified ? qualification.executionRegistry : undefined, client: client as never, signal: new AbortController().signal })
  return { run, review, client, purchaseConfig, current, withdrawal }
}

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

it('rejects a current Config read that predates the authenticated withdrawal output', async () => {
  const f = await fixture()
  const read = f.client.ledgerService.getObject.getMockImplementation()!
  f.client.ledgerService.getObject.mockImplementation((request, options) => {
    if (request.objectId === f.purchaseConfig.objectId && request.version === undefined) {
      return Promise.resolve({ response: { object: f.purchaseConfig } })
    }
    return read(request, options)
  })
  await expect(f.run()).rejects.toThrow('INCOME_LEDGER_CONTINUITY')
})
