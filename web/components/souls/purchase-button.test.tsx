// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PurchaseButton } from '@web/components/souls/purchase-button'

const mockedGetAuthHeaders = vi.hoisted(() => vi.fn())

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
    signAndExecute: vi.fn(),
  }),
}))

vi.mock('@web/lib/souls/tx-builder', () => ({
  buildBuySoulTx: vi.fn(),
  buildInitSoulPersonalKioskTx: vi.fn(),
}))

vi.mock('@web/lib/souls/mirror-sync', () => ({
  mirrorRouteRequest: vi.fn(),
  formatMirrorSyncError: (error: unknown) => error instanceof Error ? error.message : 'Unknown error',
}))

vi.mock('@web/lib/souls/purchase-amounts', () => ({
  parsePurchaseAmounts: () => ({
    totalAtomic: 1_100_000n,
  }),
}))

describe('PurchaseButton', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    mockedGetAuthHeaders.mockReset()
    mockedGetAuthHeaders.mockRejectedValue(new Error('Auth unavailable'))
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
    vi.restoreAllMocks()
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
})
