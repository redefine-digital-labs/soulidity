import { describe, expect, it } from 'vitest'
import type { CatalogCacheRecord } from '../../desktop/src/lib/persistence'
import type { DesktopCatalogItem, DesktopPersonaManifest } from '../../web/lib/types/desktop'

const starterCatalogItem: DesktopCatalogItem = {
  id: 'starter-aurora',
  sourceType: 'starter',
  sourceRef: 'aurora-starter',
  title: 'Aurora Starter',
  description: 'Starter persona for anonymous desktop installs.',
  coverImage: 'https://cdn.example.com/aurora-cover.png',
  thumbnail: 'https://cdn.example.com/aurora-thumb.png',
  updatedAt: '2026-04-10T04:00:00.000Z',
}

const soulCatalogItem: DesktopCatalogItem = {
  id: 'soul-nebula',
  sourceType: 'soul',
  sourceRef: 'nebula-soul',
  title: 'Nebula Soul',
  description: 'Curated soul preview for the desktop catalog.',
  coverImage: 'https://cdn.example.com/nebula-cover.png',
  thumbnail: 'https://cdn.example.com/nebula-thumb.png',
  updatedAt: '2026-04-10T04:10:00.000Z',
}

const starterManifest: DesktopPersonaManifest = {
  ...starterCatalogItem,
  version: '2026.04.10',
  checksum: 'sha256:aurora-manifest',
  files: [
    {
      path: 'bundle/aurora.zip',
      url: 'https://cdn.example.com/aurora.zip',
      checksum: 'sha256:aurora-file',
    },
  ],
}

describe('desktop catalog workflow', () => {
  it('refreshes the mixed desktop catalog from the API and persists cache for offline fallback', async () => {
    const catalogModule = await import('../../desktop/src/lib/catalog.ts')

    const existingCache: CatalogCacheRecord = {
      syncedAt: '2026-04-10T03:55:00.000Z',
      items: [starterCatalogItem],
      manifestsById: {
        [starterManifest.id]: starterManifest,
      },
    }

    let savedCache: CatalogCacheRecord | null = null

    const result = await catalogModule.refreshDesktopCatalog({
      now: () => new Date('2026-04-10T04:15:00.000Z'),
      page: 1,
      pageSize: 12,
      fetchCatalogPage: async () => ({
        items: [starterCatalogItem, soulCatalogItem],
        total: 2,
        page: 1,
        pageSize: 12,
        totalPages: 1,
      }),
      loadCache: async () => existingCache,
      saveCache: async (cache) => {
        savedCache = cache
      },
    })

    expect(result).toMatchObject({
      items: [starterCatalogItem, soulCatalogItem],
      total: 2,
      page: 1,
      pageSize: 12,
      totalPages: 1,
      source: 'network',
      stale: false,
      warning: null,
      syncedAt: '2026-04-10T04:15:00.000Z',
    })
    expect(savedCache).toEqual({
      syncedAt: '2026-04-10T04:15:00.000Z',
      items: [starterCatalogItem, soulCatalogItem],
      manifestsById: {
        [starterManifest.id]: starterManifest,
      },
    })
  })

  it('falls back to the latest cached catalog when refresh fails offline', async () => {
    const catalogModule = await import('../../desktop/src/lib/catalog.ts')

    const cachedCatalog: CatalogCacheRecord = {
      syncedAt: '2026-04-10T04:12:00.000Z',
      items: [starterCatalogItem, soulCatalogItem],
      manifestsById: {},
    }

    const result = await catalogModule.refreshDesktopCatalog({
      page: 1,
      pageSize: 12,
      fetchCatalogPage: async () => {
        throw new Error('network offline')
      },
      loadCache: async () => cachedCatalog,
      saveCache: async () => {
        throw new Error('saveCache should not run during offline fallback')
      },
    })

    expect(result).toMatchObject({
      items: [starterCatalogItem, soulCatalogItem],
      total: 2,
      page: 1,
      pageSize: 12,
      totalPages: 1,
      source: 'cache',
      stale: true,
      syncedAt: '2026-04-10T04:12:00.000Z',
    })
    expect(result.warning).toMatch(/offline/i)
  })

  it('filters the shared desktop catalog across title, description, and source labels for search UI', async () => {
    const catalogModule = await import('../../desktop/src/lib/catalog.ts')

    expect(catalogModule.filterDesktopCatalogItems([starterCatalogItem, soulCatalogItem], 'starter')).toEqual([
      starterCatalogItem,
    ])
    expect(catalogModule.filterDesktopCatalogItems([starterCatalogItem, soulCatalogItem], 'curated')).toEqual([
      soulCatalogItem,
    ])
    expect(catalogModule.filterDesktopCatalogItems([starterCatalogItem, soulCatalogItem], 'nebula')).toEqual([
      soulCatalogItem,
    ])
    expect(catalogModule.filterDesktopCatalogItems([starterCatalogItem, soulCatalogItem], '')).toEqual([
      starterCatalogItem,
      soulCatalogItem,
    ])
  })

  it('loads persona detail from the API and falls back to cached manifest detail when offline', async () => {
    const catalogModule = await import('../../desktop/src/lib/catalog.ts')

    const cachedCatalog: CatalogCacheRecord = {
      syncedAt: '2026-04-10T04:12:00.000Z',
      items: [starterCatalogItem],
      manifestsById: {
        [starterManifest.id]: starterManifest,
      },
    }

    const offlineResult = await catalogModule.loadDesktopPersonaManifest({
      personaId: starterManifest.id,
      fetchManifest: async () => {
        throw new Error('network offline')
      },
      loadCache: async () => cachedCatalog,
      saveCache: async () => {
        throw new Error('saveCache should not run when using cached manifest')
      },
    })

    expect(offlineResult).toMatchObject({
      manifest: starterManifest,
      source: 'cache',
      stale: true,
    })
    expect(offlineResult.warning).toMatch(/offline/i)
  })
})

