import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { isValidTransactionDigest, normalizeStructTag } from '@mysten/sui/utils'
import { queryEquipmentMarketPurchaseFunds } from '../../animacraft/equipment-market-purchase-funds'
import { parseEquipmentPurchaseOriginal } from '../../animacraft/equipment-market-purchase-original'
import { bindCollectionBuyerListingOriginals, readCollectionBuyerListingHistory,
  type CollectionBuyerListingExpectation } from '../../collections/collection-buyer-listing-history'
import { readCollectionBuyHandoff } from '../../collections/collection-buy-handoff'
import { parseCollectionBuyRecord, queryCollectionBuyOriginal } from '../../collections/collection-buy-operation'
import type { ActivityCheckpointTransactionRef } from '../activity-transaction-evidence'
import { publicMutationCanonical as canonical } from '../../sui/public-mutation-journal'
import { commerceCheck, commerceId, readEconomicsIncome } from './economics-read'
import { readNativeSaleFinalized } from './native-sale-finalized'
import type { IncomeExecutionRegistryV1 } from './income-execution-source-v1'
import { importIncomeWithdrawalRecoveryRecord, incomeWithdrawalRecoveryProps } from './income-withdrawal-recovery-record'
import { confirmPaidIncomePurchase, confirmPaidIncomeWithdrawalAfterPurchase, readCurrentPaidIncomeAfterPurchase, readCurrentPaidIncomeLedger,
  type ConfirmedPaidIncomePurchase } from './paid-income-ledger-reconciliation'
import { parsePurchaseRecoveryOriginal } from './purchase-recovery-original'

const CASE_SCHEMA = 'soulidity.commerce.public-acceptance-case.v1'
const REPORT_SCHEMA = 'soulidity.commerce.public-acceptance-report.v1'
const MAINNET = '35834a8a'
const CASE_FIELDS = {
  SOUL: ['soulId', 'offerId'],
  COLLECTION_RIGHT: ['collectionId', 'rightId', 'listingId'],
  INDEPENDENT_COMPONENT: ['itemId', 'listingId'],
  PAID_CONTENT: ['soulId', 'namespace', 'recordIndex'],
} as const

type CaseFields = typeof CASE_FIELDS
type AssetType = keyof CaseFields
type WithdrawalExpectation = {
  originalDigest: string
  operator: string
  adminId: string
  recipient: string
  amountAtomic: string
}

type Expected = {
  [K in AssetType]: { assetType: K } & {
    [F in CaseFields[K][number]]: F extends 'recordIndex' ? number : string
  } & (K extends 'PAID_CONTENT' ? { withdrawal?: WithdrawalExpectation }
    : K extends 'COLLECTION_RIGHT' ? { buyerListing?: CollectionBuyerListingExpectation } : {})
}[AssetType] & {
  schema: typeof CASE_SCHEMA
  originalDigest: string
  buyer: string
  counterparty: string
  coinType: string
  totalAtomic: string
}

type Payout = { coinId: string; owner: string; amount: string }
type OriginalResult = { status: 'MISSING' | 'PENDING' | 'FAILED' | 'LEGACY_EFFECTS'; checkpoint?: string } | {
  status: 'PROVED'
  checkpointProof: ActivityCheckpointTransactionRef
  settlement: {
    buyerGrossDebitAtomic: string
    buyerNetBusinessDebitAtomic: string
    payouts: Payout[]
    protocolCredit: { kind: 'LEDGER' | 'DIRECT_PAYOUT'; amountAtomic: string; objectId: string | null }
    netGasMist: string
  }
  laneEvidence: object
  withdrawalEvidence?: WithdrawalEvidence
  buyerListingEvidence?: Awaited<ReturnType<typeof readCollectionBuyerListingHistory>>
}
type ReplayInput = {
  client: SuiGrpcClient
  signal: AbortSignal
  originalText: string
  withdrawalText?: string
  executionRegistry?: IncomeExecutionRegistryV1
  collectionFollowUp?: { listingText: string; cancellationText: string }
}
type WithdrawalResult = Awaited<ReturnType<typeof confirmPaidIncomeWithdrawalAfterPurchase>>
type WithdrawalEvidence =
  | { status: 'PURCHASE_NOT_PROVED' | 'PURCHASE_WITHOUT_PROTOCOL_FEE' | 'MISSING' | 'PENDING' | 'FAILED' | 'FINALIZED_EXECUTION'
      transactionDigest: string; checkpoint?: string; checkpointProof?: ActivityCheckpointTransactionRef; qualificationStatus?: string }
  | Awaited<ReturnType<typeof observeWithdrawalLedger>>

