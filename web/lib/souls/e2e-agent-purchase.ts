export const PURCHASE_GAS_BUDGET_BUFFER_MIST = 50_000_000n

interface SoulPurchaseDetailLike {
  listingStatus?: string | null
  listedPriceSui?: string | null
  quotedPriceSui?: string | null
  purchaseFeeAmountSui?: string | null
}

export function getRequiredSoulPurchaseFunding(detail: SoulPurchaseDetailLike) {
  if (detail.listingStatus !== 'listed') {
    throw new Error('Soul is not currently listed for sale')
  }

  const priceRaw = detail.quotedPriceSui ?? detail.listedPriceSui
  if (!priceRaw) {
    throw new Error('Soul purchase quote is unavailable')
  }
  if (detail.purchaseFeeAmountSui == null) {
    throw new Error('Soul purchase fee quote is unavailable')
  }

  const priceSui = BigInt(priceRaw)
  const feeAmountSui = BigInt(detail.purchaseFeeAmountSui)

  return {
    priceSui,
    feeAmountSui,
    requiredBalanceMist: priceSui + feeAmountSui + PURCHASE_GAS_BUDGET_BUFFER_MIST,
  }
}

export function getRequiredSoulPurchaseTopUpAmount(params: {
  requiredBalanceMist: bigint
  currentBalanceMist: bigint
}) {
  const missingBalance = params.requiredBalanceMist - params.currentBalanceMist
  return missingBalance > 0n ? missingBalance : 0n
}
