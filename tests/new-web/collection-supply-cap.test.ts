import { describe, expect, it } from 'vitest'
import { MAX_COLLECTION_SUPPLY } from '../../web/lib/soulidity/tx/shared'
import { parseCollectionSupplyCapInput } from '../../web/lib/collections/supply-cap'

describe('parseCollectionSupplyCapInput', () => {
  it('parses decimal and scientific notation consistently', () => {
    expect(parseCollectionSupplyCapInput('1000')).toBe(1000)
    expect(parseCollectionSupplyCapInput('1e3')).toBe(1000)
  })

  it('rejects empty, fractional, zero, and over-soft-cap values', () => {
    expect(() => parseCollectionSupplyCapInput('')).toThrow('Required')
    expect(() => parseCollectionSupplyCapInput('1.5')).toThrow('Must be an integer')
    expect(() => parseCollectionSupplyCapInput('0')).toThrow('Must be an integer')
    expect(() => parseCollectionSupplyCapInput(String(MAX_COLLECTION_SUPPLY + 1))).toThrow('Must be an integer')
  })
})