const WITHDRAWAL_WALLET_STEP = 'Authorized income withdrawal and wallet proceeds'
const BUYER_LISTING_WALLET_STEP = 'Buyer lists and cancels the purchased Right'

const WALLET_STEPS = {
  SOUL: ['Seller listing, cancel and relist receipts', 'Buyer reopens the original Soul content', 'Former holder access denial', 'Recovery case'],
  COLLECTION_RIGHT: ['Seller listing, cancel and relist receipts', BUYER_LISTING_WALLET_STEP, 'Former holder wallet is denied', 'Recovery case'],
  INDEPENDENT_COMPONENT: ['Seller listing, cancel and relist receipts', 'Buyer can use the component and former holder is denied', 'Recovery case'],
  PAID_CONTENT: ['Buyer opens the expected content version with Seal', 'Same-kind Entry reuse without a second payment',
    WITHDRAWAL_WALLET_STEP, 'Recovery case'],
} satisfies Record<AssetType, string[]>

function isDigest(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 44 && isValidTransactionDigest(value)
}

function isPositiveAtomic(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value) && BigInt(value) < (1n << 64n)
}

function assertWithdrawalExpectation(value: unknown): asserts value is WithdrawalExpectation {
  commerceCheck(value && typeof value === 'object' && !Array.isArray(value), 'ACCEPTANCE_WITHDRAWAL_FIELDS')
  const row = value as WithdrawalExpectation
  const keys = ['originalDigest', 'operator', 'adminId', 'recipient', 'amountAtomic']
  commerceCheck(Object.keys(row).length === keys.length && keys.every(key => Object.hasOwn(row, key)), 'ACCEPTANCE_WITHDRAWAL_FIELDS')
  commerceCheck(isDigest(row.originalDigest) && commerceId(row.operator) && commerceId(row.adminId)
    && commerceId(row.recipient) && isPositiveAtomic(row.amountAtomic), 'ACCEPTANCE_WITHDRAWAL_EXPECTATION')
}

function assertBuyerListingExpectation(value: unknown): asserts value is CollectionBuyerListingExpectation {
  commerceCheck(value && typeof value === 'object' && !Array.isArray(value), 'ACCEPTANCE_BUYER_LISTING_FIELDS')
  const row = value as CollectionBuyerListingExpectation
  const keys = ['listingDigest', 'cancellationDigest', 'buyerListingId']
  commerceCheck(Object.keys(row).length === keys.length && keys.every(key => Object.hasOwn(row, key)), 'ACCEPTANCE_BUYER_LISTING_FIELDS')
  commerceCheck(isDigest(row.listingDigest) && isDigest(row.cancellationDigest) && commerceId(row.buyerListingId),
    'ACCEPTANCE_BUYER_LISTING_EXPECTATION')
}

