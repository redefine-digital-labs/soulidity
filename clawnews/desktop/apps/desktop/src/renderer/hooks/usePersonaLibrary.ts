import { useState, useEffect, useCallback, useRef } from 'react'

type PersonaSpriteDownloadPolicy = 'public' | 'owner_only' | 'allowlist' | 'missing' | 'invalid'

/** Mirrors `DesktopAgentSpriteGrant` from web/lib/types/desktop.ts. */
export interface AgentSpriteGrantSummary {
  active: boolean
  grantOnChainId: string
  expiresAt: string | null
}

export interface PersonaItem {
  catalogId: string
  sourceType: 'starter' | 'soul'
  sourceRef: string
  title: string
  description: string | null
  thumbnail: string
  coverImage: string
  downloadMode?: 'direct' | 'authenticated'
  listingStatus: 'held' | 'listed' | 'floor-violation' | null
  listedPriceAtomic: string | null
  spriteDownloadPolicy: PersonaSpriteDownloadPolicy
  /**
   * Phase 2: live `SoulContent.active_table[KIND_SPRITE]` projection. When
   * present and different from the user's cached version, the UI shows an
   * "Update available" hint.
   */
  activeSpriteName?: string | null
  activeSpriteVersionIndex?: number | null
  /**
   * Set on My Souls items when the desktop pet has an active asset-scope
   * `SoulGrant` for this Soul. `null` means no active grant — the
   * protected Download button should surface "Authorize on web" rather
   * than attempting a Seal session that the manifest route will reject.
   */
  agentSpriteGrant?: AgentSpriteGrantSummary | null
  isCached: boolean
  isActive: boolean
  downloadProgress: number | null
  downloadError: string | null
}

interface CacheMeta {
  spriteId: string
  source: string
  version: string
  downloadedAt: number
  size: number
  catalogSourceType?: 'starter' | 'soul'
  catalogSourceRef?: string
}

interface CatalogItem {
  id: string
  sourceType: 'starter' | 'soul'
  sourceRef: string
  title: string
  description: string | null
  thumbnail: string
  coverImage: string
  downloadMode?: 'direct' | 'authenticated'
  listingStatus: 'held' | 'listed' | 'floor-violation' | null
  listedPriceAtomic: string | null
  spriteDownloadPolicy: PersonaSpriteDownloadPolicy
  activeSpriteName?: string | null
  activeSpriteVersionIndex?: number | null
  agentSpriteGrant?: AgentSpriteGrantSummary | null
}

interface CatalogPage {
  items: CatalogItem[]
  page: number
  pageSize: number
  hasMore: boolean
}

interface LibraryState {
  activePersona: PersonaItem | null
  downloaded: PersonaItem[]
  mySouls: PersonaItem[]
  marketplace: PersonaItem[]
  isLinked: boolean
  isLoading: boolean
  marketplacePage: number
  hasMoreMarketplace: boolean
}

interface LibraryActions {
  downloadPersona: (catalogId: string) => Promise<void>
  activatePersona: (catalogId: string) => Promise<void>
  resetToDefault: () => Promise<void>
  removePersona: (catalogId: string) => Promise<void>
  loadMoreMarketplace: () => Promise<void>
  refresh: () => Promise<void>
}

type ProtectedDownloadResult = { error?: string } | void

interface UsePersonaLibraryOptions {
  downloadProtectedSoul?: (item: PersonaItem) => Promise<ProtectedDownloadResult>
}

async function safeInvoke<T>(fn: (() => Promise<T>) | undefined): Promise<T | null> {
  if (!fn) return null
  try {
    return await fn()
  } catch {
    return null
  }
}

function spriteIdForCatalog(catalogId: string): string {
  return `catalog-${catalogId}`
}

function isProtectedSpritePolicy(
  value: PersonaSpriteDownloadPolicy | null | undefined,
): value is 'owner_only' | 'allowlist' {
  return value === 'owner_only' || value === 'allowlist'
}

const DEFAULT_WALRUS_PREVIEW_URL = new URL('../../../../../data/assets/walrus_primary.png', import.meta.url).href

