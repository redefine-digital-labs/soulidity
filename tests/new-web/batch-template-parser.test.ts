import { describe, expect, it } from 'vitest'

import { normalizeBatchTemplateRows } from '../../web/lib/collections/batch-template'

describe('normalizeBatchTemplateRows', () => {
  it('parses valid rows and normalizes tags/royalty', () => {
    const result = normalizeBatchTemplateRows([
      {
        'Soul Name': 'AlphaScout',
        Description: 'Tracks new Sui pools',
        Category: 'Trading',
        Tags: 'ai, trading,  defi ',
        'Creator Royalty (%)': '5',
      },
    ], 300)

    expect(result.errors).toEqual([])
    expect(result.souls).toEqual([
      {
        name: 'AlphaScout',
        description: 'Tracks new Sui pools',
        category: 'Trading',
        tags: ['ai', 'trading', 'defi'],
        creatorRoyaltyBps: 500,
      },
    ])
  })

  it('adds a supply-cap mismatch error without dropping parsed rows', () => {
    const result = normalizeBatchTemplateRows([
      {
        'Soul Name': 'AlphaScout',
        Description: 'Tracks new Sui pools',
        Category: 'Trading',
      },
    ], 300, 2)

    expect(result.souls).toHaveLength(1)
    expect(result.errors).toContain('Template has 1 Soul(s) but Supply Cap is 2 — add 1 more row(s) or adjust the Supply Cap in Step 1')
  })
})
