export interface ParsedPurchaseAmounts {
  priceAtomic: bigint
  platformFeeAtomic: bigint
  creatorRoyaltyAtomic: bigint
  totalAtomic: bigint
}

const MAX_U64 = (2n ** 64n) - 1n

export function parsePurchaseAmounts(params: {
  listedPriceAtomic: string
  purchasePlatformFeeAtomic: string
  purchaseCreatorRoyaltyAtomic: string
  purchaseTotalAtomic?: string | null
  quotedPriceAtomic?: string | null
}): ParsedPurchaseAmounts | null {
  try {
    const priceAtomic = BigInt(params.quotedPriceAtomic ?? params.listedPriceAtomic)
    const platformFeeAtomic = BigInt(params.purchasePlatformFeeAtomic)
    const creatorRoyaltyAtomic = BigInt(params.purchaseCreatorRoyaltyAtomic)
    const totalAtomic = params.purchaseTotalAtomic == null
      ? priceAtomic + platformFeeAtomic + creatorRoyaltyAtomic
      : BigInt(params.purchaseTotalAtomic)
    if (
      priceAtomic <= 0n
      || priceAtomic > MAX_U64
      || platformFeeAtomic < 0n
      || platformFeeAtomic > MAX_U64
      || creatorRoyaltyAtomic < 0n
      || creatorRoyaltyAtomic > MAX_U64
      || totalAtomic <= 0n
      || totalAtomic > MAX_U64
    ) {
      return null
    }
    if (totalAtomic !== priceAtomic + platformFeeAtomic + creatorRoyaltyAtomic) {
      return null
    }
    return {
      priceAtomic,
      platformFeeAtomic,
      creatorRoyaltyAtomic,
      totalAtomic,
    }
  } catch {
    return null
  }
}
