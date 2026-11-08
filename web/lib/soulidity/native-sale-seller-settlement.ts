import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { profileReadStep } from '@soulidity/sdk'
import { MAINNET_GENESIS_DIGEST } from '../animacraft/mainnet-chain'
import { marketListDigest } from '../animacraft/market-list-operation'
import { readPinnedMovePackage } from '../sui/pinned-move-package'
import { publicMutationCanonical as canonical } from '../sui/public-mutation-journal'
import { commerceCheck as check, decodeCommerce, readCommerceObject } from './commerce/economics-read'
import { NativeOfferBcs } from './commerce/economics-bcs'
import { readNativeSaleCancellationHistory } from './commerce/native-sale-cancellation'
import { readNativeSaleFinalized } from './commerce/native-sale-finalized'
import { decodeNativeSaleClosingPurchase, readNativeSaleClosingPacket } from './commerce/native-sale-original-graph'
import { assertNativeSaleListingConsumed, readNativeSaleListingHistory } from './commerce/native-sale-relist'
import { sellerListingBinding } from './commerce/native-sale-seller-plan'
import { parsePurchaseRecoveryOriginal, PURCHASE_ORIGINAL_MAX_BYTES } from './commerce/purchase-recovery-original'
import { parseNativeSellerRecord, type NativeSellerRecord } from './native-sale-seller-journal'

export function exportNativeSaleListing(record: NativeSellerRecord) {
  check(record.plan.intent.kind === 'LIST', 'NATIVE_SELLER_SETTLEMENT_LISTING')
  return canonical({ schema: record.schema, plan: record.plan, packet: { ...record.packet, phase: 'PREPARED', signature: null } })
}

