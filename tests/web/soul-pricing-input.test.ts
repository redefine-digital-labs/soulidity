import { describe, expect, it } from 'vitest'

import {
  parseSuiPriceToMist,
} from '../../web/lib/souls/pricing-input.ts'

describe('parseSuiPriceToMist', () => {
  it('parses large decimal strings without losing precision through Number()', () => {
    expect(parseSuiPriceToMist('9007199254740.993001')).toBe(9_007_199_254_740_993_001_000n)
  })

  it('rejects zero, negative, and overly precise price strings', () => {
    expect(parseSuiPriceToMist('0')).toBeNull()
    expect(parseSuiPriceToMist('-1')).toBeNull()
    expect(parseSuiPriceToMist('1.1234567891')).toBeNull()
  })

  it('rejects values below the supported 0.001 SUI floor', () => {
    expect(parseSuiPriceToMist('0.000000001')).toBeNull()
    expect(parseSuiPriceToMist('0.000999999')).toBeNull()
    expect(parseSuiPriceToMist('0.001')).toBe(1_000_000n)
  })
})
