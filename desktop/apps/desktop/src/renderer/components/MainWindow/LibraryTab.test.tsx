// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LibraryTab } from './LibraryTab'

vi.mock('@tanstack/react-query', () => ({
  QueryClient: class QueryClient {},
  QueryClientProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@mysten/dapp-kit', () => ({
  SuiClientProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@mysten/sui/jsonRpc', () => ({
  getJsonRpcFullnodeUrl: () => 'https://rpc.test',
}))

vi.mock('@privy-io/react-auth', () => ({
  PrivyProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('../../lib/hooks/use-privy-sui', () => ({
  usePrivySuiSign: () => ({
    suiWallet: { address: '0xwallet123' },
    signPersonalMessage: vi.fn().mockResolvedValue('0xsig'),
    suiClient: {},
  }),
}))

vi.mock('../../lib/soulidity/asset-access', () => ({
  loadDecryptedPrivateAssetVersion: vi.fn(),
  parsePrivateAssetAccess: vi.fn((value) => value),
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type MockElectronApi = Pick<
  Window['electronAPI'],
  | 'getDesktopRuntimeConfig'
  | 'getDesktopAuthStatus'
  | 'cacheList'
  | 'soulGetActive'
  | 'soulFetchCatalog'
  | 'soulGetMySouls'
  | 'soulDownload'
  | 'onDownloadProgress'
  | 'cacheRemoveSprite'
  | 'soulSetActive'
  | 'getDesktopPrivyToken'
  | 'soulFetchManifest'
  | 'soulCachePersona'
>

function flushEffects() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}

function createElectronApi(overrides: Partial<MockElectronApi> = {}): MockElectronApi {
  return {
    getDesktopRuntimeConfig: vi.fn().mockResolvedValue({
      privyAppId: null,
      suiNetwork: 'testnet',
      authReady: false,
      authBlocker: null,
    }),
    getDesktopAuthStatus: vi.fn().mockResolvedValue({ hasToken: false, accountId: null }),
    cacheList: vi.fn().mockResolvedValue([]),
    soulGetActive: vi.fn().mockResolvedValue(null),
    soulFetchCatalog: vi.fn().mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 12,
      hasMore: false,
    }),
    soulGetMySouls: vi.fn().mockResolvedValue([]),
    soulDownload: vi.fn().mockResolvedValue({ catalogId: 'noop', spriteId: 'noop' }),
    onDownloadProgress: vi.fn().mockReturnValue(() => {}),
    cacheRemoveSprite: vi.fn().mockResolvedValue(true),
    soulSetActive: vi.fn().mockResolvedValue(undefined),
    getDesktopPrivyToken: vi.fn().mockResolvedValue({ jwt: 'jwt', alreadyLinked: true }),
    soulFetchManifest: vi.fn().mockResolvedValue(null),
    soulCachePersona: vi.fn().mockResolvedValue({ catalogId: 'noop', spriteId: 'noop' }),
    ...overrides,
  }
}

function findButton(container: HTMLElement, label: string) {
  return Array.from(container.querySelectorAll('button')).find(
    (button) => button.textContent?.trim() === label,
  ) as HTMLButtonElement | undefined
}

function findButtons(container: HTMLElement, label: string) {
  return Array.from(container.querySelectorAll('button')).filter(
    (button) => button.textContent?.trim() === label,
  ) as HTMLButtonElement[]
}

describe('LibraryTab', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(async () => {
    if (root) {
      const currentRoot = root
      await act(async () => {
        currentRoot.unmount()
      })
      root = null
    }
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  async function renderWithApi(api: MockElectronApi) {
    Object.defineProperty(window, 'electronAPI', {
      value: api as Window['electronAPI'],
      configurable: true,
    })
    const nextRoot = createRoot(container)
    root = nextRoot

    await act(async () => {
      nextRoot.render(<LibraryTab />)
      await flushEffects()
      await flushEffects()
    })
  }

  it('keeps My Souls cards visible but disables invalid or marketplace-restricted downloads', async () => {
    const api = createElectronApi({
      getDesktopRuntimeConfig: vi.fn().mockResolvedValue({
        privyAppId: 'privy-app',
        suiNetwork: 'testnet',
        authReady: true,
        authBlocker: null,
      }),
      getDesktopAuthStatus: vi.fn().mockResolvedValue({ hasToken: true, accountId: 'acct_123' }),
      soulFetchCatalog: vi.fn().mockResolvedValue({
        items: [{
          id: 'soul:market-owner-only',
          sourceType: 'soul',
          sourceRef: '0xmarket',
          title: 'Market Locked',
          description: 'listed',
          thumbnail: 'thumb.png',
          coverImage: 'cover.png',
          listingStatus: 'listed',
          listedPriceAtomic: '1000000',
          spriteDownloadPolicy: 'owner_only',
        }],
        page: 1,
        pageSize: 12,
        hasMore: false,
      }),
      soulGetMySouls: vi.fn().mockResolvedValue([
        {
          id: 'soul:owned-owner-only',
          sourceType: 'soul',
          sourceRef: '0xowned',
          title: 'Owned Locked',
          description: 'owned',
          thumbnail: 'thumb.png',
          coverImage: 'cover.png',
          listingStatus: 'held',
          listedPriceAtomic: null,
          spriteDownloadPolicy: 'owner_only',
        },
        {
          id: 'soul:owned-allowlist',
          sourceType: 'soul',
          sourceRef: '0xallowlist',
          title: 'Owned Allowlist',
          description: 'owned',
          thumbnail: 'thumb.png',
          coverImage: 'cover.png',
          listingStatus: 'held',
          listedPriceAtomic: null,
          spriteDownloadPolicy: 'allowlist',
        },
        {
          id: 'soul:owned-missing',
          sourceType: 'soul',
          sourceRef: '0xmissing',
          title: 'Owned Missing',
          description: 'owned',
          thumbnail: 'thumb.png',
          coverImage: 'cover.png',
          listingStatus: 'held',
          listedPriceAtomic: null,
          spriteDownloadPolicy: 'missing',
        },
      ]),
    })

    await renderWithApi(api)

    expect(container.textContent).toContain('Owned Locked')
    expect(container.textContent).toContain('Owned Allowlist')
    expect(container.textContent).toContain('Owned Missing')

    const downloadButtons = findButtons(container, 'Download')
    expect(downloadButtons).toHaveLength(2)
    expect(downloadButtons.every((button) => !button.disabled)).toBe(true)

    const missingButton = findButton(container, 'Sprite Missing')
    expect(missingButton?.disabled).toBe(true)

    const ownerOnlyButton = findButton(container, 'Owner Only')
    expect(ownerOnlyButton?.disabled).toBe(true)
  })

  it('keeps other cards downloadable while one catalog item is mid-download', async () => {
    let resolveDownload: (() => void) | null = null
    const pendingDownload = new Promise<{ catalogId: string; spriteId: string }>((resolve) => {
      resolveDownload = () => resolve({ catalogId: 'soul:1', spriteId: 'catalog-soul:1' })
    })

    const api = createElectronApi({
      soulFetchCatalog: vi.fn().mockResolvedValue({
        items: [
          {
            id: 'soul:1',
            sourceType: 'soul',
            sourceRef: '0x1',
            title: 'Soul One',
            description: 'public',
            thumbnail: 'one.png',
            coverImage: 'one-cover.png',
            listingStatus: 'listed',
            listedPriceAtomic: '1000000',
            spriteDownloadPolicy: 'public',
          },
          {
            id: 'soul:2',
            sourceType: 'soul',
            sourceRef: '0x2',
            title: 'Soul Two',
            description: 'public',
            thumbnail: 'two.png',
            coverImage: 'two-cover.png',
            listingStatus: 'listed',
            listedPriceAtomic: '2000000',
            spriteDownloadPolicy: 'public',
          },
        ],
        page: 1,
        pageSize: 12,
        hasMore: false,
      }),
      soulDownload: vi.fn().mockImplementation(async ({ catalogId }: { catalogId: string }) => {
        if (catalogId === 'soul:1') {
          return pendingDownload
        }
        return { catalogId, spriteId: `catalog-${catalogId}` }
      }),
    })

    await renderWithApi(api)

    const [firstDownload, secondDownload] = findButtons(container, 'Download')
    expect(firstDownload).toBeDefined()
    expect(secondDownload).toBeDefined()

    await act(async () => {
      firstDownload?.click()
      await flushEffects()
    })

    expect(container.textContent).toContain('0%')
    const remainingDownloadButtons = findButtons(container, 'Download')
    expect(remainingDownloadButtons).toHaveLength(1)
    expect(remainingDownloadButtons[0]?.disabled).toBe(false)

    await act(async () => {
      resolveDownload?.()
      await flushEffects()
      await flushEffects()
    })
  })
})
