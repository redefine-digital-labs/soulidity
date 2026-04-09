// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SoulDetailPage from '@web/app/souls/[id]/page'

const mockUseSoulDetail = vi.fn()

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'soul-1' }),
}))

vi.mock('@web/components/auth-provider', () => ({
  useAuth: () => ({
    user: { primarySuiAddress: '0x2' },
    getAuthHeaders: vi.fn(async () => ({ Authorization: 'Bearer test' })),
  }),
}))

vi.mock('@web/lib/souls/use-privy-sui', () => ({
  usePrivySuiSign: () => ({
    signAndExecute: vi.fn(),
  }),
}))

vi.mock('@web/lib/souls/queries', () => ({
  useSoulDetail: (...args: unknown[]) => mockUseSoulDetail(...args),
}))

vi.mock('@web/components/souls/access-download-button', () => ({
  AccessDownloadButton: ({ soulObjectId }: { soulObjectId: string }) => (
    <div data-role="access-download-button">{soulObjectId}</div>
  ),
}))

vi.mock('@web/components/souls/purchase-button', () => ({
  PurchaseButton: () => <div data-role="purchase-button" />,
}))

function buildSoulDetail(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'uuid-1',
    onChainId: '0x2',
    name: 'Genesis Soul',
    description: 'A sealed bundle',
    imageUrl: 'https://example.com/soul.png',
    category: 'Collectible',
    tags: ['alpha'],
    previewImages: [],
    creatorRoyaltyBps: 1000,
    listingObjectOnChainId: null,
    listedPriceAtomic: null,
    listingStatus: 'held',
    creatorAddress: '0x3',
    currentOwnerAddress: '0x2',
    currentKioskId: '0x4',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    metadataRef: null,
    contentBlobId: 'blob-1',
    contentBlobObjectId: '0x5',
    currentKioskCapOnChainId: '0x6',
    readme: null,
    allowlistAddress: null,
    allowlistCapOnChainId: null,
    allowlistVersion: '0',
    creatorMemberId: null,
    currentOwnerMemberId: null,
    purchasePlatformFeeAtomic: null,
    purchaseCreatorRoyaltyAtomic: null,
    purchaseTotalAtomic: null,
    quotedPriceAtomic: null,
    isOwner: false,
    isCreator: false,
    isAllowlisted: false,
    ...overrides,
  }
}

describe('Soul detail access section', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    mockUseSoulDetail.mockReset()
  })

  it.each([
    ['owner', { isOwner: true, isAllowlisted: false }],
    ['allowlisted', { isOwner: false, isAllowlisted: true }],
  ])('renders AccessDownloadButton for %s viewers', async (_label, overrides) => {
    mockUseSoulDetail.mockReturnValue({
      data: buildSoulDetail(overrides),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    await act(async () => {
      root.render(<SoulDetailPage />)
    })

    const accessButton = container.querySelector('[data-role="access-download-button"]')
    expect(accessButton?.textContent).toBe('0x2')
  })

  it('does not show retired allowlist controls in owner management', async () => {
    mockUseSoulDetail.mockReturnValue({
      data: buildSoulDetail({
        isOwner: true,
        listingStatus: 'held',
        allowlistAddress: `0x${'9'.repeat(64)}`,
      }),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    await act(async () => {
      root.render(<SoulDetailPage />)
    })

    expect(container.textContent).not.toContain('Manage allowlist')
  })
})