function parseExpected(input: unknown): Expected {
  commerceCheck(input && typeof input === 'object' && !Array.isArray(input), 'ACCEPTANCE_CASE_FIELDS')
  const row = structuredClone(input) as Expected
  commerceCheck(row.schema === CASE_SCHEMA && Object.hasOwn(CASE_FIELDS, row.assetType), 'ACCEPTANCE_CASE_SCHEMA')
  const fields = ['schema', 'assetType', 'originalDigest', 'buyer', 'counterparty', 'coinType', 'totalAtomic', ...CASE_FIELDS[row.assetType]]
  if (row.assetType === 'PAID_CONTENT' && Object.hasOwn(row, 'withdrawal')) {
    assertWithdrawalExpectation(row.withdrawal)
    commerceCheck(row.withdrawal.originalDigest !== row.originalDigest, 'ACCEPTANCE_WITHDRAWAL_DIGEST')
    fields.push('withdrawal')
  }
  if (row.assetType === 'COLLECTION_RIGHT' && Object.hasOwn(row, 'buyerListing')) {
    assertBuyerListingExpectation(row.buyerListing)
    commerceCheck(new Set([row.originalDigest, row.buyerListing.listingDigest, row.buyerListing.cancellationDigest]).size === 3
      && row.buyerListing.buyerListingId !== row.listingId, 'ACCEPTANCE_BUYER_LISTING_IDENTITY')
    fields.push('buyerListing')
  }
  commerceCheck(Object.keys(row).length === fields.length && fields.every(key => Object.hasOwn(row, key)), 'ACCEPTANCE_CASE_FIELDS')
  commerceCheck(isDigest(row.originalDigest), 'ACCEPTANCE_CASE_DIGEST')
  commerceCheck(commerceId(row.buyer) && commerceId(row.counterparty) && row.buyer !== row.counterparty, 'ACCEPTANCE_CASE_WALLETS')
  commerceCheck(typeof row.coinType === 'string' && row.coinType.length <= 2048 && row.coinType === normalizeStructTag(row.coinType),
    'ACCEPTANCE_CASE_COIN')
  commerceCheck(isPositiveAtomic(row.totalAtomic), 'ACCEPTANCE_CASE_TOTAL')
  for (const key of CASE_FIELDS[row.assetType]) {
    if (key === 'namespace' || key === 'recordIndex') continue
    commerceCheck(commerceId((row as unknown as Record<string, string>)[key]), 'ACCEPTANCE_CASE_ASSET_ID')
  }
  if (row.assetType === 'PAID_CONTENT') {
    commerceCheck(typeof row.namespace === 'string' && /^(?:[0-9a-f]{2}){1,256}$/.test(row.namespace)
      && Number.isInteger(row.recordIndex) && row.recordIndex >= 0 && row.recordIndex < 4096, 'ACCEPTANCE_CASE_RECORD')
  }
  return row
}

function bind(expected: Expected, digest: string, buyer: string, coinType: string, total: string) {
  commerceCheck(digest === expected.originalDigest && buyer === expected.buyer
    && normalizeStructTag(coinType) === expected.coinType && total === expected.totalAtomic, 'ACCEPTANCE_ORIGINAL_MISMATCH')
}

function settlement(e: Expected, payouts: Payout[], protocolCredit: Extract<OriginalResult, { status: 'PROVED' }>['settlement']['protocolCredit'],
  netGasMist: string) {
  const returns = payouts.filter(payout => payout.owner === e.buyer).reduce((sum, payout) => sum + BigInt(payout.amount), 0n)
  return { buyerGrossDebitAtomic: e.totalAtomic, buyerNetBusinessDebitAtomic: String(BigInt(e.totalAtomic) - returns),
    payouts, protocolCredit, netGasMist }
}

async function observeCurrent<T>(signal: AbortSignal, read: () => Promise<T>) {
  try {
    return await read()
  } catch {
    signal.throwIfAborted()
    return { status: 'CURRENT_UNAVAILABLE' as const }
  }
}

function currentIncome(input: ReplayInput, target: Parameters<typeof readEconomicsIncome>[0]['target']) {
  return observeCurrent(input.signal, async () => {
    const { object, ledger } = await readEconomicsIncome({ client: input.client, target, signal: input.signal })
    return { status: 'CURRENT_LEDGER_READ' as const, object, ledger }
  })
}