const DEFAULT_PERSONA: PersonaItem = {
  catalogId: '__default__',
  sourceType: 'starter',
  sourceRef: 'built-in',
  title: 'Walrus',
  description: 'Built-in default persona with 7 mood animations',
  thumbnail: DEFAULT_WALRUS_PREVIEW_URL,
  coverImage: DEFAULT_WALRUS_PREVIEW_URL,
  listingStatus: null,
  listedPriceAtomic: null,
  spriteDownloadPolicy: 'public',
  isCached: true,
  isActive: true,
  downloadProgress: null,
  downloadError: null,
}

export function usePersonaLibrary(options: UsePersonaLibraryOptions = {}): LibraryState & LibraryActions {
  const [state, setState] = useState<LibraryState>({
    activePersona: { ...DEFAULT_PERSONA },
    downloaded: [],
    mySouls: [],
    marketplace: [],
    isLinked: false,
    isLoading: true,
    marketplacePage: 0,
    hasMoreMarketplace: false,
  })

  const progressMapRef = useRef<Map<string, number>>(new Map())
  const errorMapRef = useRef<Map<string, string>>(new Map())

  const loadCachedSprites = useCallback(async (): Promise<CacheMeta[]> => {
    const list = await safeInvoke(() => window.electronAPI.cacheList())
    return (list ?? []) as CacheMeta[]
  }, [])

  const loadActiveId = useCallback(async (): Promise<string | null> => {
    const api = window.electronAPI as Record<string, unknown>
    const fn = api.soulGetActive as (() => Promise<{ catalogId?: string } | null>) | undefined
    if (!fn) return null
    try {
      const result = await fn()
      return result?.catalogId ?? null
    } catch {
      return null
    }
  }, [])

  const checkLinked = useCallback(async (): Promise<boolean> => {
    try {
      const status = await window.electronAPI.getDesktopAuthStatus()
      return status.hasToken
    } catch {
      return false
    }
  }, [])

  const fetchMarketplacePage = useCallback(async (page: number): Promise<CatalogPage | null> => {
    const api = window.electronAPI as Record<string, unknown>
    const fn = api.soulFetchCatalog as ((params: { page: number; pageSize: number }) => Promise<CatalogPage>) | undefined
    if (!fn) return null
    try {
      return await fn({ page, pageSize: 12 })
    } catch {
      return null
    }
  }, [])

  const fetchMySouls = useCallback(async (): Promise<CatalogItem[]> => {
    const api = window.electronAPI as Record<string, unknown>
    const fn = api.soulGetMySouls as (() => Promise<CatalogItem[]>) | undefined
    if (!fn) return []
    try {
      return (await fn()) ?? []
    } catch {
      return []
    }
  }, [])

  const buildPersonaItem = useCallback((
    item: CatalogItem,
    cachedIds: Set<string>,
    activeId: string | null,
  ): PersonaItem => {
    const spriteId = spriteIdForCatalog(item.id)
    return {
      catalogId: item.id,
      sourceType: item.sourceType,
      sourceRef: item.sourceRef,
      title: item.title,
      description: item.description,
      thumbnail: item.thumbnail,
      coverImage: item.coverImage,
      downloadMode: item.downloadMode,
      listingStatus: item.listingStatus,
      listedPriceAtomic: item.listedPriceAtomic,
      spriteDownloadPolicy: item.spriteDownloadPolicy,
      activeSpriteName: item.activeSpriteName ?? null,
      activeSpriteVersionIndex: item.activeSpriteVersionIndex ?? null,
      agentSpriteGrant: item.agentSpriteGrant ?? null,
      isCached: cachedIds.has(spriteId),
      isActive: item.id === activeId,
      downloadProgress: progressMapRef.current.get(item.id) ?? null,
      downloadError: errorMapRef.current.get(item.id) ?? null,
    }
  }, [])

  const refresh = useCallback(async () => {
    setState((previous) => ({ ...previous, isLoading: true }))

    try {
      const [cached, activeId, linked, catalogPage, mySoulItems] = await Promise.all([
        loadCachedSprites(),
        loadActiveId(),
        checkLinked(),
        fetchMarketplacePage(1),
        checkLinked().then((isLinked) => (isLinked ? fetchMySouls() : [])),
      ])

      const cachedIds = new Set(cached.map((entry) => entry.spriteId))

      const downloadedItems: PersonaItem[] = cached.map((meta) => ({
        catalogId: meta.spriteId.replace(/^catalog-/, ''),
        sourceType: meta.catalogSourceType ?? 'starter',
        sourceRef: meta.catalogSourceRef ?? meta.source,
        title: meta.spriteId.replace(/^catalog-/, ''),
        description: null,
        thumbnail: '',
        coverImage: '',
        listingStatus: null,
        listedPriceAtomic: null,
        spriteDownloadPolicy: 'public',
        isCached: true,
        isActive: meta.spriteId.replace(/^catalog-/, '') === activeId,
        downloadProgress: progressMapRef.current.get(meta.spriteId.replace(/^catalog-/, '')) ?? null,
        downloadError: errorMapRef.current.get(meta.spriteId.replace(/^catalog-/, '')) ?? null,
      }))

      const marketplaceItems = (catalogPage?.items ?? []).map((item) => buildPersonaItem(item, cachedIds, activeId))
      const mySoulPersonas = mySoulItems.map((item) => buildPersonaItem(item, cachedIds, activeId))

      const marketMap = new Map(marketplaceItems.map((item) => [item.catalogId, item]))
      const mySoulMap = new Map(mySoulPersonas.map((item) => [item.catalogId, item]))
      const enrichedDownloaded = downloadedItems.map((item) => {
        const richer = marketMap.get(item.catalogId) ?? mySoulMap.get(item.catalogId)
        if (!richer) {
          return item
        }
        return {
          ...richer,
          isCached: true,
          isActive: item.isActive,
          downloadProgress: item.downloadProgress,
          downloadError: item.downloadError,
        }
      })

      let active: PersonaItem | null = null
      if (activeId) {
        active = (
          enrichedDownloaded.find((item) => item.catalogId === activeId)
          ?? marketplaceItems.find((item) => item.catalogId === activeId)
          ?? mySoulPersonas.find((item) => item.catalogId === activeId)
          ?? null
        )
        if (active) {
          active = { ...active, isActive: true }
        }
      }
      if (!active) {
        active = { ...DEFAULT_PERSONA }
      }

      setState({
        activePersona: active,
        downloaded: enrichedDownloaded.filter((item) => !item.isActive),
        mySouls: mySoulPersonas,
        marketplace: marketplaceItems,
        isLinked: linked,
        isLoading: false,
        marketplacePage: catalogPage?.page ?? 1,
        hasMoreMarketplace: catalogPage?.hasMore ?? false,
      })
    } catch {
      setState((previous) => ({
        ...previous,
        activePersona: previous.activePersona ?? { ...DEFAULT_PERSONA },
        isLoading: false,
      }))
    }
  }, [buildPersonaItem, checkLinked, fetchMarketplacePage, fetchMySouls, loadActiveId, loadCachedSprites])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const setItemDownloadState = useCallback((catalogId: string, params: {
    progress?: number | null
    error?: string | null
  }) => {
    if (params.progress == null) {
      progressMapRef.current.delete(catalogId)
    } else {
      progressMapRef.current.set(catalogId, params.progress)
    }

    if (!params.error) {
      errorMapRef.current.delete(catalogId)
    } else {
      errorMapRef.current.set(catalogId, params.error)
    }

    setState((previous) => ({
      ...previous,
      marketplace: previous.marketplace.map((item) =>
        item.catalogId === catalogId
          ? { ...item, downloadProgress: params.progress ?? null, downloadError: params.error ?? null }
          : item),
      mySouls: previous.mySouls.map((item) =>
        item.catalogId === catalogId
          ? { ...item, downloadProgress: params.progress ?? null, downloadError: params.error ?? null }
          : item),
      downloaded: previous.downloaded.map((item) =>
        item.catalogId === catalogId
          ? { ...item, downloadProgress: params.progress ?? null, downloadError: params.error ?? null }
          : item),
    }))
  }, [])

  const downloadPersona = useCallback(async (catalogId: string) => {
    const api = window.electronAPI as Record<string, unknown>
    const downloadFn = api.soulDownload as ((params: { catalogId: string }) => Promise<{ error?: string }>) | undefined

    const allItems = [...state.marketplace, ...state.mySouls, ...state.downloaded]
    const item = allItems.find((candidate) => candidate.catalogId === catalogId)

    setItemDownloadState(catalogId, { progress: 0, error: null })

    const onProgressFn = api.onDownloadProgress as
      | ((cb: (data: { catalogId: string; progress: number }) => void) => () => void)
      | undefined

    const unsubscribe = onProgressFn?.((data) => {
      if (data.catalogId !== catalogId) return
      setItemDownloadState(catalogId, { progress: data.progress, error: null })
    })

    try {
      let failure: string | null = null

      if (isProtectedSpritePolicy(item?.spriteDownloadPolicy)) {
        if (!options.downloadProtectedSoul || !item) {
          failure = 'Protected soul downloads require the desktop wallet session.'
        } else {
          const result = await options.downloadProtectedSoul(item)
          if (result?.error) {
            failure = result.error
          }
        }
      } else if (item?.spriteDownloadPolicy === 'missing') {
        failure = 'Sprite metadata is missing for this soul.'
      } else if (item?.spriteDownloadPolicy === 'invalid') {
        failure = 'Sprite metadata is invalid for this soul.'
      } else if (downloadFn) {
        const result = await downloadFn({ catalogId })
        if (result?.error) {
          failure = result.error
        }
      } else {
        failure = 'Desktop downloader is not available.'
      }

      if (failure) {
        setItemDownloadState(catalogId, { progress: null, error: failure })
      }
    } catch (error) {
      setItemDownloadState(catalogId, {
        progress: null,
        error: error instanceof Error ? error.message : 'Download failed',
      })
    } finally {
      unsubscribe?.()
      if (!errorMapRef.current.has(catalogId)) {
        setItemDownloadState(catalogId, { progress: null, error: null })
      }
      await refresh()
    }
  }, [options, refresh, setItemDownloadState, state.downloaded, state.marketplace, state.mySouls])

  const activatePersona = useCallback(async (catalogId: string) => {
    const api = window.electronAPI as Record<string, unknown>
    const fn = api.soulSetActive as ((params: {
      catalogId: string
      sourceType: string
      sourceRef: string
    } | null) => Promise<void>) | undefined

    const allItems = [...state.marketplace, ...state.mySouls, ...state.downloaded]
    const item = allItems.find((candidate) => candidate.catalogId === catalogId)

    try {
      await fn?.({
        catalogId,
        sourceType: item?.sourceType ?? 'starter',
        sourceRef: item?.sourceRef ?? catalogId,
      })
    } catch {
      // graceful degradation when IPC is absent
    }
    await refresh()
  }, [refresh, state.downloaded, state.marketplace, state.mySouls])

  const resetToDefault = useCallback(async () => {
    const api = window.electronAPI as Record<string, unknown>
    const fn = api.soulSetActive as ((params: null) => Promise<void>) | undefined
    try {
      await fn?.(null)
    } catch {
      // graceful degradation when IPC is absent
    }
    await refresh()
  }, [refresh])

  const removePersona = useCallback(async (catalogId: string) => {
    const spriteId = spriteIdForCatalog(catalogId)
    try {
      await window.electronAPI.cacheRemoveSprite(spriteId)
    } catch {
      // cache removal failed
    }
    await refresh()
  }, [refresh])

  const loadMoreMarketplace = useCallback(async () => {
    const nextPage = state.marketplacePage + 1
    const catalogPage = await fetchMarketplacePage(nextPage)
    if (!catalogPage || catalogPage.items.length === 0) return

    const cached = await loadCachedSprites()
    const cachedIds = new Set(cached.map((entry) => entry.spriteId))
    const activeId = await loadActiveId()
    const newItems = catalogPage.items.map((item) => buildPersonaItem(item, cachedIds, activeId))

    setState((previous) => ({
      ...previous,
      marketplace: [...previous.marketplace, ...newItems],
      marketplacePage: catalogPage.page,
      hasMoreMarketplace: catalogPage.hasMore,
    }))
  }, [buildPersonaItem, fetchMarketplacePage, loadActiveId, loadCachedSprites, state.marketplacePage])

  return {
    ...state,
    downloadPersona,
    activatePersona,
    resetToDefault,
    removePersona,
    loadMoreMarketplace,
    refresh,
  }
}
