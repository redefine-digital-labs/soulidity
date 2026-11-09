import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { marketListDigest, marketListUint64 } from '../../animacraft/market-list-operation'
import { publicMutationCanonical as canonical } from '../../sui/public-mutation-journal'
import { parseCanonicalNativeWorkbenchTarget } from '../canonical-native-workbench'
import { soulAccessExact } from '../soul-access-plan'
import { commerceCheck, commerceId, readEconomicsIncome } from './economics-read'
import type { IncomeExecutionRegistryV1 } from './income-execution-source-v1'
import { incomeLedgerWitness, relateIncomeLedgerWitness, type IncomeLedgerWitness } from './income-ledger-witness'
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

type OriginalFiles = { purchaseText: string; withdrawalText: string }
type ReconciliationInput = OriginalFiles & {
  client: SuiGrpcClient; signal: AbortSignal; executionRegistry?: IncomeExecutionRegistryV1
}

async function parsePaidIncomePurchase(purchaseText: string, soulId: string) {
  const original = await parsePurchaseRecoveryOriginal(purchaseText, soulId)
  commerceCheck(original.kind === 'native-public-read-v2', 'PAID_INCOME_PURCHASE_FORMAT')
  return original.value
}

async function parseOriginalFiles({ purchaseText, withdrawalText }: OriginalFiles, soulId: string) {
  const purchase = await parsePaidIncomePurchase(purchaseText, soulId)
  const withdrawal = incomeWithdrawalRecoveryProps(importIncomeWithdrawalRecoveryRecord(withdrawalText))
  return { purchase, withdrawal }
}

type IncomeRead = Pick<ReconciliationInput, 'client' | 'signal'>
async function confirmPurchase({ client, signal }: IncomeRead, p: Awaited<ReturnType<typeof parsePaidIncomePurchase>>) {
  const economics = parseIncomeObservationTarget(p.context.economics)
  signal.throwIfAborted()
  const paid = await readNativePublicReadPaidHistoryV2({ ...p.context.originalReceiptContext,
    client, signal, intent: p.intent, packet: p.packet, gas: p.reviewedGas, proveMoney: true })
  if (paid.status !== 'SUBSCRIPTION_RECORDED') return { stage: 'PURCHASE' as const, transactionDigest: p.packet.digest, ...paid }
  const money = paid.receipt.money
  commerceCheck(money && money.payout.owner === p.context.originalQuotedOffer.issuer, 'PAID_INCOME_MONEY_REQUIRED')
  return { status: 'PAID_INCOME_PURCHASE_CONFIRMED' as const, economics,
    purchase: { transactionDigest: p.packet.digest, checkpoint: paid.checkpoint, checkpointProof: paid.receipt.checkpointProof, money } }
}

/** Prove the original credit without a withdrawal file or a current release selection. */
export async function confirmPaidIncomePurchase(input: IncomeRead & { purchaseText: string; soulId: string }) {
  return confirmPurchase(input, await parsePaidIncomePurchase(input.purchaseText, input.soulId))
}

export type ConfirmedPaidIncomePurchase = Extract<Awaited<ReturnType<typeof confirmPaidIncomePurchase>>,
  { status: 'PAID_INCOME_PURCHASE_CONFIRMED' }>

/** Independent acceptance can bind both files to reviewed expectations. */
export async function reconcilePaidIncomeLedger(input: ReconciliationInput & { review: unknown }) {
  const review = parseCase(input.review)
  const originals = await parseOriginalFiles(input, review.soulId)
  const { purchase: p, withdrawal: w } = originals
  commerceCheck(p.packet.digest === review.purchaseDigest && w.packet.digest === review.withdrawalDigest
    && canonical(p.context.target) === canonical(review.target)
    && canonical(p.context.economics) === canonical(review.economics) && canonical(w.target) === canonical(review.economics)
    && p.intent.config.initialSharedVersion === review.initialSharedVersion
    && p.intent.buyer === review.buyer && p.context.originalQuotedOffer.issuer === review.beneficiary
    && w.intent.actor === review.operator && w.intent.adminId === review.adminId
    && w.intent.recipient === review.recipient && w.intent.amount === review.amountAtomic, 'PAID_INCOME_ORIGINAL_CASE_MISMATCH')
  const result = await confirmOriginals(input, originals)
  return result.status === 'PAID_INCOME_ORIGINALS_CONFIRMED'
    ? readCurrentPaidIncomeLedger({ ...input, confirmed: result })
    : result
}

/** Recovery uses both retained files and independently verifies each original
 * from the ledger. The files cannot install withdrawal source qualification. */
export async function reconcilePaidIncomeOriginals(input: ReconciliationInput & { soulId: string }) {
  const result = await confirmPaidIncomeOriginals(input)
  return result.status === 'PAID_INCOME_ORIGINALS_CONFIRMED'
    ? readCurrentPaidIncomeLedger({ ...input, confirmed: result })
    : result
}

export async function confirmPaidIncomeOriginals(input: ReconciliationInput & { soulId: string }) {
  return confirmOriginals(input, await parseOriginalFiles(input, input.soulId))
}

async function confirmOriginals(
  { client, signal, executionRegistry }: ReconciliationInput,
  { purchase: p, withdrawal: w }: Awaited<ReturnType<typeof parseOriginalFiles>>,
) {
  const economics = parseIncomeObservationTarget(p.context.economics)
  commerceCheck(p.packet.digest !== w.packet.digest && canonical(w.target) === canonical(economics), 'PAID_INCOME_ORIGINAL_CONFIG_MISMATCH')
  const original = await confirmPurchase({ client, signal }, p)
  if (original.status !== 'PAID_INCOME_PURCHASE_CONFIRMED') return original
  return confirmPaidIncomeWithdrawalAfterPurchase({ client, signal, executionRegistry, confirmed: original, withdrawal: w })
}

