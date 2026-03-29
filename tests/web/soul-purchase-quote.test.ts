import { beforeEach, describe, expect, it, vi } from 'vitest'

const ADAPTER_PACKAGE_ID = `0x${'9'.repeat(64)}`
const MARKET_CONFIG_ID = `0x${'8'.repeat(64)}`
const TRANSFER_POLICY_ID = `0x${'7'.repeat(64)}`
const LISTING_OBJECT_ID = `0x${'6'.repeat(64)}`

const mockedSuiClient = vi.hoisted(() => ({
  devInspectTransactionBlock: vi.fn(),
}))

vi.mock('@web/lib/sui', () => ({
  suiClient: mockedSuiClient,
}))

describe('soul purchase quote helper', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_SOUL_MARKET_ADAPTER_PACKAGE_ID: ADAPTER_PACKAGE_ID,
      NEXT_PUBLIC_SOUL_MARKET_CONFIG_ID: MARKET_CONFIG_ID,
      NEXT_PUBLIC_SOUL_TRANSFER_POLICY_ID: TRANSFER_POLICY_ID,
    }
  })

  it('decodes quote_fixed_price dev inspect return values as bigint amounts', async () => {
    mockedSuiClient.devInspectTransactionBlock.mockResolvedValue({
      error: null,
      results: [{
        returnValues: [
          [[0x40, 0x42, 0x0f, 0x00, 0, 0, 0, 0], 'u64'],
          [[0x80, 0x96, 0x98, 0x00, 0, 0, 0, 0], 'u64'],
          [[0x20, 0x4e, 0x00, 0x00, 0, 0, 0, 0], 'u64'],
          [[0xe0, 0x26, 0xa8, 0x00, 0, 0, 0, 0], 'u64'],
        ],
      }],
    })

    const { getSoulPurchaseQuote } = await import('../../web/lib/souls/purchase-quote.ts')

    await expect(getSoulPurchaseQuote({
      listingObjectId: LISTING_OBJECT_ID,
    })).resolves.toEqual({
      platformFeeAtomic: 1_000_000n,
      priceAtomic: 10_000_000n,
      creatorRoyaltyAtomic: 20_000n,
      totalAtomic: 11_020_000n,
    })
    expect(mockedSuiClient.devInspectTransactionBlock).toHaveBeenCalledTimes(1)
  })

  it('surfaces dev inspect failures as on-chain verification errors', async () => {
    mockedSuiClient.devInspectTransactionBlock.mockResolvedValue({
      error: 'MoveAbort(0)',
      results: null,
    })

    const { getSoulPurchaseQuote } = await import('../../web/lib/souls/purchase-quote.ts')
    const { OnChainVerificationError } = await import('../../web/lib/souls/on-chain-verification.ts')

    await expect(getSoulPurchaseQuote({
      listingObjectId: LISTING_OBJECT_ID,
    })).rejects.toBeInstanceOf(OnChainVerificationError)
  })
})
