import { OnChainVerificationError } from './queries'

/** Native Maker resale deducts independently floored royalties from one gross
 * USDC price. These are Core's current rights bounds, not historical V5 limits. */
export function quoteAnimacraftV8SoulSale(priceAtomic: bigint, rates: {
  soulCreatorRoyaltyBps: number; makerSourceRoyaltyBps: number
}) {
  const { soulCreatorRoyaltyBps, makerSourceRoyaltyBps } = rates
  if (typeof priceAtomic !== 'bigint' || priceAtomic <= 0n || priceAtomic > (1n << 64n) - 1n
    || [soulCreatorRoyaltyBps, makerSourceRoyaltyBps].some(rate => !Number.isInteger(rate)
      || rate < 0 || rate > 1000 || rate % 50 !== 0)
    || soulCreatorRoyaltyBps + makerSourceRoyaltyBps > 1000) {
    throw new OnChainVerificationError('Native purchase price or royalty rates are invalid')
  }
  const floor = (rate: number) => priceAtomic * BigInt(rate) / 10000n
  const protocolFeeAtomic = floor(250)
  const soulCreatorRoyaltyAtomic = floor(soulCreatorRoyaltyBps)
  const makerSourceRoyaltyAtomic = floor(makerSourceRoyaltyBps)
  return { priceAtomic, totalAtomic: priceAtomic, protocolFeeAtomic,
    soulCreatorRoyaltyBps, soulCreatorRoyaltyAtomic, makerSourceRoyaltyBps, makerSourceRoyaltyAtomic,
    sellerPayoutAtomic: priceAtomic - protocolFeeAtomic - soulCreatorRoyaltyAtomic - makerSourceRoyaltyAtomic }
}
