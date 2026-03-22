import { describe, expect, it } from 'vitest'

import { sameSuiValue } from '../../web/lib/souls/on-chain-verification.ts'

describe('sameSuiValue', () => {
  it('treats short-form and canonical Sui values as equal', () => {
    expect(sameSuiValue('0xabc', `0x${'0'.repeat(61)}abc`)).toBe(true)
  })

  it('does not consider malformed Sui values equal just because their lowercase strings match', () => {
    expect(sameSuiValue('not-an-address', 'not-an-address')).toBe(false)
  })
})
