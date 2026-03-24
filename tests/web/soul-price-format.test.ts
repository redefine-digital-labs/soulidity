import { Prisma } from '../../generated/prisma/client'
import { describe, expect, it } from 'vitest'

import {
  formatAtomicUsdcForDisplay,
  parseAtomicUsdcString,
  serializeAtomicUsdcAmount,
} from '../../web/lib/souls/price-format.ts'

describe('serializeAtomicUsdcAmount', () => {
  it('serializes Prisma Decimal values losslessly for API responses', () => {
    expect(serializeAtomicUsdcAmount(new Prisma.Decimal('18446744073709551615'))).toBe('18446744073709551615')
  })

  it('returns null for nullish values', () => {
    expect(serializeAtomicUsdcAmount(null)).toBeNull()
  })
})

describe('parseAtomicUsdcString', () => {
  it('parses canonical atomic strings into bigint', () => {
    expect(parseAtomicUsdcString('1000000')).toBe(1_000_000n)
  })

  it('rejects malformed atomic strings', () => {
    expect(() => parseAtomicUsdcString('1.5')).toThrow('Atomic USDC amount must be an unsigned integer string')
    expect(() => parseAtomicUsdcString('-1')).toThrow('Atomic USDC amount must be an unsigned integer string')
  })
})

describe('formatAtomicUsdcForDisplay', () => {
  it('keeps two decimals for whole-cent prices', () => {
    expect(formatAtomicUsdcForDisplay('2500000')).toBe('$2.50')
    expect(formatAtomicUsdcForDisplay('1000000')).toBe('$1.00')
  })

  it('preserves sub-cent precision up to six decimals without trailing zeros', () => {
    expect(formatAtomicUsdcForDisplay('1234567')).toBe('$1.234567')
    expect(formatAtomicUsdcForDisplay('1000010')).toBe('$1.00001')
  })
})