async function soul(e: Extract<Expected, { assetType: 'SOUL' }>, input: ReplayInput): Promise<OriginalResult> {
  const { client, signal, originalText } = input
  const original = await parsePurchaseRecoveryOriginal(originalText, e.soulId)
  commerceCheck(original.kind === 'native-sale-preparation.v1', 'ACCEPTANCE_SOUL_ORIGINAL')
  const { plan, packet, context } = original.value
  bind(e, packet.digest, plan.buyer, plan.coinType, plan.reviewedTotal)
  commerceCheck(plan.offerId === e.offerId, 'ACCEPTANCE_OFFER_MISMATCH')
  const result = await readNativeSaleFinalized({ client, signal, packet, buyer: plan.buyer, context, plan,
    proveSaleSource: true, proveSaleCustody: true, proveSaleCleanup: true })
  if (result.status !== 'SETTLEMENT_CONFIRMED') return result
  const { money, custody, cleanup, effectsReconciliation } = result.receipt
  commerceCheck(money.seller === e.counterparty, 'ACCEPTANCE_COUNTERPARTY_MISMATCH')
  commerceCheck(custody && cleanup && money.sourceBinding && effectsReconciliation.status === 'OBJECT_EFFECTS_ACCOUNTED',
    'ACCEPTANCE_SOUL_EFFECTS')
  return { status: 'PROVED', checkpointProof: result.receipt.checkpointProof,
    settlement: settlement(e, money.payouts, { kind: 'LEDGER', amountAtomic: money.protocolIncome, objectId: plan.configId }, money.gas.netGasCharge),
    laneEvidence: { creator: money.creator, collectionHolder: money.collectionHolder,
      royaltyAtomic: { creator: String(money.quote.creator), collection: String(money.quote.collection) },
      originalCustody: { buyerKioskId: custody.buyerKioskId, buyerAccountId: custody.buyerAccountId, rootRevision: custody.rootRevision },
      currentIncome: await currentIncome(input, context.economics) } }
}

async function collection(e: Extract<Expected, { assetType: 'COLLECTION_RIGHT' }>, input: ReplayInput): Promise<OriginalResult> {
  const { client, signal, originalText } = input
  const record = parseCollectionBuyRecord(JSON.parse(originalText))
  const { plan, packet } = record
  bind(e, packet.digest, plan.author, plan.target.paymentCoinType, plan.quote.buyerTotalAtomic)
  commerceCheck(plan.target.chainIdentifier === MAINNET && plan.request.collectionId === e.collectionId
    && plan.rightId === e.rightId && plan.request.listingId === e.listingId && plan.sellerAddress === e.counterparty, 'ACCEPTANCE_COLLECTION_MISMATCH')
  const originals = e.buyerListing && input.collectionFollowUp
    ? bindCollectionBuyerListingOriginals({ expected: e.buyerListing, purchase: record, ...input.collectionFollowUp })
    : undefined
  const result = await queryCollectionBuyOriginal({ client, record, signal })
  if (result.status !== 'SUCCEEDED') return { status: result.status, checkpoint: result.checkpoint }
  const receipt = result.receipt, money = receipt?.settlement
  commerceCheck(receipt && money?.payouts && result.checkpointProof, 'ACCEPTANCE_COLLECTION_RECEIPT')
  const buyerListingEvidence = originals && await readCollectionBuyerListingHistory({ client, signal, originals, purchase: result })
  return { status: 'PROVED', checkpointProof: result.checkpointProof, buyerListingEvidence,
    settlement: settlement(e, money.payouts,
      { kind: 'DIRECT_PAYOUT', amountAtomic: receipt.platformFeeAtomic, objectId: null }, money.netGasMist),
    laneEvidence: { sellerPriceAtomic: receipt.priceAtomic, platformFeeRecipient: money.feeRecipient,
      originalCustody: { buyerKioskId: receipt.buyerKioskId, buyerKioskCapId: receipt.buyerKioskCapId },
      currentCustody: await observeCurrent(signal, () => readCollectionBuyHandoff({ client, plan, receipt, signal })) } }
}

async function component(e: Extract<Expected, { assetType: 'INDEPENDENT_COMPONENT' }>, input: ReplayInput): Promise<OriginalResult> {
  const { client, signal, originalText } = input
  const record = parseEquipmentPurchaseOriginal(JSON.parse(originalText), e.itemId)
  const { snapshot } = record
  bind(e, record.digest, snapshot.actor, snapshot.target.paymentCoinType, record.priceAtomic)
  commerceCheck(snapshot.seller === e.counterparty && snapshot.listing?.id === e.listingId, 'ACCEPTANCE_COMPONENT_MISMATCH')
  const result = await queryEquipmentMarketPurchaseFunds(record, client, signal, { proveCustody: true })
  if (result.status !== 'FUNDS_VERIFIED') return result
  const { receipt, custody } = result
  commerceCheck(custody?.originalHolder === e.buyer, 'ACCEPTANCE_COMPONENT_RECEIPT')
  return { status: 'PROVED', checkpointProof: result.checkpointProof,
    settlement: settlement(e, [{ coinId: result.sellerPayoutId, owner: receipt.seller, amount: receipt.sellerAtomic }],
      { kind: 'LEDGER', amountAtomic: receipt.protocolAtomic, objectId: result.protocolTreasuryId }, result.gas.netGasCharge),
    laneEvidence: { creatorAtomic: receipt.creatorAtomic, sourceAtomic: receipt.sourceAtomic, custody } }
}

