import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  solanaConnection,
  usdCentsToUsdcAtomicUnits,
} from '../../web/lib/solana.ts'
import {
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
      verifySolanaTransaction('sig-1', 'buyer-wallet', 'seller-ata', 4_200_000n),
    ).resolves.toEqual({
      ok: false,
      error: 'No USDC transfer found in transaction',
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
    )

    await vi.advanceTimersByTimeAsync(10_000)

    await expect(resultPromise).resolves.toEqual({
      ok: false,
      error: 'Transaction lookup timed out',
    })

    vi.useRealTimers()
  })
})
