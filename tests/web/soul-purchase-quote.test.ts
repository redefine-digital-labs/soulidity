import { beforeEach, describe, expect, it, vi } from 'vitest'

const ADAPTER_PACKAGE_ID = `0x${'9'.repeat(64)}`
const CPU_MARKETPLACE_ID = `0x${'8'.repeat(64)}`
const TRANSFER_POLICY_ID = `0x${'7'.repeat(64)}`
const SELLER_KIOSK_ID = `0x${'6'.repeat(64)}`
const SOUL_ID = `0x${'5'.repeat(64)}`

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
      NEXT_PUBLIC_SOUL_CPU_MARKETPLACE_ID: CPU_MARKETPLACE_ID,
      NEXT_PUBLIC_SOUL_TRANSFER_POLICY_ID: TRANSFER_POLICY_ID,
    }
  })

  it('decodes quote_purchase dev inspect return values as bigint amounts', async () => {
    mockedSuiClient.devInspectTransactionBlock.mockResolvedValue({
      error: null,
      results: [{
        returnValues: [
          [[0x40, 0x4b, 0x4c, 0x00, 0, 0, 0, 0], 'u64'],
          [[0x00, 0xca, 0x9a, 0x3b, 0, 0, 0, 0], 'u64'],
          [[0xc0, 0x4b, 0xc3, 0x01, 0, 0, 0, 0], 'u64'],
          [[0x00, 0x61, 0xaa, 0x3d, 0, 0, 0, 0], 'u64'],
        ],
      }],
    })

    const { getSoulPurchaseQuote } = await import('../../web/lib/souls/purchase-quote.ts')

    await expect(getSoulPurchaseQuote({
      sellerKioskId: SELLER_KIOSK_ID,
      soulObjectId: SOUL_ID,
    })).resolves.toEqual({
      marketplaceFeeSui: 5_000_000n,
      priceSui: 1_000_000_000n,
      royaltyFeeSui: 29_576_128n,
      totalSui: 1_034_576_128n,
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
      sellerKioskId: SELLER_KIOSK_ID,
      soulObjectId: SOUL_ID,
    })).rejects.toBeInstanceOf(OnChainVerificationError)
  })
})
