import { describe, expect, it } from 'vitest'

import { parseSuiTimestampMs } from '../../web/lib/services/sui-indexer-utils.ts'

describe('Sui indexer timestamp parsing', () => {
  it('rejects empty and non-numeric timestamps instead of coercing them to the Unix epoch', () => {
    expect(() => parseSuiTimestampMs('', 'expires_at')).toThrow('Invalid expires_at timestamp: ')
    expect(() => parseSuiTimestampMs('not-a-number', 'expires_at')).toThrow(
      'Invalid expires_at timestamp: not-a-number',
    )
  })

  it('parses positive millisecond timestamps into Date objects', () => {
    expect(parseSuiTimestampMs('1710000000000', 'expires_at').toISOString()).toBe(
      '2024-03-09T16:00:00.000Z',
    )
  })
})
