import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@mysten/dapp-kit', () => ({
  useCurrentAccount: vi.fn(),
  useSignPersonalMessage: vi.fn(),
  useSignTransaction: vi.fn(),
  useSuiClient: vi.fn(),
}))

describe('wallet sign transaction result normalization', () => {
  it('rejects missing executeTransactionBlock results before callers read effects', async () => {
    const { normalizeSuiTxResult } = await import('../../web/lib/hooks/use-wallet-sign.ts')

    expect(() => normalizeSuiTxResult(undefined)).toThrow(
      'Wallet transaction execution did not return a transaction result',
    )
  })

  it('rejects executeTransactionBlock results that omit effects despite showEffects', async () => {
    const { normalizeSuiTxResult } = await import('../../web/lib/hooks/use-wallet-sign.ts')

    expect(() => normalizeSuiTxResult({ digest: 'abc' })).toThrow(
      'Wallet transaction execution did not return effects',
    )
  })

  it('normalizes executeTransactionBlock output before waiting on the digest', () => {
    const source = readFileSync('web/lib/hooks/use-wallet-sign.ts', 'utf8')
    const executeCall = source.indexOf('suiClient.executeTransactionBlock({')
    const normalizeCall = source.indexOf('normalizeSuiTxResult(await suiClient.executeTransactionBlock({')
    const waitCall = source.indexOf('waitForTransactionBestEffort(suiClient, result.digest)')

    expect(executeCall).toBeGreaterThanOrEqual(0)
    expect(normalizeCall).toBeGreaterThanOrEqual(0)
    expect(normalizeCall).toBeLessThan(waitCall)
  })
})
