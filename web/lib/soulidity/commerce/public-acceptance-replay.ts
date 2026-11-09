import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { isValidTransactionDigest, normalizeStructTag } from '@mysten/sui/utils'
import { queryEquipmentMarketPurchaseFunds } from '../../animacraft/equipment-market-purchase-funds'
import { parseEquipmentPurchaseOriginal } from '../../animacraft/equipment-market-purchase-original'
import { readCollectionBuyHandoff } from '../../collections/collection-buy-handoff'
import { parseCollectionBuyRecord, queryCollectionBuyOriginal } from '../../collections/collection-buy-operation'
import type { ActivityCheckpointTransactionRef } from '../activity-transaction-evidence'
import { commerceCheck, commerceId, readEconomicsIncome } from './economics-read'
import { readNativePublicReadPaidHistoryV2 } from './native-public-read-paid-history-v2'
import { readNativeSaleFinalized } from './native-sale-finalized'
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
type Expected = {
  [K in AssetType]: { assetType: K } & {
    [F in CaseFields[K][number]]: F extends 'recordIndex' ? number : string
  }
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
}
type ReplayInput = { client: SuiGrpcClient; signal: AbortSignal; originalText: string }

const WALLET_STEPS = {
  SOUL: ['Seller listing, cancel and relist receipts', 'Buyer reopens the original Soul content', 'Former holder access denial', 'Recovery case'],
  COLLECTION_RIGHT: ['Seller listing, cancel and relist receipts', 'Buyer can use the Right and former holder is denied', 'Recovery case'],
  INDEPENDENT_COMPONENT: ['Seller listing, cancel and relist receipts', 'Buyer can use the component and former holder is denied', 'Recovery case'],
  PAID_CONTENT: ['Buyer opens the expected content version with Seal', 'Same-kind Entry reuse without a second payment',
    'Authorized income withdrawal and wallet proceeds', 'Recovery case'],
} satisfies Record<AssetType, string[]>

function parseExpected(input: unknown): Expected {
  commerceCheck(input && typeof input === 'object' && !Array.isArray(input), 'ACCEPTANCE_CASE_FIELDS')
  const row = structuredClone(input) as Expected
  commerceCheck(row.schema === CASE_SCHEMA && Object.hasOwn(CASE_FIELDS, row.assetType), 'ACCEPTANCE_CASE_SCHEMA')
  const fields = ['schema', 'assetType', 'originalDigest', 'buyer', 'counterparty', 'coinType', 'totalAtomic', ...CASE_FIELDS[row.assetType]]
  commerceCheck(Object.keys(row).length === fields.length && fields.every(key => Object.hasOwn(row, key)), 'ACCEPTANCE_CASE_FIELDS')
  commerceCheck(typeof row.originalDigest === 'string' && row.originalDigest.length <= 44
    && isValidTransactionDigest(row.originalDigest), 'ACCEPTANCE_CASE_DIGEST')
  commerceCheck(commerceId(row.buyer) && commerceId(row.counterparty) && row.buyer !== row.counterparty, 'ACCEPTANCE_CASE_WALLETS')
  commerceCheck(typeof row.coinType === 'string' && row.coinType.length <= 2048 && row.coinType === normalizeStructTag(row.coinType),
    'ACCEPTANCE_CASE_COIN')
  commerceCheck(typeof row.totalAtomic === 'string' && /^[1-9][0-9]{0,19}$/.test(row.totalAtomic)
    && BigInt(row.totalAtomic) < (1n << 64n), 'ACCEPTANCE_CASE_TOTAL')
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
  const result = await queryCollectionBuyOriginal({ client, record, signal })
  if (result.status !== 'SUCCEEDED') return { status: result.status, checkpoint: result.checkpoint }
  const receipt = result.receipt, money = receipt?.settlement
  commerceCheck(receipt && money?.payouts && result.checkpointProof, 'ACCEPTANCE_COLLECTION_RECEIPT')
  return { status: 'PROVED', checkpointProof: result.checkpointProof,
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

async function paidContent(e: Extract<Expected, { assetType: 'PAID_CONTENT' }>, input: ReplayInput): Promise<OriginalResult> {
  const { client, signal, originalText } = input
  const original = await parsePurchaseRecoveryOriginal(originalText, e.soulId)
  commerceCheck(original.kind === 'native-public-read-v2', 'ACCEPTANCE_PAID_ORIGINAL')
  const { intent, packet, reviewedGas, context } = original.value
  bind(e, packet.digest, intent.buyer, intent.coinType, intent.quote.total)
  commerceCheck(context.originalQuotedOffer.issuer === e.counterparty && intent.recordGuard?.index === e.recordIndex
    && intent.recordGuard.namespace === e.namespace, 'ACCEPTANCE_PAID_RECORD_MISMATCH')
  const result = await readNativePublicReadPaidHistoryV2({ ...context.originalReceiptContext, intent, packet, gas: reviewedGas,
    client, signal, proveMoney: true })
  if (result.status !== 'SUBSCRIPTION_RECORDED') return result
  const { money } = result.receipt
  commerceCheck(money?.payout.owner === e.counterparty, 'ACCEPTANCE_PAID_RECEIPT')
  return { status: 'PROVED', checkpointProof: result.receipt.checkpointProof,
    settlement: settlement(e, [money.payout],
      { kind: 'LEDGER', amountAtomic: money.protocolIncome, objectId: context.economics.configId }, money.gas.netGasCharge),
    laneEvidence: { kind: intent.kind, originalPlatformLedger: money.platformLedger,
      currentIncome: await currentIncome(input, context.economics) } }
}

/** Select the same original and wallet pair before projecting public ledger
 * evidence. The original supplies the historical pins, not release admission. */
export async function replayCommerceAcceptance(expected: unknown, input: ReplayInput) {
  const e = parseExpected(expected)
  const { client } = input
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(90_000)])
  const read = { client, signal, originalText: input.originalText }
  let result: OriginalResult
  switch (e.assetType) {
    case 'SOUL': result = await soul(e, read); break
    case 'COLLECTION_RIGHT': result = await collection(e, read); break
    case 'INDEPENDENT_COMPONENT': result = await component(e, read); break
    case 'PAID_CONTENT': result = await paidContent(e, read); break
  }
  signal.throwIfAborted()
  const report = { schema: REPORT_SCHEMA, chainIdentifier: MAINNET, expected: e,
    counterpartyRole: e.assetType === 'PAID_CONTENT' ? 'BENEFICIARY' : 'SELLER',
    walletStepsOutstanding: WALLET_STEPS[e.assetType] }
  if (result.status !== 'PROVED') return { ...report, status: result.status, checkpoint: result.checkpoint }
  return { ...report, status: 'ORIGINAL_SETTLEMENT_PROVED' as const,
    checkpoint: { sequence: result.checkpointProof.checkpoint, digest: result.checkpointProof.digest,
      effectsDigest: result.checkpointProof.effectsDigest },
    settlement: result.settlement, laneEvidence: result.laneEvidence }
}
