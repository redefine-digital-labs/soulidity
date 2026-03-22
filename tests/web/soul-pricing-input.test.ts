import { describe, expect, it } from 'vitest'

import {
  parseSubscriptionPeriodDaysToMs,
  parseUsdPriceToAtomic,
} from '../../web/lib/souls/pricing-input.ts'

describe('parseUsdPriceToAtomic', () => {
  it('parses large decimal strings without losing precision through Number()', () => {
    expect(parseUsdPriceToAtomic('9007199254740.993001')).toBe(9_007_199_254_740_993_001n)
  })

  it('rejects zero, negative, and overly precise price strings', () => {
    expect(parseUsdPriceToAtomic('0')).toBeNull()
    expect(parseUsdPriceToAtomic('-1')).toBeNull()
    expect(parseUsdPriceToAtomic('1.1234567')).toBeNull()
  })

  it('rejects sub-cent prices below the supported 0.01 USDC floor', () => {
    expect(parseUsdPriceToAtomic('0.000001')).toBeNull()
    expect(parseUsdPriceToAtomic('0.009999')).toBeNull()
    expect(parseUsdPriceToAtomic('0.01')).toBe(10_000n)
  })
})

describe('parseSubscriptionPeriodDaysToMs', () => {
  it('parses whole subscription days into milliseconds', () => {
    expect(parseSubscriptionPeriodDaysToMs('30')).toBe(2_592_000_000n)
  })

  it('rejects zero and non-integer subscription periods', () => {
    expect(parseSubscriptionPeriodDaysToMs('0')).toBeNull()
    expect(parseSubscriptionPeriodDaysToMs('1.5')).toBeNull()
  })
})
