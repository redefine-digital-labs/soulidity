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
    const { normalizeSuiTxResult } = await import('@soulidity/sdk')

    expect(() => normalizeSuiTxResult(undefined)).toThrow(
      'Wallet transaction execution did not return a transaction result',
    )
  })

  it('accepts digest-only executeTransactionBlock results before effects resolution', async () => {
    const { normalizeSuiTxResult } = await import('@soulidity/sdk')

    expect(normalizeSuiTxResult({ digest: 'abc' })).toMatchObject({ digest: 'abc' })
  })

  it('lets the wallet auto-estimate gas via dry-run instead of hardcoding a budget', () => {
    // A hardcoded budget rejects mainnet PTB2 (mint + N×certify + 5-8 shared
    // objects + Seal policy / ContentAccessList) whenever the wallet's dry-run
    // estimate exceeds it. The wallet (Slush / Sui Wallet) is the authoritative
    // gas estimator on the signing path, so the hook only sets the sender and
    // forwards the transaction without touching gasBudget.
    const source = readFileSync('web/lib/hooks/use-wallet-sign.ts', 'utf8')
    const senderCall = source.indexOf('tx.setSenderIfNotSet(currentAccount.address)')
    const signCall = source.indexOf('await signTransaction({')

    expect(senderCall).toBeGreaterThanOrEqual(0)
    expect(signCall).toBeGreaterThan(senderCall)
    expect(source).not.toMatch(/setGasBudgetIfNotSet/)
    expect(source).not.toMatch(/\.setGasBudget\(/)
  })

  it('resolves digest-only execute results through waitForTransaction with effects enabled', async () => {
    const { resolveSuiTxResultWithEffects } = await import('@soulidity/sdk')
    const waitForTransaction = vi.fn().mockResolvedValue({
      digest: 'abc',
      effects: { status: { status: 'success' } },
      events: [],
      objectChanges: [],
    })

    await expect(resolveSuiTxResultWithEffects({ waitForTransaction }, { digest: 'abc' }))
      .resolves.toMatchObject({ digest: 'abc', effects: { status: { status: 'success' } } })
    expect(waitForTransaction).toHaveBeenCalledWith({
      digest: 'abc',
      options: {
        showEffects: true,
        showEvents: true,
        showObjectChanges: true,
        showInput: true,
      },
    })
  })

  it('throws a readable app error when fallback still returns no effects', async () => {
    const { resolveSuiTxResultWithEffects } = await import('@soulidity/sdk')
    const waitForTransaction = vi.fn().mockResolvedValue({ digest: 'abc' })

    await expect(resolveSuiTxResultWithEffects({ waitForTransaction }, { digest: 'abc' }))
      .rejects.toThrow('Wallet transaction execution did not return effects for transaction abc')
  })

  it('preserves digest, status, and chain error for failed transaction effects', async () => {
    const { SuiTxExecutionError, assertSuiTxSucceeded } = await import('@soulidity/sdk')

    try {
      assertSuiTxSucceeded({
        digest: 'abc',
        effects: { status: { status: 'failure', error: 'MoveAbort(MY_MODULE, 7)' } },
      }, 'Soul mint transaction')
      throw new Error('expected assertSuiTxSucceeded to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(SuiTxExecutionError)
      expect(error).toMatchObject({
        digest: 'abc',
        status: 'failure',
        executionError: 'MoveAbort(MY_MODULE, 7)',
      })
      expect((error as Error).message).toBe(
        'Soul mint transaction abc did not succeed (status=failure, error=MoveAbort(MY_MODULE, 7))',
      )
    }
  })

  it('resolves executeTransactionBlock effects before waiting on the digest', () => {
    const source = readFileSync('web/lib/hooks/use-wallet-sign.ts', 'utf8')
    const executeCall = source.indexOf('suiClient.executeTransactionBlock({')
    const resolveCall = source.indexOf('resolveSuiTxResultWithEffects(suiClient, await suiClient.executeTransactionBlock({')
    const waitCall = source.indexOf('waitForTransactionBestEffort(suiClient, result.digest)')

    expect(executeCall).toBeGreaterThanOrEqual(0)
    expect(resolveCall).toBeGreaterThanOrEqual(0)
    expect(resolveCall).toBeLessThan(waitCall)
  })
})