function bindWithdrawal(expected: WithdrawalExpectation, text: string, target: ConfirmedPaidIncomePurchase['economics']) {
  const original = incomeWithdrawalRecoveryProps(importIncomeWithdrawalRecoveryRecord(text))
  const { target: withdrawalTarget, packet, intent } = original
  commerceCheck(canonical(withdrawalTarget) === canonical(target) && packet.digest === expected.originalDigest
    && intent.actor === expected.operator && intent.adminId === expected.adminId && intent.recipient === expected.recipient
    && intent.amount === expected.amountAtomic, 'ACCEPTANCE_WITHDRAWAL_ORIGINAL_MISMATCH')
  return original
}

function withdrawalObservation(result: Exclude<WithdrawalResult, { status: 'PAID_INCOME_ORIGINALS_CONFIRMED' }>,
  transactionDigest: string): WithdrawalEvidence {
  const { status } = result
  const report = { status, transactionDigest, ...('checkpoint' in result ? { checkpoint: result.checkpoint } : {}) }
  return status === 'FINALIZED_EXECUTION'
    ? { ...report, checkpointProof: result.checkpointProof, qualificationStatus: result.qualification.status }
    : report
}

async function observeWithdrawalLedger(input: Parameters<typeof readCurrentPaidIncomeLedger>[0]) {
  const observed = await readCurrentPaidIncomeLedger(input)
  const { coinType, isolatedFeeCase, purchaseToWithdrawal, withdrawal } = observed
  const evidence = { coinType, isolatedFeeCase, purchaseToWithdrawal, withdrawal }
  return observed.status === 'PAID_INCOME_LEDGER_RECONCILED'
    ? { ...evidence, status: observed.status, current: observed.current, withdrawalToCurrent: observed.withdrawalToCurrent }
    : { ...evidence, status: observed.status, reason: observed.reason }
}

async function paidContent(e: Extract<Expected, { assetType: 'PAID_CONTENT' }>, input: ReplayInput): Promise<OriginalResult> {
  const { client, signal, originalText } = input
  const original = await parsePurchaseRecoveryOriginal(originalText, e.soulId)
  commerceCheck(original.kind === 'native-public-read-v2', 'ACCEPTANCE_PAID_ORIGINAL')
  const { intent, packet, context } = original.value
  bind(e, packet.digest, intent.buyer, intent.coinType, intent.quote.total)
  commerceCheck(context.originalQuotedOffer.issuer === e.counterparty && intent.recordGuard?.index === e.recordIndex
    && intent.recordGuard.namespace === e.namespace, 'ACCEPTANCE_PAID_RECORD_MISMATCH')
  const withdrawal = e.withdrawal && input.withdrawalText !== undefined
    ? bindWithdrawal(e.withdrawal, input.withdrawalText, context.economics)
    : undefined
  const confirmed = await confirmPaidIncomePurchase({ purchaseText: originalText, soulId: e.soulId, client, signal })
  if (confirmed.status !== 'PAID_INCOME_PURCHASE_CONFIRMED') return confirmed
  const { money, checkpointProof } = confirmed.purchase
  commerceCheck(money.payout.owner === e.counterparty, 'ACCEPTANCE_PAID_RECEIPT')
  const paidEvidence = { kind: intent.kind, originalPlatformLedger: money.platformLedger }
  const purchaseResult = {
    status: 'PROVED' as const, checkpointProof,
    settlement: settlement(e, [money.payout],
      { kind: 'LEDGER', amountAtomic: money.protocolIncome, objectId: context.economics.configId }, money.gas.netGasCharge),
    laneEvidence: paidEvidence,
  }
  if (!withdrawal) {
    const observed = await readCurrentPaidIncomeAfterPurchase({ client, signal, confirmed })
    const currentIncome = observed.status === 'PAID_INCOME_PURCHASE_LEDGER_OBSERVED'
      ? { status: observed.status, current: observed.current, purchaseToCurrent: observed.purchaseToCurrent }
      : { status: observed.status, reason: observed.reason }
    return { ...purchaseResult, laneEvidence: { ...paidEvidence, currentIncome } }
  }
  const reconciliation = await confirmPaidIncomeWithdrawalAfterPurchase({
    client, signal, confirmed, withdrawal, executionRegistry: input.executionRegistry,
  })
  if (reconciliation.status !== 'PAID_INCOME_ORIGINALS_CONFIRMED') {
    return { ...purchaseResult, withdrawalEvidence: withdrawalObservation(reconciliation, withdrawal.packet.digest) }
  }
  return { ...purchaseResult, withdrawalEvidence: await observeWithdrawalLedger({ client, signal, confirmed: reconciliation }) }
}