describe('desktop starter install workflow', () => {
  it('creates a browser-preview install record for starter personas and blocks curated soul installs', async () => {
    const runtimeModule = await import('../../desktop/src/lib/persona-runtime.ts')

    const existingInstalled = [
      {
        personaId: 'existing-starter',
        sourceType: 'starter' as const,
        sourceRef: 'existing',
        version: '2026.04.09',
        checksum: 'sha256:existing',
        manifest: {
          ...starterManifest,
          id: 'existing-starter',
          sourceRef: 'existing',
          title: 'Existing Starter',
        },
        bundlePath: '/browser-preview/soulidity-desktop/personas/bundles/existing-starter/2026.04.09',
        runtimeAssetsPath: '/browser-preview/soulidity-desktop/personas/runtime/existing-starter/2026.04.09',
        installedAt: '2026-04-10T04:00:00.000Z',
      },
    ]

    const installedStarter = await runtimeModule.installDesktopPersona(starterManifest, {
      now: () => new Date('2026-04-10T04:20:00.000Z'),
      installInTauri: async () => {
        throw new Error('browser preview should not call Tauri transport')
      },
      loadStoredInstalledPersonas: async () => existingInstalled,
      runtime: 'browser',
      saveStoredInstalledPersonas: async (records) => {
        expect(records).toHaveLength(2)
        expect(records.at(-1)).toMatchObject({
          personaId: starterManifest.id,
          sourceType: 'starter',
          sourceRef: 'aurora-starter',
          version: '2026.04.10',
        })
      },
    })

    expect(installedStarter).toMatchObject({
      personaId: starterManifest.id,
      sourceType: 'starter',
      sourceRef: 'aurora-starter',
      version: '2026.04.10',
      bundlePath: '/browser-preview/soulidity-desktop/personas/bundles/starter-aurora/2026.04.10',
      runtimeAssetsPath: '/browser-preview/soulidity-desktop/personas/runtime/starter-aurora/2026.04.10',
      installedAt: '2026-04-10T04:20:00.000Z',
    })

    await expect(
      runtimeModule.installDesktopPersona(
        {
          ...starterManifest,
          id: 'soul-nebula',
          sourceType: 'soul',
          sourceRef: 'nebula-soul',
          title: 'Nebula Soul',
        },
        {
          installInTauri: async () => {
            throw new Error('should not call Tauri transport')
          },
          loadStoredInstalledPersonas: async () => [],
          runtime: 'browser',
          saveStoredInstalledPersonas: async () => {},
        },
      ),
    ).rejects.toThrow(/starter/i)
  })
})
