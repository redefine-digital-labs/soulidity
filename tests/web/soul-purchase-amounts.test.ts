import { describe, expect, it } from 'vitest'
import { parsePurchaseAmounts } from '../../web/lib/souls/purchase-amounts.ts'

describe('parsePurchaseAmounts', () => {
  it('parses quoted price and fee breakdowns into atomic payment totals', () => {
    expect(parsePurchaseAmounts({
      listedPriceAtomic: '1000',
      quotedPriceAtomic: '1200',
      purchasePlatformFeeAtomic: '30',
      purchaseCreatorRoyaltyAtomic: '5',
    })).toEqual({
      priceAtomic: 1200n,
      platformFeeAtomic: 30n,
      creatorRoyaltyAtomic: 5n,
      totalAtomic: 1235n,
    })
  })

  it('returns null for malformed amounts instead of throwing', () => {
    expect(parsePurchaseAmounts({
      listedPriceAtomic: 'not-a-number',
      purchasePlatformFeeAtomic: '30',
      purchaseCreatorRoyaltyAtomic: '5',
    })).toBeNull()
  })

  it('returns null for zero-priced purchases', () => {
    expect(parsePurchaseAmounts({
      listedPriceAtomic: '0',
      purchasePlatformFeeAtomic: '30',
      purchaseCreatorRoyaltyAtomic: '5',
    })).toBeNull()
  })

  it('returns null for negative listed prices', () => {
    expect(parsePurchaseAmounts({
      listedPriceAtomic: '-1',
      purchasePlatformFeeAtomic: '30',
      purchaseCreatorRoyaltyAtomic: '5',
    })).toBeNull()
  })

  it('returns null for negative fee components', () => {
    expect(parsePurchaseAmounts({
      listedPriceAtomic: '1000',
      purchasePlatformFeeAtomic: '-1',
      purchaseCreatorRoyaltyAtomic: '5',
    })).toBeNull()

    expect(parsePurchaseAmounts({
      listedPriceAtomic: '1000',
      purchasePlatformFeeAtomic: '30',
      purchaseCreatorRoyaltyAtomic: '-1',
    })).toBeNull()
  })

  it('falls back to the listed price when quotedPriceAtomic is null', () => {
    expect(parsePurchaseAmounts({
      listedPriceAtomic: '1000',
      quotedPriceAtomic: null,
      purchasePlatformFeeAtomic: '30',
      purchaseCreatorRoyaltyAtomic: '5',
    })).toEqual({
      priceAtomic: 1000n,
      platformFeeAtomic: 30n,
      creatorRoyaltyAtomic: 5n,
      totalAtomic: 1035n,
    })
  })

  it('returns null when a quoted price is present but zero', () => {
    expect(parsePurchaseAmounts({
      listedPriceAtomic: '1000',
      quotedPriceAtomic: '0',
      purchasePlatformFeeAtomic: '30',
      purchaseCreatorRoyaltyAtomic: '5',
    })).toBeNull()
  })

  it('returns null when quotedPriceAtomic is malformed', () => {
    expect(parsePurchaseAmounts({
      listedPriceAtomic: '1000',
      quotedPriceAtomic: 'oops',
      purchasePlatformFeeAtomic: '30',
      purchaseCreatorRoyaltyAtomic: '5',
    })).toBeNull()
  })

  it('returns null when the parsed purchase price exceeds the u64 range', () => {
    expect(parsePurchaseAmounts({
      listedPriceAtomic: '1000',
      quotedPriceAtomic: '18446744073709551616',
      purchasePlatformFeeAtomic: '30',
      purchaseCreatorRoyaltyAtomic: '5',
    })).toBeNull()
  })

  it('returns null when a parsed fee component exceeds the u64 range', () => {
    expect(parsePurchaseAmounts({
      listedPriceAtomic: '1000',
      purchasePlatformFeeAtomic: '18446744073709551616',
      purchaseCreatorRoyaltyAtomic: '5',
    })).toBeNull()
  })

  it('returns null when the supplied total does not match the fee breakdown', () => {
    expect(parsePurchaseAmounts({
      listedPriceAtomic: '1000',
      purchasePlatformFeeAtomic: '30',
      purchaseCreatorRoyaltyAtomic: '5',
      purchaseTotalAtomic: '9999',
    })).toBeNull()
  })

  it('returns null when price plus fee exceeds the u64 range', () => {
    expect(parsePurchaseAmounts({
      listedPriceAtomic: '18446744073709551615',
      purchasePlatformFeeAtomic: '1',
      purchaseCreatorRoyaltyAtomic: '0',
    })).toBeNull()
  })
})
