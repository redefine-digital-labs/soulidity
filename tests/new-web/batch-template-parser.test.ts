import { describe, expect, it } from 'vitest'

import { normalizeBatchTemplateRows } from '../../web/lib/collections/batch-template'

describe('normalizeBatchTemplateRows', () => {
  it('parses valid rows and normalizes tags/royalty/price', () => {
    const result = normalizeBatchTemplateRows([
      {
        'Soul Name': 'AlphaScout',
        Description: 'Tracks new Sui pools',
        Tags: 'ai, trading,  defi ',
        'Creator Royalty (%)': '5',
        'Price USDC': '3',
      },
    ], 300)

    expect(result.errors).toEqual([])
    expect(result.souls).toEqual([
      {
        name: 'AlphaScout',
        description: 'Tracks new Sui pools',
        tags: ['ai', 'trading', 'defi'],
        creatorRoyaltyBps: 500,
        priceUsdc: 3,
      },
    ])
  })

  it('treats missing Price USDC as null', () => {
    const result = normalizeBatchTemplateRows([
      {
        'Soul Name': 'AlphaScout',
        Description: 'Tracks new Sui pools',
        Tags: 'ai',
      },
    ], 300)

    expect(result.errors).toEqual([])
    expect(result.souls[0].priceUsdc).toBeNull()
  })

  it('rejects negative Price USDC values', () => {
    const result = normalizeBatchTemplateRows([
      {
        'Soul Name': 'AlphaScout',
        Description: 'Tracks new Sui pools',
        Tags: 'ai',
        'Price USDC': '-1',
      },
    ], 300)

    expect(result.errors).toContain('Row 2: Price USDC must be a non-negative number')
    expect(result.souls).toHaveLength(0)
  })

  it('adds a supply-cap mismatch error without dropping parsed rows', () => {
    const result = normalizeBatchTemplateRows([
      {
        'Soul Name': 'AlphaScout',
        Description: 'Tracks new Sui pools',
      },
    ], 300, 2)

    expect(result.souls).toHaveLength(1)
    expect(result.errors).toContain('Template has 1 Soul(s) but Supply Cap is 2 — add 1 more row(s) or adjust the Supply Cap in Step 1')
  })
})
