import { describe, expect, it } from 'vitest'

import {
  parseSoulPaymentAmountToAtomic,
} from '../../web/lib/souls/pricing-input.ts'

describe('parseSoulPaymentAmountToAtomic', () => {
  it('parses large decimal strings without losing precision through Number()', () => {
    expect(parseSoulPaymentAmountToAtomic('9007199254740.993001')).toBe(9_007_199_254_740_993_001n)
  })

  it('rejects zero, negative, and overly precise price strings', () => {
    expect(parseSoulPaymentAmountToAtomic('0')).toBeNull()
    expect(parseSoulPaymentAmountToAtomic('-1')).toBeNull()
    expect(parseSoulPaymentAmountToAtomic('1.1234567')).toBeNull()
  })

  it('accepts the smallest positive 6-decimal payment amount', () => {
    expect(parseSoulPaymentAmountToAtomic('0.000001')).toBe(1n)
  })
})
