import { Prisma } from '../../generated/prisma/client'
import { describe, expect, it } from 'vitest'

import {
  formatAtomicSuiForDisplay,
  parseMistString,
  serializeAtomicSuiAmount,
} from '../../web/lib/souls/price-format.ts'

describe('serializeAtomicSuiAmount', () => {
  it('serializes Prisma Decimal values losslessly for API responses', () => {
    expect(serializeAtomicSuiAmount(new Prisma.Decimal('18446744073709551615'))).toBe('18446744073709551615')
  })

  it('returns null for nullish values', () => {
    expect(serializeAtomicSuiAmount(null)).toBeNull()
  })
})

describe('parseMistString', () => {
  it('parses canonical atomic strings into bigint', () => {
    expect(parseMistString('1000000000')).toBe(1_000_000_000n)
  })

  it('rejects malformed atomic strings', () => {
    expect(() => parseMistString('1.5')).toThrow('Atomic SUI amount must be an unsigned integer string')
    expect(() => parseMistString('-1')).toThrow('Atomic SUI amount must be an unsigned integer string')
  })
})

describe('formatAtomicSuiForDisplay', () => {
  it('formats whole and fractional SUI values without trailing zeros', () => {
    expect(formatAtomicSuiForDisplay('2500000000')).toBe('2.5 SUI')
    expect(formatAtomicSuiForDisplay('1000000000')).toBe('1 SUI')
  })

  it('preserves up to nine fractional decimals when needed', () => {
    expect(formatAtomicSuiForDisplay('1000000010')).toBe('1.00000001 SUI')
    expect(formatAtomicSuiForDisplay('123456789')).toBe('0.123456789 SUI')
  })
})
