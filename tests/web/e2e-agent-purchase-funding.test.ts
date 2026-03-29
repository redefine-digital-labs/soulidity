import { describe, expect, it } from 'vitest'

describe('agent purchase funding helpers', () => {
  it('computes the required payment amount and gas reserve from the purchase quote', async () => {
    const { PURCHASE_GAS_BUDGET_BUFFER_MIST, getRequiredSoulPurchaseFunding } = await import('../../web/lib/souls/e2e-agent-purchase.ts')

    expect(PURCHASE_GAS_BUDGET_BUFFER_MIST).toBe(50_000_000n)
    expect(getRequiredSoulPurchaseFunding({
      listingStatus: 'listed',
      listedPriceAtomic: '1000000',
      quotedPriceAtomic: '1250000',
      purchasePlatformFeeAtomic: '50000',
      purchaseCreatorRoyaltyAtomic: '25000',
    })).toEqual({
      priceAtomic: 1_250_000n,
      platformFeeAtomic: 50_000n,
      creatorRoyaltyAtomic: 25_000n,
      paymentTotalAtomic: 1_325_000n,
      requiredGasBalanceMist: 50_000_000n,
    })
  })

  it('falls back to the listed price when the detail route has no separate quoted price', async () => {
    const { getRequiredSoulPurchaseFunding } = await import('../../web/lib/souls/e2e-agent-purchase.ts')

    expect(getRequiredSoulPurchaseFunding({
      listingStatus: 'listed',
      listedPriceAtomic: '1000000',
      quotedPriceAtomic: null,
      purchasePlatformFeeAtomic: '50000',
      purchaseCreatorRoyaltyAtomic: '25000',
    })).toEqual({
      priceAtomic: 1_000_000n,
      platformFeeAtomic: 50_000n,
      creatorRoyaltyAtomic: 25_000n,
      paymentTotalAtomic: 1_075_000n,
      requiredGasBalanceMist: 50_000_000n,
    })
  })

  it('only tops up the missing delta when the agent already holds part of the required balance', async () => {
    const { getRequiredSoulPurchaseTopUpAmount } = await import('../../web/lib/souls/e2e-agent-purchase.ts')

    expect(getRequiredSoulPurchaseTopUpAmount({
      requiredGasBalanceMist: 50_000_000n,
      currentBalanceMist: 80_000_000n,
    })).toBe(0n)

    expect(getRequiredSoulPurchaseTopUpAmount({
      requiredGasBalanceMist: 50_000_000n,
      currentBalanceMist: 10_000_000n,
    })).toBe(40_000_000n)

    expect(getRequiredSoulPurchaseTopUpAmount({
      requiredGasBalanceMist: 50_000_000n,
      currentBalanceMist: 1_200_000_000n,
    })).toBe(0n)
  })
})
