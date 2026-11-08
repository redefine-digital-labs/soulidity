import { parseNativePublicReadPaidRecordV2, type NativePublicReadPaidRecordV2, type queryNativePublicReadPaidRecordV2 } from '../native-public-read-paid-journal-v2'
import { parsePurchaseRecoveryOriginal } from './purchase-recovery-original'
import { commerceCheck } from './economics-read'

type History = Awaited<ReturnType<typeof queryNativePublicReadPaidRecordV2>>

/** Internal UI boundary for an actual original-reader result, not an RPC or
 * independently verifiable finality certificate. Never change the journal or
 * turn historical subscription evidence into current access/withdrawal rights.
 */
export async function bindNativePublicReadPaidOriginalOutcomeV2(input: { record: NativePublicReadPaidRecordV2; history: History }) {
  const saved = structuredClone({ record: input.record, history: input.history }), record = await parseNativePublicReadPaidRecordV2(saved.record)
  const original = await parsePurchaseRecoveryOriginal(record.plan.originalText, record.plan.soulId)
  commerceCheck(original.kind === 'native-public-read-v2', 'PUBLIC_PAID_V2_OUTCOME_FORMAT')
  const history = saved.history
  if (history.status !== 'SUBSCRIPTION_RECORDED') return { status: 'ORIGINAL_OUTCOME_INCOMPLETE' as const, record, original, history }
  const receipt = history.receipt, money = receipt.money, p = original.value.intent, context = original.value.context.originalReceiptContext
  commerceCheck(money && receipt.notMoneySettlementProof === false, 'PUBLIC_PAID_V2_OUTCOME_MONEY_REQUIRED')
  commerceCheck(receipt.transactionDigest === record.packet.digest && receipt.soulId === record.plan.soulId
    && receipt.hostId === p.host.objectId && receipt.ledgerId === context.ledgerId
    && money.transactionDigest === record.packet.digest && money.gas.transactionDigest === record.packet.digest
    && money.buyer === p.buyer && money.coinType === p.coinType && money.gas.owner === p.buyer,
    'PUBLIC_PAID_V2_OUTCOME_IDENTITY')
  commerceCheck(money.buyerGrossDebit === p.quote.total && money.payout.owner === context.offer.issuer
    && money.payout.amount === context.offer.price && receipt.receipt.beneficiary === money.payout.owner
    && receipt.receipt.price === money.payout.amount && receipt.receipt.total === money.buyerGrossDebit
    && receipt.receipt.platform_fee === money.protocolIncome
    && BigInt(money.payout.amount) + BigInt(money.protocolIncome) === BigInt(money.buyerGrossDebit),
    'PUBLIC_PAID_V2_OUTCOME_AMOUNTS')
  return { status: 'ORIGINAL_MONEY_BOUND' as const, record, original,
    query: { kind: 'native-public-read-v2' as const, history },
    money: { transactionDigest: money.transactionDigest, coinType: money.coinType, buyerGrossDebit: money.buyerGrossDebit,
      payout: money.payout, protocolIncome: money.protocolIncome, netGasCharge: money.gas.netGasCharge },
    notIndependentFinalityProof: true as const, notCurrentAccessOrBalances: true as const,
    notCompleteSubscriptionProof: true as const, notWithdrawalAuthority: true as const }
}
