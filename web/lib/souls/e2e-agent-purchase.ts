export const PURCHASE_GAS_BUDGET_BUFFER_MIST = 50_000_000n

interface SoulPurchaseDetailLike {
  listingStatus?: string | null
  listedPriceAtomic?: string | null
  quotedPriceAtomic?: string | null
  purchasePlatformFeeAtomic?: string | null
  purchaseCreatorRoyaltyAtomic?: string | null
  purchaseTotalAtomic?: string | null
}

export function getRequiredSoulPurchaseFunding(detail: SoulPurchaseDetailLike) {
  if (detail.listingStatus !== 'listed') {
    throw new Error('Soul is not currently listed for sale')
  }

  const priceRaw = detail.quotedPriceAtomic ?? detail.listedPriceAtomic
  if (!priceRaw || detail.purchasePlatformFeeAtomic == null || detail.purchaseCreatorRoyaltyAtomic == null) {
    throw new Error('Soul purchase quote is unavailable')
  }

  const priceAtomic = BigInt(priceRaw)
  const platformFeeAtomic = BigInt(detail.purchasePlatformFeeAtomic)
  const creatorRoyaltyAtomic = BigInt(detail.purchaseCreatorRoyaltyAtomic)
  const paymentTotalAtomic = detail.purchaseTotalAtomic == null
    ? priceAtomic + platformFeeAtomic + creatorRoyaltyAtomic
    : BigInt(detail.purchaseTotalAtomic)

  return {
    priceAtomic,
    platformFeeAtomic,
    creatorRoyaltyAtomic,
    paymentTotalAtomic,
    requiredGasBalanceMist: PURCHASE_GAS_BUDGET_BUFFER_MIST,
  }
}

export function getRequiredSoulPurchaseTopUpAmount(params: {
  requiredGasBalanceMist: bigint
  currentBalanceMist: bigint
}) {
  const missingBalance = params.requiredGasBalanceMist - params.currentBalanceMist
  return missingBalance > 0n ? missingBalance : 0n
}
