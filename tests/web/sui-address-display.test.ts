import { describe, expect, it } from 'vitest'

import { formatSuiAddressDisplay } from '../../web/lib/auth/sui-address-display.ts'

describe('formatSuiAddressDisplay', () => {
  it('shortens long Sui addresses for compact UI surfaces', () => {
    expect(formatSuiAddressDisplay(`0x${'a'.repeat(64)}`)).toBe(`0xaaaa...aaaa`)
  })

  it('returns null for empty addresses', () => {
    expect(formatSuiAddressDisplay('')).toBeNull()
  })

  it('keeps short values intact', () => {
    expect(formatSuiAddressDisplay('0xabc123')).toBe('0xabc123')
  })
})
