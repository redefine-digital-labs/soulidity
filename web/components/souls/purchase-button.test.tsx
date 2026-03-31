// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PurchaseButton } from '@web/components/souls/purchase-button'

const mockedGetAuthHeaders = vi.hoisted(() => vi.fn())
const mockedSignAndExecute = vi.hoisted(() => vi.fn())
const mockedBuildBuySoulTx = vi.hoisted(() => vi.fn())
const mockedMirrorRouteRequest = vi.hoisted(() => vi.fn())

vi.mock('@mysten/dapp-kit', () => ({
  useSuiClient: () => ({ name: 'sui-client' }),
}))

vi.mock('@web/components/auth-provider', () => ({
  useAuth: () => ({
    getAuthHeaders: mockedGetAuthHeaders,
    user: { primarySuiAddress: `0x${'1'.repeat(64)}` },
  }),
}))

vi.mock('@web/lib/souls/use-privy-sui', () => ({
  usePrivySuiSign: () => ({
    signAndExecute: mockedSignAndExecute,
  }),
}))

vi.mock('@web/lib/souls/tx-builder', () => ({
  buildBuySoulTx: mockedBuildBuySoulTx,
  buildInitSoulPersonalKioskTx: vi.fn(),
}))

vi.mock('@web/lib/souls/mirror-sync', () => ({
  mirrorRouteRequest: mockedMirrorRouteRequest,
  formatMirrorSyncError: (error: unknown) => error instanceof Error ? error.message : 'Unknown error',
}))

vi.mock('@web/lib/souls/purchase-amounts', () => ({
  parsePurchaseAmounts: () => ({
    totalAtomic: 1_100_000n,
  }),
}))

vi.mock('@web/lib/souls/coin-selection', () => ({
  CoinPaginationExhaustedError: class CoinPaginationExhaustedError extends Error {},
  selectCoinObjectIdsForAmountAcrossPages: vi.fn().mockResolvedValue(['0xcoin-a']),
}))

describe('PurchaseButton', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    process.env.NEXT_PUBLIC_SOUL_PAYMENT_COIN_TYPE = '0xpayment::usdc::USDC'
    mockedGetAuthHeaders.mockReset()
    mockedSignAndExecute.mockReset()
    mockedBuildBuySoulTx.mockReset()
    mockedMirrorRouteRequest.mockReset()
    mockedGetAuthHeaders.mockRejectedValue(new Error('Auth unavailable'))
    mockedSignAndExecute.mockResolvedValue({ digest: '0xdigest' })
    mockedBuildBuySoulTx.mockReturnValue({ kind: 'tx' })
    mockedMirrorRouteRequest.mockResolvedValue(undefined)
    globalThis.fetch = vi.fn()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
  })

  it('surfaces personal kiosk refresh failures instead of leaving the component stuck loading', async () => {
    await act(async () => {
      root.render(
        <PurchaseButton
          soulObjectId="0xsoul"
          listingObjectId="0xlisting"
          sellerKioskId="0xkiosk"
          listedPriceAtomic="1000000"
          purchasePlatformFeeAtomic="50000"
          purchaseCreatorRoyaltyAtomic="50000"
          purchaseTotalAtomic="1100000"
        />,
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Auth unavailable')
    expect(container.textContent).not.toContain('Checking Soul kiosk…')
  })

  it('builds a buy tx even when the personal kiosk preflight reports missing', async () => {
    mockedGetAuthHeaders.mockResolvedValue({ Authorization: 'Bearer test' })
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/souls/personal-kiosk') {
        return {
          ok: false,
          status: 404,
          json: async () => ({ error: 'No Soul personal kiosk found for this wallet' }),
        } as Response
      }
      throw new Error(`Unexpected fetch call: ${String(input)}`)
    }) as unknown as typeof fetch

    await act(async () => {
      root.render(
        <PurchaseButton
          soulObjectId="0xsoul"
          listingObjectId="0xlisting"
          sellerKioskId="0xkiosk"
          listedPriceAtomic="1000000"
          purchasePlatformFeeAtomic="50000"
          purchaseCreatorRoyaltyAtomic="50000"
          purchaseTotalAtomic="1100000"
        />,
      )
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    const buyButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Buy for')) as HTMLButtonElement | undefined
    expect(buyButton).toBeDefined()
    expect(buyButton?.disabled).toBe(false)

    await act(async () => {
      buyButton?.click()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(mockedBuildBuySoulTx).toHaveBeenCalledWith(expect.objectContaining({
      listingObjectId: '0xlisting',
      sellerKioskId: '0xkiosk',
      totalAtomic: 1_100_000n,
    }))
    expect(mockedBuildBuySoulTx).toHaveBeenCalledWith(expect.not.objectContaining({
      buyerKioskId: expect.any(String),
      buyerKioskCapOnChainId: expect.any(String),
    }))
    expect(mockedSignAndExecute).toHaveBeenCalledTimes(1)
  })
})
