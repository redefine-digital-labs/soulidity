// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LibraryTab } from './LibraryTab'

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
  | 'soulFetchManifest'
  | 'soulCachePersona'
  | 'soulDecryptProtectedSprite'
>

type CachedSpriteMeta = {
  spriteId: string
  source: string
  version: string
  downloadedAt: number
  size: number
  catalogSourceType?: 'starter' | 'soul'
  catalogSourceRef?: string
}

function flushEffects() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}

function createElectronApi(overrides: Partial<MockElectronApi> = {}): MockElectronApi {
  return {
    getDesktopRuntimeConfig: vi.fn().mockResolvedValue({
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
    soulFetchManifest: vi.fn().mockResolvedValue(null),
    soulCachePersona: vi.fn().mockResolvedValue({ catalogId: 'noop', spriteId: 'noop' }),
    soulDecryptProtectedSprite: vi.fn().mockResolvedValue({
      bytes: new Uint8Array([1]),
      fileName: 'persona-sprite.png',
      mimeType: 'image/png',
    }),
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

function findBadges(container: HTMLElement, label: string) {
  return Array.from(container.querySelectorAll('.persona-card__badge')).filter(
    (badge) => badge.textContent?.trim() === label,
  ) as HTMLElement[]
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

  it('gates owned protected sprites by active asset-scope grant: granted ones download, ungranted ones surface "Authorize on web"', async () => {
    const api = createElectronApi({
      getDesktopRuntimeConfig: vi.fn().mockResolvedValue({
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
          activeSpriteVersionIndex: 1,
        }],
        page: 1,
        pageSize: 12,
        hasMore: false,
      }),
      soulGetMySouls: vi.fn().mockResolvedValue([
        // No grant for this owned protected Soul → must show
        // "Authorize on web", not Download. Replaces the legacy global
        // walletMismatch banner that fired even when no protected
        // download was happening.
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
          activeSpriteVersionIndex: 2,
          agentSpriteGrant: null,
        },
        // Active grant for this owned allowlist Soul → Download enabled.
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
          activeSpriteVersionIndex: 3,
          agentSpriteGrant: {
            active: true,
            grantOnChainId: '0xgrant1',
            expiresAt: null,
          },
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
          agentSpriteGrant: null,
        },
        {
          id: 'soul:owned-invalid',
          sourceType: 'soul',
          sourceRef: '0xinvalid',
          title: 'Owned Invalid',
          description: 'owned',
          thumbnail: 'thumb.png',
          coverImage: 'cover.png',
          listingStatus: 'held',
          listedPriceAtomic: null,
          spriteDownloadPolicy: 'invalid',
          agentSpriteGrant: null,
        },
      ]),
    })

    await renderWithApi(api)

    expect(container.textContent).toContain('Owned Locked')
    expect(container.textContent).toContain('Owned Allowlist')
    expect(container.textContent).toContain('Owned Missing')
    expect(container.textContent).toContain('Owned Invalid')
    expect(findBadges(container, 'Sprite Available')).toHaveLength(3)
    expect(container.textContent).not.toContain('Sprite v')
    expect(container.textContent).not.toContain('Sprite Missing')
    expect(container.textContent).not.toContain('Sprite Invalid')
    expect(container.textContent).not.toContain('This soul has no valid sprite metadata yet.')
    expect(container.textContent).not.toContain('The sprite metadata exists but does not match the desktop contract.')

    // Only the granted protected Soul plus any incidentally-public Souls
    // produce an enabled Download. The owner-only Soul without a grant
    // must surface "Authorize on web", and the marketplace-protected Soul
    // surfaces "Owner Only" with the marketplace gate.
    const downloadButtons = findButtons(container, 'Download')
    expect(downloadButtons).toHaveLength(1)
    expect(downloadButtons[0]?.disabled).toBe(false)

    const authorizeButton = findButton(container, 'Authorize on web')
    expect(authorizeButton).toBeDefined()
    expect(authorizeButton?.disabled).toBe(true)

    expect(findButton(container, 'Sprite Missing')).toBeUndefined()
    expect(findButton(container, 'Sprite Invalid')).toBeUndefined()

    // Marketplace context for owner-only sprites still shows the
    // section-specific gate, never the granted-agent path.
    const marketplaceLocked = findButton(container, 'Owner Only')
    expect(marketplaceLocked?.disabled).toBe(true)
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
            activeSpriteVersionIndex: 7,
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
            activeSpriteVersionIndex: 8,
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

    expect(findBadges(container, 'Sprite Available')).toHaveLength(2)
    expect(container.textContent).not.toContain('Sprite v')

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

  it('downloads protected granted sprites through main-process decrypt and then allows activation', async () => {
    const soulId = '0x4df3f36dbcb3d2f9be7fcbdd6de5b12078015deac69618b498605037179705c8'
    const catalogId = `soul:${soulId}`
    const privateAccess = {
      visibility: 'sealed',
      artifact: {
        walrusBlobUrl: 'https://aggregator.mainnet.walrus.mirai.cloud/v1/blobs/encrypted-sprite',
      },
    }
    let cachedSprites: CachedSpriteMeta[] = []

    const api = createElectronApi({
      getDesktopRuntimeConfig: vi.fn().mockResolvedValue({
        suiNetwork: 'mainnet',
        authReady: true,
        authBlocker: null,
      }),
      getDesktopAuthStatus: vi.fn().mockResolvedValue({ hasToken: true, accountId: 'acct_123' }),
      cacheList: vi.fn().mockImplementation(async () => cachedSprites),
      soulGetMySouls: vi.fn().mockResolvedValue([{
        id: catalogId,
        sourceType: 'soul',
        sourceRef: soulId,
        title: 'Main Account Soul',
        description: 'owned',
        thumbnail: 'thumb.png',
        coverImage: 'cover.png',
        listingStatus: 'held',
        listedPriceAtomic: null,
        spriteDownloadPolicy: 'owner_only',
        activeSpriteVersionIndex: 1,
        agentSpriteGrant: {
          active: true,
          grantOnChainId: '0xgrant',
          expiresAt: null,
        },
      }]),
      soulFetchManifest: vi.fn().mockResolvedValue({
        version: '2026-05-11T00:00:00.000Z',
        sourceType: 'soul',
        sourceRef: soulId,
        sprite: {
          assetName: 'persona-sprite',
          versionIndex: 1,
          contentOnChainId: '0xcontent',
          downloadPolicy: 'owner_only',
          config: {
            src: 'persona-sprite.png',
            frameWidth: 128,
            frameHeight: 128,
            columns: 4,
            animations: {},
          },
          privateAccess,
        },
      }),
      soulDecryptProtectedSprite: vi.fn().mockResolvedValue({
        bytes: new Uint8Array([4, 5, 6]),
        fileName: 'persona-sprite.png',
        mimeType: 'image/png',
      }),
      soulCachePersona: vi.fn().mockImplementation(async (params: {
        catalogId: string
        sourceType: 'starter' | 'soul'
        sourceRef: string
        version: string
      }) => {
        cachedSprites = [{
          spriteId: `catalog-${params.catalogId}`,
          source: 'desktop-catalog',
          version: params.version,
          downloadedAt: Date.now(),
          size: 3,
          catalogSourceType: params.sourceType,
          catalogSourceRef: params.sourceRef,
        }]
        return { catalogId: params.catalogId, spriteId: `catalog-${params.catalogId}` }
      }),
    })

    await renderWithApi(api)

    const download = findButton(container, 'Download')
    expect(download).toBeDefined()
    expect(download?.disabled).toBe(false)

    await act(async () => {
      download?.click()
      await flushEffects()
      await flushEffects()
      await flushEffects()
    })

    expect(api.soulFetchManifest).toHaveBeenCalledWith({ catalogId, viewer: null })
    expect(api.soulDecryptProtectedSprite).toHaveBeenCalledWith({ access: privateAccess })
    expect(api.soulCachePersona).toHaveBeenCalledWith(expect.objectContaining({
      catalogId,
      sourceType: 'soul',
      sourceRef: soulId,
      spriteBytes: new Uint8Array([4, 5, 6]),
    }))

    const activate = findButton(container, 'Activate')
    expect(activate).toBeDefined()

    await act(async () => {
      activate?.click()
      await flushEffects()
      await flushEffects()
    })

    expect(api.soulSetActive).toHaveBeenCalledWith({
      catalogId,
      sourceType: 'soul',
      sourceRef: soulId,
    })
  })
})