export async function verifyNativeSaleSellerSettlement(input: {
  soulId: string; listingText: string; purchaseText?: string; closingDigest?: string; client: SuiGrpcClient; signal: AbortSignal
}) {
  const { soulId, listingText, purchaseText, closingDigest } = input
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(90000)])
  const source = input.client.ledgerService
  const client = { ledgerService: { getServiceInfo: source.getServiceInfo.bind(source), getTransaction: source.getTransaction.bind(source),
    getCheckpoint: source.getCheckpoint.bind(source), getObject: source.getObject.bind(source) } } as unknown as SuiGrpcClient
  signal.throwIfAborted()
  check(purchaseText === undefined || closingDigest === undefined, 'NATIVE_SELLER_SETTLEMENT_INPUT_MODE')
  check(closingDigest === undefined || marketListDigest(closingDigest), 'NATIVE_CLOSURE_DIGEST')
  check(listingText.length > 0 && listingText.length <= PURCHASE_ORIGINAL_MAX_BYTES
    && new TextEncoder().encode(listingText).byteLength <= PURCHASE_ORIGINAL_MAX_BYTES, 'NATIVE_SELLER_SETTLEMENT_LISTING_FILE')
  const listing = await parseNativeSellerRecord(JSON.parse(listingText))
  const { plan: listingPlan, packet: listingPacket } = listing, { intent, release } = listingPlan
  check(intent.kind === 'LIST' && intent.soulId === soulId && listingPacket.phase === 'PREPARED'
    && listingPacket.signature === null, 'NATIVE_SELLER_SETTLEMENT_LISTING')
  const { target, economics } = release

  const original = purchaseText === undefined ? null : await parsePurchaseRecoveryOriginal(purchaseText, soulId)
  const portable = original?.kind === 'native-sale-preparation.v1' ? original.value : null
  check(original === null || portable, 'NATIVE_SELLER_SETTLEMENT_PURCHASE')
  if (portable) {
    const { plan, packet, context } = portable
    check(packet.phase === 'PREPARED' && packet.signature === null && packet.digest !== listingPacket.digest
      && plan.buyer !== intent.seller && plan.sellerKioskId === listingPlan.kioskId
      && plan.policyId === intent.policyId && plan.collectionId === intent.collectionId
      && canonical({ target: context.target, economics: context.economics, collection: context.collection }) === canonical(release),
    'NATIVE_SELLER_SETTLEMENT_PURCHASE_SCOPE')
  }

  const created = await readNativeSaleListingHistory({ client, native: target.native, packet: listingPacket,
    plan: sellerListingBinding(listingPlan), signal })
  if (created.status !== 'RELIST_CONFIRMED') return { status: created.status, stage: 'LISTING' as const, digest: listingPacket.digest }
  const { offerId } = created.receipt
  let digest = portable?.packet.digest ?? closingDigest
  let offerPointer: { version: string; digest: string; writer: string } | undefined
  if (digest === undefined) {
    const pkg = await readPinnedMovePackage(client, target.native, signal), origin = pkg.origins.get('market::Offer')
    check(origin, 'NATIVE_CLOSURE_OFFER_ORIGIN')
    const offer = await observeOffer()
    if (offer === null) return { status: 'OFFER_UNAVAILABLE' as const, offerId }
    const { row, value } = offer
    check(row.owner.Shared?.initialSharedVersion === created.receipt.offerOutput.version
      && value.id === offerId && value.root === soulId && value.seller === intent.seller && value.kiosk === listingPlan.kioskId
      && value.registry === target.registryId && value.config === target.configId && value.policy === intent.policyId
      && value.collection === intent.collectionId && value.ask === created.receipt.ask, 'NATIVE_CLOSURE_OFFER_IDENTITY')
    if (value.active) {
      check(value.purchase?.id === created.receipt.purchaseCapId && value.purchase.kiosk_id === listingPlan.kioskId
        && value.purchase.item_id === soulId && value.purchase.min_price === '0', 'NATIVE_CLOSURE_ACTIVE_CAP')
      return { status: 'OFFER_ACTIVE' as const, offerId }
    }
    check(value.purchase === null, 'NATIVE_CLOSURE_TERMINAL_CAP')
    offerPointer = { version: row.version, digest: row.digest, writer: row.previousTransaction }
    digest = offerPointer.writer

    async function observeOffer() {
      try {
        const row = await readCommerceObject(client, offerId, `${origin}::market::Offer`, signal)
        return { row, value: decodeCommerce(NativeOfferBcs, row.contents) }
      } catch (error) {
        signal.throwIfAborted()
        if (error && typeof error === 'object' && 'code' in error && error.code === 'NOT_FOUND') return null
        throw error
      }
    }
  }
  check(digest !== listingPacket.digest, 'NATIVE_CLOSURE_LISTING_DIGEST')

  const proof = { client, context: release, signal, proveSaleSource: true, proveSaleCustody: true, proveSaleCleanup: true }
  let sale: Awaited<ReturnType<typeof readNativeSaleFinalized>>
  if (portable) {
    check(portable.plan.offerId === offerId, 'NATIVE_SELLER_SETTLEMENT_WRONG_OFFER')
    sale = await readNativeSaleFinalized({ ...proof, packet: portable.packet, buyer: portable.plan.buyer, plan: portable.plan })
  } else {
    // Listing finality already checks the full mainnet genesis. Recheck it
    // before accepting another transaction envelope from the transport.
    const service = await profileReadStep(signal, () => client.ledgerService.getServiceInfo({}, { abort: signal }))
    check(service.response.chainId === MAINNET_GENESIS_DIGEST, 'NATIVE_CLOSURE_CHAIN')
    const closing = await readNativeSaleClosingPacket(client, digest, signal)
    if (!closing) return { status: 'MISSING' as const, stage: 'CLOSURE' as const, digest }
    const { packet, ptb, tx } = closing
    const call = ptb.commands.length === 1 ? ptb.commands[0].MoveCall : null
    if (call?.package === target.native.callablePackageId && call.module === 'market' && call.function === 'cancel') {
      const cancel = await readNativeSaleCancellationHistory({ client, native: target.native, custody: target.custody!,
        packet, intent: { offerId, soulId, seller: intent.seller, kioskId: listingPlan.kioskId, accountId: intent.accountId }, signal })
      if (cancel.status !== 'CANCELLATION_CONFIRMED') return { status: cancel.status, stage: 'CLOSURE' as const, digest }
      check(BigInt(cancel.checkpoint) >= BigInt(created.checkpoint) && cancel.receipt.offerContext.configId === target.configId
        && cancel.receipt.offerContext.registryId === target.registryId, 'NATIVE_CLOSURE_CANCEL_SCOPE')
      assertNativeSaleListingConsumed(created.receipt, cancel.receipt.listingExit, 'NATIVE_CLOSURE_CANCEL_INPUT')
      assertPointer(cancel.receipt.listingExit.offerOutput)
      return { status: 'CANCELLATION_CONFIRMED' as const, offerId, digest, checkpoint: cancel.checkpoint }
    }
    check(tx.sender !== intent.seller, 'NATIVE_CLOSURE_BUYER')
    const derived = decodeNativeSaleClosingPurchase(closing, { soulId, offerId, callablePackageId: target.native.callablePackageId,
      coinType: economics.coinType, registryId: target.registryId, configId: target.configId, policyId: intent.policyId,
      sellerKioskId: listingPlan.kioskId, collectionId: intent.collectionId })
    sale = await readNativeSaleFinalized({ ...proof, packet, buyer: tx.sender, plan: (ctx, total) => derived.proveFunding(client, ctx, total) })
  }
  if (sale.status !== 'SETTLEMENT_CONFIRMED') return { status: sale.status, stage: portable ? 'PURCHASE' as const : 'CLOSURE' as const, digest }
  const { money, custody, cleanup, listingExit, effectsReconciliation } = sale.receipt
  check(BigInt(sale.checkpoint) >= BigInt(created.checkpoint) && money.seller === intent.seller
    && custody?.transactionDigest === digest && custody.soulId === soulId && cleanup
    && money.sourceBinding?.soulBinding?.soulId === soulId && !money.requiresOriginalSourceBindingProof
    && effectsReconciliation.status === 'OBJECT_EFFECTS_ACCOUNTED', 'NATIVE_SELLER_SETTLEMENT_EFFECTS')
  if (intent.collectionId) {
    const binding = money.reciprocalCollection
    check(binding?.collectionId === intent.collectionId && binding.soulId === soulId, 'NATIVE_SELLER_SETTLEMENT_COLLECTION')
  }
  assertNativeSaleListingConsumed(created.receipt, listingExit, 'NATIVE_SELLER_SETTLEMENT_LISTING_INPUT')
  assertPointer(listingExit.offerOutput)
  return { status: 'SETTLEMENT_CONFIRMED' as const, listingDigest: listingPacket.digest, purchaseDigest: digest,
    checkpoint: sale.checkpoint, offerId, buyer: money.buyer, seller: money.seller, creator: money.creator,
    collectionHolder: money.collectionHolder, coinType: money.coinType, total: money.buyerGrossDebit, buyerNet: money.buyerNetBusinessDebit,
    sellerAmount: String(money.quote.ask), creatorRoyalty: String(money.quote.creator), collectionRoyalty: String(money.quote.collection),
    sellerReceived: String(money.payouts.reduce((sum, row) => sum + (row.owner === money.seller ? BigInt(row.amount) : 0n), 0n)),
    protocolIncome: money.protocolIncome, payouts: money.payouts, gasMist: money.gas.netGasCharge }

  function assertPointer(actual: NonNullable<typeof offerPointer>) {
    check(offerPointer === undefined || canonical(actual) === canonical(offerPointer), 'NATIVE_CLOSURE_OFFER_OUTPUT')
  }
}
