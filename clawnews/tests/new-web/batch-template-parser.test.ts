import { describe, expect, it } from 'vitest'

import { normalizeBatchTemplateRows } from '../../web/lib/collections/batch-template'

describe('normalizeBatchTemplateRows', () => {
  it('parses valid rows and normalizes tags/royalty', () => {
    const result = normalizeBatchTemplateRows([
      {
        'Soul Name': 'AlphaScout',
        Description: 'Tracks new Sui pools',
        Tags: 'ai, trading,  defi ',
        'Creator Royalty (%)': '5',
      },
    ], 300)

    expect(result.errors).toEqual([])
    expect(result.souls).toEqual([
      {
        name: 'AlphaScout',
        description: 'Tracks new Sui pools',
        tags: ['ai', 'trading', 'defi'],
        creatorRoyaltyBps: 500,
      },
    ])
  })

  it('uses default royalty when column is missing', () => {
    const result = normalizeBatchTemplateRows([
      {
        'Soul Name': 'AlphaScout',
        Description: 'Tracks new Sui pools',
        Tags: 'ai',
      },
    ], 300)

    expect(result.errors).toEqual([])
    expect(result.souls[0].creatorRoyaltyBps).toBe(300)
  })

  it('allows an initial batch smaller than the collection supply cap', () => {
    const result = normalizeBatchTemplateRows([
      {
        'Soul Name': 'AlphaScout',
        Description: 'Tracks new Sui pools',
      },
    ], 300, 2)

    expect(result.souls).toHaveLength(1)
    expect(result.errors).toEqual([])
  })

  it('rejects a template that exceeds the collection supply cap', () => {
    const result = normalizeBatchTemplateRows([
      {
        'Soul Name': 'AlphaScout',
        Description: 'Tracks new Sui pools',
      },
      {
        'Soul Name': 'BetaScout',
        Description: 'Tracks Sui launch events',
      },
    ], 300, 1)

    expect(result.souls).toHaveLength(2)
    expect(result.errors).toContain('Template has 2 Souls but Supply Cap is 1 — remove 1 row(s)')
  })
})
