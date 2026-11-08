import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { publicMutationCanonical as canonical } from '../sui/public-mutation-journal'
import { commerceCheck as check } from './commerce/economics-read'
import { assertNativeSaleListingConsumed, readNativeSaleListingHistory } from './commerce/native-sale-relist'
import { sellerListingBinding } from './commerce/native-sale-seller-plan'
import { parsePurchaseRecoveryOriginal, queryPurchaseRecoveryOriginal } from './commerce/purchase-recovery-original'
import { parseNativeSellerRecord, type NativeSellerRecord } from './native-sale-seller-journal'

export function exportNativeSaleListing(record: NativeSellerRecord) {
  check(record.plan.intent.kind === 'LIST', 'NATIVE_SELLER_SETTLEMENT_LISTING')
  return canonical({ ...record, packet: { ...record.packet, phase: 'PREPARED', signature: null } })
}

export async function verifyNativeSaleSellerSettlement(input: {
  soulId: string; listingText: string; purchaseText: string; client: SuiGrpcClient; signal: AbortSignal
}) {
  const { soulId, listingText, purchaseText, signal } = input
  const source = input.client.ledgerService
  const client = { ledgerService: { getServiceInfo: source.getServiceInfo.bind(source), getTransaction: source.getTransaction.bind(source),
    getCheckpoint: source.getCheckpoint.bind(source), getObject: source.getObject.bind(source) } } as unknown as SuiGrpcClient
  signal.throwIfAborted()
  check(listingText.length > 0 && listingText.length <= 500000 && new TextEncoder().encode(listingText).byteLength <= 500000,
    'NATIVE_SELLER_SETTLEMENT_LISTING_FILE')
  const listing = await parseNativeSellerRecord(JSON.parse(listingText))
  const { plan: listingPlan, packet: listingPacket } = listing, { intent, release } = listingPlan
  check(intent.kind === 'LIST' && intent.soulId === soulId && listingPacket.phase === 'PREPARED'
    && listingPacket.signature === null, 'NATIVE_SELLER_SETTLEMENT_LISTING')

  const original = await parsePurchaseRecoveryOriginal(purchaseText, soulId)
  check(original.kind === 'native-sale-preparation.v1', 'NATIVE_SELLER_SETTLEMENT_PURCHASE')
  const { plan, packet, context } = original.value
  check(packet.phase === 'PREPARED' && packet.signature === null && packet.digest !== listingPacket.digest
    && plan.buyer !== intent.seller && plan.sellerKioskId === listingPlan.kioskId
    && plan.policyId === intent.policyId && plan.collectionId === intent.collectionId
    && canonical({ target: context.target, economics: context.economics, collection: context.collection }) === canonical(release),
  'NATIVE_SELLER_SETTLEMENT_PURCHASE_SCOPE')

  signal.throwIfAborted()
  const created = await readNativeSaleListingHistory({ client, native: release.target.native, packet: listingPacket,
    plan: sellerListingBinding(listingPlan), signal })
  if (created.status !== 'RELIST_CONFIRMED') return { status: created.status, stage: 'LISTING' as const, digest: listingPacket.digest }
  check(created.receipt.offerId === plan.offerId, 'NATIVE_SELLER_SETTLEMENT_WRONG_OFFER')

  const observed = await queryPurchaseRecoveryOriginal({ text: purchaseText, soulId, client, signal,
    proveSaleSource: true, proveSaleCustody: true, proveSaleCleanup: true })
  check(observed.kind === 'native-sale-preparation.v1', 'NATIVE_SELLER_SETTLEMENT_PURCHASE')
  const sale = observed.history
  if (sale.status !== 'SETTLEMENT_CONFIRMED') return { status: sale.status, stage: 'PURCHASE' as const, digest: packet.digest }
  const { money, custody, cleanup, listingExit, effectsReconciliation } = sale.receipt
  check(BigInt(sale.checkpoint) >= BigInt(created.checkpoint) && money.seller === intent.seller
    && custody?.transactionDigest === packet.digest && custody.soulId === soulId && cleanup
    && money.sourceBinding?.soulBinding?.soulId === soulId && !money.requiresOriginalSourceBindingProof
    && effectsReconciliation.status === 'OBJECT_EFFECTS_ACCOUNTED', 'NATIVE_SELLER_SETTLEMENT_EFFECTS')
  if (plan.collectionId) {
    const binding = money.reciprocalCollection
    check(binding?.collectionId === plan.collectionId && binding.soulId === soulId, 'NATIVE_SELLER_SETTLEMENT_COLLECTION')
  }
  assertNativeSaleListingConsumed(created.receipt, listingExit, 'NATIVE_SELLER_SETTLEMENT_LISTING_INPUT')
  return { status: 'SETTLEMENT_CONFIRMED' as const, listingDigest: listingPacket.digest, purchaseDigest: packet.digest,
    checkpoint: sale.checkpoint, offerId: plan.offerId, buyer: plan.buyer, seller: money.seller, creator: money.creator,
    collectionHolder: money.collectionHolder, coinType: money.coinType, total: money.buyerGrossDebit, buyerNet: money.buyerNetBusinessDebit,
    sellerAmount: String(money.quote.ask), creatorRoyalty: String(money.quote.creator), collectionRoyalty: String(money.quote.collection),
    sellerReceived: String(money.payouts.reduce((sum, row) => sum + (row.owner === money.seller ? BigInt(row.amount) : 0n), 0n)),
    protocolIncome: money.protocolIncome, payouts: money.payouts, gasMist: money.gas.netGasCharge }
}
