import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { marketListDigest } from '../../animacraft/market-list-operation'
import { publicMutationCanonical as canonical } from '../../sui/public-mutation-journal'
import { parseCanonicalNativeWorkbenchTarget } from '../canonical-native-workbench'
import { soulAccessExact } from '../soul-access-plan'
import { commerceCheck, commerceId } from './economics-read'
import { parseIncomeObservationTarget } from './income-source-qualification'
import { readNativeSaleCancellationByDigest } from './native-sale-cancellation'
import { assertNativeSaleListingConsumed, readNativeSaleRelistByDigest } from './native-sale-relist'
import { parsePurchaseRecoveryOriginal, queryPurchaseRecoveryOriginal } from './purchase-recovery-original'

/** Compose reviewed originals only. The final buyer's actual use and current
 * authority remain separate observations for the two-wallet run. */
export async function verifyNativeSaleLifecycle({ client, review, purchaseText, signal }: {
  client: SuiGrpcClient; review: unknown; purchaseText: string; signal: AbortSignal
}) {
  soulAccessExact(review, ['schema', 'soulId', 'seller', 'buyer', 'cancelledOfferId', 'purchasedOfferId',
    'cancelDigest', 'relistDigest', 'purchaseDigest', 'target', 'economics', 'collection'])
  const { soulId, seller, buyer, cancelledOfferId, purchasedOfferId, cancelDigest, relistDigest, purchaseDigest } = review
  commerceCheck(review.schema === 'soulidity.commerce.native-sale-lifecycle-case.v1'
    && typeof soulId === 'string' && commerceId(soulId) && typeof seller === 'string' && commerceId(seller)
    && typeof buyer === 'string' && commerceId(buyer) && buyer !== seller
    && typeof cancelledOfferId === 'string' && commerceId(cancelledOfferId)
    && typeof purchasedOfferId === 'string' && commerceId(purchasedOfferId) && cancelledOfferId !== purchasedOfferId
    && typeof cancelDigest === 'string' && marketListDigest(cancelDigest)
    && typeof relistDigest === 'string' && marketListDigest(relistDigest) && marketListDigest(purchaseDigest)
    && new Set([cancelDigest, relistDigest, purchaseDigest]).size === 3, 'NATIVE_SALE_LIFECYCLE_CASE')
  const target = parseCanonicalNativeWorkbenchTarget(review.target), economics = parseIncomeObservationTarget(review.economics)
  commerceCheck(target.custody && target.content && target.configId === economics.configId, 'NATIVE_SALE_LIFECYCLE_TARGET')
  const original = await parsePurchaseRecoveryOriginal(purchaseText, soulId)
  commerceCheck(original.kind === 'native-sale-preparation.v1', 'NATIVE_SALE_LIFECYCLE_ORIGINAL')
  const { plan, packet, context } = original.value
  commerceCheck(!plan.collectionId || context.collection, 'NATIVE_SALE_LIFECYCLE_COLLECTION_PIN')
  commerceCheck(packet.digest === purchaseDigest && plan.offerId === purchasedOfferId && plan.buyer === buyer
    && canonical(context.target) === canonical(target) && canonical(context.economics) === canonical(economics)
    && canonical(context.collection) === canonical(review.collection), 'NATIVE_SALE_LIFECYCLE_ORIGINAL_MISMATCH')

  const cancel = await readNativeSaleCancellationByDigest({ client, native: target.native, custody: target.custody, soulId, digest: cancelDigest, signal })
  if (cancel.status !== 'CANCELLATION_CONFIRMED') return { status: 'NATIVE_SALE_LIFECYCLE_PENDING' as const, stage: 'CANCEL' as const, cancelDigest, cancel }
  const { receipt: cancelled, sellerKioskOutput, accountId, offerContext } = cancel.receipt
  commerceCheck(cancelled.offer === cancelledOfferId && cancelled.root === soulId && cancelled.seller === seller
    && sellerKioskOutput.objectId === plan.sellerKioskId
    && offerContext.configId === plan.configId && offerContext.registryId === plan.registryId, 'NATIVE_SALE_LIFECYCLE_CANCEL_MISMATCH')
  const relist = await readNativeSaleRelistByDigest({ client, native: target.native, plan, seller, sellerAccountId: accountId,
    digest: relistDigest, signal })
  if (relist.status !== 'RELIST_CONFIRMED') return { status: 'NATIVE_SALE_LIFECYCLE_PENDING' as const, stage: 'RELIST' as const, cancelDigest, cancel, relistDigest, relist }
  const kiosk = relist.receipt.sellerKioskInput
  const sameVersion = kiosk.version === sellerKioskOutput.version
  commerceCheck(BigInt(relist.checkpoint) >= BigInt(cancel.checkpoint) && BigInt(kiosk.version) >= BigInt(sellerKioskOutput.version)
    && kiosk.initialSharedVersion === sellerKioskOutput.initialSharedVersion
    && sameVersion === (kiosk.digest === sellerKioskOutput.digest)
    && (kiosk.writer === cancelDigest) === sameVersion, 'NATIVE_SALE_LIFECYCLE_CANCEL_RELIST_ORDER')

  const purchase = await queryPurchaseRecoveryOriginal({ text: purchaseText, soulId, client, signal,
    proveSaleSource: true, proveSaleCustody: true, proveSaleCleanup: true })
  commerceCheck(purchase.kind === 'native-sale-preparation.v1', 'NATIVE_SALE_LIFECYCLE_ORIGINAL')
  const sale = purchase.history
  if (sale.status !== 'SETTLEMENT_CONFIRMED') return { status: 'NATIVE_SALE_LIFECYCLE_PENDING' as const, stage: 'PURCHASE' as const,
    cancelDigest, cancel, relistDigest, relist, purchaseDigest, sale }
  const { money, custody, cleanup, listingExit, effectsReconciliation } = sale.receipt
  commerceCheck(BigInt(sale.checkpoint) >= BigInt(relist.checkpoint) && money.seller === seller && custody && cleanup
    && money.sourceBinding?.soulBinding?.soulId === soulId && !money.requiresOriginalSourceBindingProof
    && effectsReconciliation.status === 'OBJECT_EFFECTS_ACCOUNTED', 'NATIVE_SALE_LIFECYCLE_PURCHASE')
  if (plan.collectionId) {
    const binding = money.reciprocalCollection
    commerceCheck(binding?.collectionId === plan.collectionId && binding.soulId === soulId, 'NATIVE_SALE_LIFECYCLE_COLLECTION_BINDING')
  }
  assertNativeSaleListingConsumed(relist.receipt, listingExit, 'NATIVE_SALE_LIFECYCLE_RELIST_INPUT_MISMATCH')

  return { status: 'NATIVE_SALE_LIFECYCLE_CONFIRMED' as const, soulId, seller, buyer,
    cancelDigest, cancel, relistDigest, relist, purchaseDigest, sale, currentWalletUseRequired: true as const }
}
