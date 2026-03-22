import { describe, expect, it } from 'vitest'

import { resolveSuiNetwork } from '../../web/lib/sui-network.ts'

describe('resolveSuiNetwork', () => {
  it('accepts the supported network names', () => {
    expect(resolveSuiNetwork('testnet')).toBe('testnet')
    expect(resolveSuiNetwork('mainnet')).toBe('mainnet')
  })

  it('falls back to testnet for unexpected values', () => {
    expect(resolveSuiNetwork('devnet')).toBe('testnet')
    expect(resolveSuiNetwork('')).toBe('testnet')
    expect(resolveSuiNetwork(undefined)).toBe('testnet')
  })
})