/** Select the same original and wallet pair before projecting public ledger
 * evidence. The original supplies the historical pins, not release admission. */
export async function replayCommerceAcceptance(expected: unknown, input: ReplayInput) {
  const e = parseExpected(expected)
  const withdrawalExpected = e.assetType === 'PAID_CONTENT' ? e.withdrawal : undefined
  commerceCheck(Boolean(withdrawalExpected) === (input.withdrawalText !== undefined), 'ACCEPTANCE_WITHDRAWAL_FILE_PAIR')
  const buyerListingExpected = e.assetType === 'COLLECTION_RIGHT' ? e.buyerListing : undefined
  commerceCheck(Boolean(buyerListingExpected) === (input.collectionFollowUp !== undefined), 'ACCEPTANCE_BUYER_LISTING_FILE_PAIR')
  const { client } = input
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(90_000)])
  const read = { ...input, signal }
  let result: OriginalResult
  switch (e.assetType) {
    case 'SOUL': result = await soul(e, read); break
    case 'COLLECTION_RIGHT': result = await collection(e, read); break
    case 'INDEPENDENT_COMPONENT': result = await component(e, read); break
    case 'PAID_CONTENT': result = await paidContent(e, read); break
  }
  signal.throwIfAborted()
  const withdrawalProved = result.status === 'PROVED' && result.withdrawalEvidence?.status === 'PAID_INCOME_LEDGER_RECONCILED'
  const buyerListingProved = result.status === 'PROVED' && result.buyerListingEvidence?.status === 'BUYER_LIST_AND_CANCEL_PROVED'
  const report = { schema: REPORT_SCHEMA, chainIdentifier: MAINNET, expected: e,
    counterpartyRole: e.assetType === 'PAID_CONTENT' ? 'BENEFICIARY' : 'SELLER',
    walletStepsOutstanding: WALLET_STEPS[e.assetType].filter(step =>
      (step !== WITHDRAWAL_WALLET_STEP || !withdrawalProved) && (step !== BUYER_LISTING_WALLET_STEP || !buyerListingProved)) }
  if (result.status !== 'PROVED') {
    const withdrawalEvidence = withdrawalExpected && { status: 'PURCHASE_NOT_PROVED' as const,
      transactionDigest: withdrawalExpected.originalDigest }
    const buyerListingEvidence = buyerListingExpected && { status: 'PURCHASE_NOT_PROVED' as const }
    return { ...report, status: result.status, checkpoint: result.checkpoint, withdrawalEvidence, buyerListingEvidence }
  }
  return { ...report, status: 'ORIGINAL_SETTLEMENT_PROVED' as const,
    checkpoint: { sequence: result.checkpointProof.checkpoint, digest: result.checkpointProof.digest,
      effectsDigest: result.checkpointProof.effectsDigest },
    settlement: result.settlement, laneEvidence: result.laneEvidence,
    withdrawalEvidence: result.withdrawalEvidence, buyerListingEvidence: result.buyerListingEvidence }
}
