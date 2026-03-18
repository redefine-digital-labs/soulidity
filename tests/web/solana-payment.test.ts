import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  solanaConnection,
  usdCentsToLamports,
  usdCentsToUsdcAtomicUnits,
} from '../../web/lib/solana.ts'
import {
  parseSolTransfer,
  parseSplTransfer,
  verifySolanaTransaction,
} from '../../web/lib/solana-verify.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Solana pricing helpers', () => {
  it('converts USD cents to USDC atomic units', () => {
    expect(usdCentsToUsdcAtomicUnits(199)).toBe(1_990_000n)
  })

  it('rounds lamports up when converting from USD cents', () => {
    expect(usdCentsToLamports(250, 125)).toBe(20_000_000n)
  })

  it('uses fixed-point math for prices that would overcharge under float rounding', () => {
    expect(usdCentsToLamports(3, 0.1)).toBe(300_000_000n)
  })
})

describe('parseSolTransfer', () => {
  it('extracts a system transfer from a parsed transaction', () => {
    const result = parseSolTransfer({
      transaction: {
        message: {
          instructions: [
            {
              program: 'system',
              parsed: {
                type: 'transfer',
                info: {
                  source: 'sender-sol',
                  destination: 'recipient-sol',
                  lamports: '12345',
                },
              },
            },
          ],
        },
      },
    } as any)

    expect(result).toEqual({
      success: true,
      sender: 'sender-sol',
      recipient: 'recipient-sol',
      amount: 12_345n,
    })
  })

  it('returns null when the transaction has no system transfer', () => {
    expect(
      parseSolTransfer({
        transaction: { message: { instructions: [] } },
      } as any),
    ).toBeNull()
  })
})

describe('parseSplTransfer', () => {
  it('extracts a matching transferChecked instruction', () => {
    const result = parseSplTransfer(
      {
        transaction: {
          message: {
            instructions: [
              {
                program: 'spl-token',
                parsed: {
                  type: 'transferChecked',
                  info: {
                    authority: 'payer-authority',
                    destination: 'recipient-ata',
                    amount: '4200000',
                    mint: 'mint-usdc',
                  },
                },
              },
            ],
          },
        },
      } as any,
      'mint-usdc',
    )

    expect(result).toEqual({
      success: true,
      sender: 'payer-authority',
      recipient: 'recipient-ata',
      amount: 4_200_000n,
      mint: 'mint-usdc',
    })
  })

  it('returns null when the transferChecked mint does not match', () => {
    expect(
      parseSplTransfer(
        {
          transaction: {
            message: {
              instructions: [
                {
                  program: 'spl-token',
                  parsed: {
                    type: 'transferChecked',
                    info: {
                      authority: 'payer-authority',
                      destination: 'recipient-ata',
                      amount: '4200000',
                      mint: 'different-mint',
                    },
                  },
                },
              ],
            },
          },
        } as any,
        'mint-usdc',
      ),
    ).toBeNull()
  })

  it('rejects plain SPL transfer instructions for USDC verification', async () => {
    vi.spyOn(solanaConnection, 'getParsedTransaction').mockResolvedValue({
      transaction: {
        message: {
          instructions: [
            {
              program: 'spl-token',
              parsed: {
                type: 'transfer',
                info: {
                  authority: 'buyer-wallet',
                  destination: 'seller-ata',
                  amount: '4200000',
                },
              },
            },
          ],
        },
      },
      meta: {},
      blockTime: 1,
    } as any)

    await expect(
      verifySolanaTransaction('sig-1', 'buyer-wallet', 'seller-ata', 4_200_000n, 'USDC'),
    ).resolves.toEqual({
      ok: false,
      error: 'No USDC transfer found in transaction',
    })
  })

  it('uses the matching SOL transfer instead of the first unrelated system transfer', async () => {
    vi.spyOn(solanaConnection, 'getParsedTransaction').mockResolvedValue({
      transaction: {
        message: {
          instructions: [
            {
              program: 'system',
              parsed: {
                type: 'transfer',
                info: {
                  source: 'buyer-wallet',
                  destination: 'rent-recipient',
                  lamports: '5000',
                },
              },
            },
            {
              program: 'system',
              parsed: {
                type: 'transfer',
                info: {
                  source: 'buyer-wallet',
                  destination: 'seller-wallet',
                  lamports: '2500000',
                },
              },
            },
          ],
        },
      },
      meta: {},
      blockTime: 1,
    } as any)

    await expect(
      verifySolanaTransaction('sig-2', 'buyer-wallet', 'seller-wallet', 2_500_000n, 'SOL'),
    ).resolves.toEqual({
      ok: true,
      verification: {
        success: true,
        sender: 'buyer-wallet',
        recipient: 'seller-wallet',
        amount: 2_500_000n,
        timestampMs: 1000,
      },
    })
  })

  it('rejects transfers that are one unit below the expected amount', async () => {
    vi.spyOn(solanaConnection, 'getParsedTransaction').mockResolvedValue({
      transaction: {
        message: {
          instructions: [
            {
              program: 'system',
              parsed: {
                type: 'transfer',
                info: {
                  source: 'buyer-wallet',
                  destination: 'seller-wallet',
                  lamports: '2499999',
                },
              },
            },
          ],
        },
      },
      meta: {},
      blockTime: 1,
    } as any)

    await expect(
      verifySolanaTransaction('sig-3', 'buyer-wallet', 'seller-wallet', 2_500_000n, 'SOL'),
    ).resolves.toEqual({
      ok: false,
      error: 'Amount insufficient',
    })
  })

  it('times out stalled Solana RPC lookups', async () => {
    vi.useFakeTimers()
    vi.spyOn(solanaConnection, 'getParsedTransaction').mockImplementation(
      () => new Promise(() => {}) as any,
    )

    const resultPromise = verifySolanaTransaction(
      'sig-timeout',
      'buyer-wallet',
      'seller-wallet',
      2_500_000n,
      'SOL',
    )

    await vi.advanceTimersByTimeAsync(10_000)

    await expect(resultPromise).resolves.toEqual({
      ok: false,
      error: 'Transaction lookup timed out',
    })

    vi.useRealTimers()
  })
})
