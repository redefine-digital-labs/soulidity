import { Prisma } from '../../web/generated/prisma/client'
import { describe, expect, it } from 'vitest'

import {
  formatAtomicSoulPaymentForDisplay,
  parseAtomicAmountString,
  serializeAtomicAmount,
} from '../../web/lib/souls/price-format.ts'

describe('serializeAtomicAmount', () => {
  it('serializes Prisma Decimal values losslessly for API responses', () => {
    expect(serializeAtomicAmount(new Prisma.Decimal('18446744073709551615'))).toBe('18446744073709551615')
  })

  it('returns null for nullish values', () => {
    expect(serializeAtomicAmount(null)).toBeNull()
  })
})

describe('parseAtomicAmountString', () => {
  it('parses canonical atomic strings into bigint', () => {
    expect(parseAtomicAmountString('1000000')).toBe(1_000_000n)
  })

  it('rejects malformed atomic strings', () => {
    expect(() => parseAtomicAmountString('1.5')).toThrow('Atomic amount must be an unsigned integer string')
    expect(() => parseAtomicAmountString('-1')).toThrow('Atomic amount must be an unsigned integer string')
  })
})

describe('formatAtomicSoulPaymentForDisplay', () => {
  it('formats whole and fractional USDC values without trailing zeros', () => {
    expect(formatAtomicSoulPaymentForDisplay('2500000')).toBe('2.5 USDC')
    expect(formatAtomicSoulPaymentForDisplay('1000000')).toBe('1 USDC')
  })

  it('preserves up to six fractional decimals when needed', () => {
    expect(formatAtomicSoulPaymentForDisplay('1000001')).toBe('1.000001 USDC')
    expect(formatAtomicSoulPaymentForDisplay('123456')).toBe('0.123456 USDC')
  })
})
