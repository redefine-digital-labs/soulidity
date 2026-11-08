import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { marketListDigest, marketListUint64 } from '../../animacraft/market-list-operation'
import { publicMutationCanonical as canonical } from '../../sui/public-mutation-journal'
import { parseCanonicalNativeWorkbenchTarget } from '../canonical-native-workbench'
import { soulAccessExact } from '../soul-access-plan'
import { commerceCheck, commerceId, readEconomicsIncome } from './economics-read'
import type { IncomeExecutionRegistryV1 } from './income-execution-source-v1'
import { incomeLedgerWitness, relateIncomeLedgerWitness } from './income-ledger-witness'
import { parseIncomeObservationTarget } from './income-source-qualification'
import { readIncomeWithdrawalHistory } from './income-withdrawal-history'
import { importIncomeWithdrawalRecoveryRecord, incomeWithdrawalRecoveryProps } from './income-withdrawal-recovery-record'
import { readNativePublicReadPaidHistoryV2 } from './native-public-read-paid-history-v2'
import { parsePurchaseRecoveryOriginal } from './purchase-recovery-original'

function parseCase(raw: unknown) {
  soulAccessExact(raw, ['schema', 'soulId', 'buyer', 'beneficiary', 'purchaseDigest', 'withdrawalDigest',
    'target', 'economics', 'initialSharedVersion', 'operator', 'adminId', 'recipient', 'amountAtomic'])
  const { soulId, buyer, beneficiary, purchaseDigest, withdrawalDigest, initialSharedVersion, operator, adminId, recipient, amountAtomic } = raw
  commerceCheck(raw.schema === 'soulidity.commerce.paid-income-case.v1'
    && typeof soulId === 'string' && commerceId(soulId)
    && [buyer, beneficiary, operator, adminId, recipient].every(value => typeof value === 'string' && commerceId(value))
    && marketListDigest(purchaseDigest) && marketListDigest(withdrawalDigest) && purchaseDigest !== withdrawalDigest
    && marketListUint64(initialSharedVersion) && initialSharedVersion !== '0'
    && marketListUint64(amountAtomic) && amountAtomic !== '0', 'PAID_INCOME_CASE')
  const target = parseCanonicalNativeWorkbenchTarget(raw.target), economics = parseIncomeObservationTarget(raw.economics)
  commerceCheck(target.configId === economics.configId, 'PAID_INCOME_CASE_CONFIG')
  return { soulId, buyer, beneficiary, purchaseDigest, withdrawalDigest, initialSharedVersion, operator, adminId, recipient, amountAtomic, target, economics }
}

/** Join two original receipts through a shared Config and observe its current
 * ledger. Historical source qualification still governs withdrawal confirmation. */
export async function reconcilePaidIncomeLedger(input: {
  review: unknown; purchaseText: string; withdrawalText: string; client: SuiGrpcClient; signal: AbortSignal;
  executionRegistry?: IncomeExecutionRegistryV1;
}) {
  const { client, signal, executionRegistry } = input, review = parseCase(input.review)
  const purchaseText = input.purchaseText, withdrawalText = input.withdrawalText
  const original = await parsePurchaseRecoveryOriginal(purchaseText, review.soulId)
  commerceCheck(original.kind === 'native-public-read-v2', 'PAID_INCOME_PURCHASE_FORMAT')
  const p = original.value
  const w = incomeWithdrawalRecoveryProps(importIncomeWithdrawalRecoveryRecord(withdrawalText))
  commerceCheck(p.packet.digest === review.purchaseDigest && w.packet.digest === review.withdrawalDigest
    && canonical(p.context.target) === canonical(review.target)
    && canonical(p.context.economics) === canonical(review.economics) && canonical(w.target) === canonical(review.economics)
    && p.intent.config.initialSharedVersion === review.initialSharedVersion
    && p.intent.buyer === review.buyer && p.context.originalQuotedOffer.issuer === review.beneficiary
    && w.intent.actor === review.operator && w.intent.adminId === review.adminId
    && w.intent.recipient === review.recipient && w.intent.amount === review.amountAtomic, 'PAID_INCOME_ORIGINAL_CASE_MISMATCH')

  signal.throwIfAborted()
  const paid = await readNativePublicReadPaidHistoryV2({ ...p.context.originalReceiptContext,
    client, signal, intent: p.intent, packet: p.packet, gas: p.reviewedGas, proveMoney: true })
  if (paid.status !== 'SUBSCRIPTION_RECORDED') return { stage: 'PURCHASE' as const, transactionDigest: p.packet.digest, ...paid }
  const money = paid.receipt.money
  commerceCheck(money && money.payout.owner === review.beneficiary, 'PAID_INCOME_MONEY_REQUIRED')
  const purchase = { transactionDigest: p.packet.digest, checkpoint: paid.checkpoint, money }
  if (money.protocolIncome === '0') return { status: 'PURCHASE_WITHOUT_PROTOCOL_FEE' as const, purchase }

  const withdrawn = await readIncomeWithdrawalHistory({ ...w, client, signal, executionRegistry })
  if (withdrawn.status !== 'WITHDRAWAL_EVIDENCE_CONFIRMED') {
    return { stage: 'WITHDRAWAL' as const, transactionDigest: w.packet.digest, purchase, ...withdrawn }
  }
  const payout = withdrawn.receipt, checkpointsOrdered = BigInt(paid.checkpoint) <= BigInt(withdrawn.checkpoint)
  commerceCheck(checkpointsOrdered && payout.coinType === money.coinType, 'PAID_INCOME_CHECKPOINT_OR_COIN')
  const afterPurchase = money.platformLedger.after, beforeWithdrawal = payout.ledger.before
  const purchaseToWithdrawal = relateIncomeLedgerWitness(afterPurchase, beforeWithdrawal)
  // Both are writes of this same Shared object. The exact input version (or a
  // strictly later one) proves dependency order even within one checkpoint.
  const observed = await readEconomicsIncome({ client, target: review.economics, signal })
  const current = incomeLedgerWitness(observed.config, { version: observed.object.version, digest: observed.object.digest },
    observed.initialSharedVersion)
  const withdrawalToCurrent = relateIncomeLedgerWitness(payout.ledger.after, current)
  const isolatedFeeCase = purchaseToWithdrawal.kind === 'SAME_CONFIG_REFERENCE'
    && money.platformLedger.before.balance === '0' && money.protocolIncome === payout.receipt.amount

  return { status: 'PAID_INCOME_LEDGER_RECONCILED' as const, purchase, coinType: money.coinType,
    withdrawal: { transactionDigest: w.packet.digest, checkpoint: withdrawn.checkpoint, operator: payout.receipt.actor,
      recipient: payout.receipt.recipient, amountAtomic: payout.receipt.amount, paymentCoinId: payout.paymentCoinId,
      ledger: payout.ledger, gas: payout.gas },
    purchaseToWithdrawal, withdrawalToCurrent, current, isolatedFeeCase }
}
