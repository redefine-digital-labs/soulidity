import { vi } from 'vitest'
import { MAINNET_GENESIS_DIGEST } from '../../../web/lib/animacraft/mainnet-chain'
import { EconomicsConfigBcs } from '../../../web/lib/soulidity/commerce/economics-bcs'
import { createIncomeWithdrawalRecoveryRecord, exportIncomeWithdrawalRecoveryRecord } from '../../../web/lib/soulidity/commerce/income-withdrawal-recovery-record'
import { reconcilePaidIncomeLedger } from '../../../web/lib/soulidity/commerce/paid-income-ledger-reconciliation'
import { adigest, aid } from './activity-transaction-evidence'
import { purchaseRecoveryFixture } from './commerce-purchase-recovery-original'
import { attachControlledIncomeProtocol, controlledFoundationIncomeQualification } from './income-controlled-qualification'
import { incomeRecoveryImportFixture } from './income-withdrawal-recovery-import'


export async function paidIncomeReconciliationFixture(interleaved = false, recordGuard?: { index: number; namespace: string }) {
  const purchase = await purchaseRecoveryFixture('v2', 'money', { foundationRevenue: true, recordGuard })
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
  const withdrawalText = exportIncomeWithdrawalRecoveryRecord(createIncomeWithdrawalRecoveryRecord(params))
  const run = (qualified = true) => reconcilePaidIncomeLedger({ review, purchaseText: purchase.text, withdrawalText,
    executionRegistry: qualified ? qualification.executionRegistry : undefined, client: client as never, signal: new AbortController().signal })
  return { run, review, client, purchaseConfig, current, withdrawal, purchaseText: purchase.text, withdrawalText,
    executionRegistry: qualification.executionRegistry }
}
