import { describe, expect, it } from 'vitest'

describe('agent purchase funding helpers', () => {
  it('computes the required balance from quoted price, fees, and gas reserve', async () => {
    const { PURCHASE_GAS_BUDGET_BUFFER_MIST, getRequiredSoulPurchaseFunding } = await import('../../web/lib/souls/e2e-agent-purchase.ts')

    expect(PURCHASE_GAS_BUDGET_BUFFER_MIST).toBe(50_000_000n)
    expect(getRequiredSoulPurchaseFunding({
      listingStatus: 'listed',
      listedPriceSui: '1000000000',
      quotedPriceSui: '1250000000',
      purchaseFeeAmountSui: '75000000',
    })).toEqual({
      priceSui: 1_250_000_000n,
      feeAmountSui: 75_000_000n,
      requiredBalanceMist: 1_375_000_000n,
    })
  })

  it('falls back to the listed price when the detail route has no separate quoted price', async () => {
    const { getRequiredSoulPurchaseFunding } = await import('../../web/lib/souls/e2e-agent-purchase.ts')

    expect(getRequiredSoulPurchaseFunding({
      listingStatus: 'listed',
      listedPriceSui: '1000000000',
      quotedPriceSui: null,
      purchaseFeeAmountSui: '75000000',
    })).toEqual({
      priceSui: 1_000_000_000n,
      feeAmountSui: 75_000_000n,
      requiredBalanceMist: 1_125_000_000n,
    })
  })

  it('only tops up the missing delta when the agent already holds part of the required balance', async () => {
    const { getRequiredSoulPurchaseTopUpAmount } = await import('../../web/lib/souls/e2e-agent-purchase.ts')

    expect(getRequiredSoulPurchaseTopUpAmount({
      requiredBalanceMist: 1_125_000_000n,
      currentBalanceMist: 80_000_000n,
    })).toBe(1_045_000_000n)

    expect(getRequiredSoulPurchaseTopUpAmount({
      requiredBalanceMist: 1_125_000_000n,
      currentBalanceMist: 1_200_000_000n,
    })).toBe(0n)
  })
})