/** Continue an already verified purchase with its exact retained withdrawal. */
export async function confirmPaidIncomeWithdrawalAfterPurchase({
  client, signal, executionRegistry, confirmed, withdrawal: w,
}: IncomeRead & {
  confirmed: ConfirmedPaidIncomePurchase
  withdrawal: ReturnType<typeof incomeWithdrawalRecoveryProps>
  executionRegistry?: IncomeExecutionRegistryV1
}) {
  const { economics, purchase } = confirmed, { money } = purchase
  commerceCheck(purchase.transactionDigest !== w.packet.digest && canonical(w.target) === canonical(economics),
    'PAID_INCOME_ORIGINAL_CONFIG_MISMATCH')
  if (money.protocolIncome === '0') return { status: 'PURCHASE_WITHOUT_PROTOCOL_FEE' as const, purchase }

  const withdrawn = await readIncomeWithdrawalHistory({ ...w, client, signal, executionRegistry })
  if (withdrawn.status !== 'WITHDRAWAL_EVIDENCE_CONFIRMED') {
    return { stage: 'WITHDRAWAL' as const, transactionDigest: w.packet.digest, purchase, ...withdrawn }
  }
  const payout = withdrawn.receipt, checkpointsOrdered = BigInt(purchase.checkpoint) <= BigInt(withdrawn.checkpoint)
  commerceCheck(checkpointsOrdered && payout.coinType === money.coinType, 'PAID_INCOME_CHECKPOINT_OR_COIN')
  const afterPurchase = money.platformLedger.after, beforeWithdrawal = payout.ledger.before
  const purchaseToWithdrawal = relateIncomeLedgerWitness(afterPurchase, beforeWithdrawal)
  // Both are writes of this same Shared object. The exact input version (or a
  // strictly later one) proves dependency order even within one checkpoint.
  const isolatedFeeCase = purchaseToWithdrawal.kind === 'SAME_CONFIG_REFERENCE'
    && money.platformLedger.before.balance === '0' && money.protocolIncome === payout.receipt.amount

  return { status: 'PAID_INCOME_ORIGINALS_CONFIRMED' as const, economics, evidence: { purchase, coinType: money.coinType,
    withdrawal: { transactionDigest: w.packet.digest, checkpoint: withdrawn.checkpoint, operator: payout.receipt.actor,
      recipient: payout.receipt.recipient, amountAtomic: payout.receipt.amount, paymentCoinId: payout.paymentCoinId,
      checkpointProof: payout.checkpointProof, adminInput: payout.inputAdmin,
      ledger: payout.ledger, gas: payout.gas },
    purchaseToWithdrawal, isolatedFeeCase } }
}

export type ConfirmedPaidIncomeOriginals = Extract<Awaited<ReturnType<typeof confirmPaidIncomeOriginals>>,
  { status: 'PAID_INCOME_ORIGINALS_CONFIRMED' }>

async function observeIncomeLedgerAfter({ client, signal, economics, after }: IncomeRead & {
  economics: ConfirmedPaidIncomePurchase['economics']; after: IncomeLedgerWitness
}) {
  signal.throwIfAborted()
  let current: ReturnType<typeof incomeLedgerWitness>
  try {
    const observed = await readEconomicsIncome({ client, target: economics, signal })
    current = incomeLedgerWitness(observed.config, { version: observed.object.version, digest: observed.object.digest },
      observed.initialSharedVersion)
  } catch {
    signal.throwIfAborted()
    return { status: 'PAID_INCOME_CURRENT_UNVERIFIED' as const, reason: 'CONFIG_READ_FAILED' as const }
  }
  signal.throwIfAborted()
  try {
    return { status: 'OBSERVED' as const, relation: relateIncomeLedgerWitness(after, current), current }
  } catch {
    return { status: 'PAID_INCOME_CURRENT_UNVERIFIED' as const, reason: 'CONFIG_REFERENCE_CONFLICT' as const }
  }
}

/** Compare the original credited Config with a fresh observation of the same ledger. */
export async function readCurrentPaidIncomeAfterPurchase({ confirmed, ...input }: IncomeRead & {
  confirmed: ConfirmedPaidIncomePurchase
}) {
  const { purchase, economics } = confirmed
  const observed = await observeIncomeLedgerAfter({ ...input, economics, after: purchase.money.platformLedger.after })
  return observed.status === 'OBSERVED'
    ? { purchase, status: 'PAID_INCOME_PURCHASE_LEDGER_OBSERVED' as const, purchaseToCurrent: observed.relation, current: observed.current }
    : { purchase, ...observed }
}

/** Observe the current Config against the already authenticated withdrawal output. */
export async function readCurrentPaidIncomeLedger({ confirmed, ...input }: IncomeRead & {
  confirmed: ConfirmedPaidIncomeOriginals
}) {
  const { economics, evidence } = confirmed
  const observed = await observeIncomeLedgerAfter({ ...input, economics, after: evidence.withdrawal.ledger.after })
  return observed.status === 'OBSERVED'
    ? { ...evidence, status: 'PAID_INCOME_LEDGER_RECONCILED' as const, withdrawalToCurrent: observed.relation, current: observed.current }
    : { ...evidence, ...observed }
}
