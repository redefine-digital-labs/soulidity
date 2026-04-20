import { useState, useEffect, useCallback, useRef } from 'react'

// ── Types ────────────────────────────────────────────────

export interface PersonaItem {
  catalogId: string
  sourceType: 'starter' | 'soul'
  sourceRef: string
  title: string
  description: string | null
  thumbnail: string
  coverImage: string
  downloadMode?: 'direct' | 'authenticated'
  // Local state
  isCached: boolean
  isActive: boolean
  downloadProgress: number | null // null = not downloading, 0-100 = in progress
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

// ── Helpers ──────────────────────────────────────────────

/** Safe IPC invoke — returns null if the method doesn't exist yet */
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

const DEFAULT_PERSONA: PersonaItem = {
  catalogId: '__default__',
  sourceType: 'starter',
  sourceRef: 'built-in',
  title: 'Walrus',
  description: 'Built-in default persona with 7 mood animations',
  thumbnail: '',
  coverImage: '',
  isCached: true,
  isActive: true,
  downloadProgress: null,
}

// ── Hook ─────────────────────────────────────────────────

export function usePersonaLibrary(): LibraryState & LibraryActions {
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

  // Track download progress per catalogId
  const progressMapRef = useRef<Map<string, number>>(new Map())

  // ── Load initial data ──────────────────────────────────

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

  const buildPersonaItem = useCallback(
    (
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
        isCached: cachedIds.has(spriteId),
        isActive: item.id === activeId,
        downloadProgress: progressMapRef.current.get(item.id) ?? null,
      }
    },
    [],
  )

  // ── Full refresh ───────────────────────────────────────

  const refresh = useCallback(async () => {
    setState(prev => ({ ...prev, isLoading: true }))

    const [cached, activeId, linked, catalogPage, mySoulItems] = await Promise.all([
      loadCachedSprites(),
      loadActiveId(),
      checkLinked(),
      fetchMarketplacePage(1),
      checkLinked().then(l => (l ? fetchMySouls() : [])),
    ])

    const cachedIds = new Set(cached.map(c => c.spriteId))

    // Build downloaded list from cache meta — items that exist in cache
    // We need catalog info for proper display; for now, minimal items from cache
    const downloadedItems: PersonaItem[] = cached.map(meta => ({
      catalogId: meta.spriteId.replace(/^catalog-/, ''),
      sourceType: meta.catalogSourceType ?? 'starter',
      sourceRef: meta.catalogSourceRef ?? meta.source,
      title: meta.spriteId.replace(/^catalog-/, ''),
      description: null,
      thumbnail: '',
      coverImage: '',
      isCached: true,
      isActive: meta.spriteId.replace(/^catalog-/, '') === activeId,
      downloadProgress: null,
    }))

    const marketItems = (catalogPage?.items ?? []).map(i =>
      buildPersonaItem(i, cachedIds, activeId),
    )

    const mySoulPersonas = mySoulItems.map(i =>
      buildPersonaItem(i, cachedIds, activeId),
    )

    // Merge marketplace data into downloaded items for richer display
    const marketMap = new Map(marketItems.map(i => [i.catalogId, i]))
    const mySoulMap = new Map(mySoulPersonas.map(i => [i.catalogId, i]))
    const enrichedDownloaded = downloadedItems.map(d => {
      const richer = marketMap.get(d.catalogId) ?? mySoulMap.get(d.catalogId)
      if (richer) return { ...richer, isCached: true, isActive: d.isActive }
      return d
    })

    // Determine active persona
    let active: PersonaItem | null = null
    if (activeId) {
      active =
        enrichedDownloaded.find(d => d.catalogId === activeId) ??
        marketItems.find(i => i.catalogId === activeId) ??
        null
      if (active) active = { ...active, isActive: true }
    }
    if (!active) {
      active = { ...DEFAULT_PERSONA }
    }

    setState({
      activePersona: active,
      downloaded: enrichedDownloaded.filter(d => !d.isActive),
      mySouls: mySoulPersonas,
      marketplace: marketItems,
      isLinked: linked,
      isLoading: false,
      marketplacePage: catalogPage?.page ?? 1,
      hasMoreMarketplace: catalogPage?.hasMore ?? false,
    })
  }, [loadCachedSprites, loadActiveId, checkLinked, fetchMarketplacePage, fetchMySouls, buildPersonaItem])

  // ── Mount ──────────────────────────────────────────────

  useEffect(() => {
    refresh()
  }, [refresh])

  // ── Actions ────────────────────────────────────────────

  const downloadPersona = useCallback(async (catalogId: string) => {
    const api = window.electronAPI as Record<string, unknown>
    const downloadFn = api.soulDownload as ((params: { catalogId: string }) => Promise<unknown>) | undefined

    // Set initial progress
    progressMapRef.current.set(catalogId, 0)
    setState(prev => ({
      ...prev,
      marketplace: prev.marketplace.map(i =>
        i.catalogId === catalogId ? { ...i, downloadProgress: 0 } : i,
      ),
      mySouls: prev.mySouls.map(i =>
        i.catalogId === catalogId ? { ...i, downloadProgress: 0 } : i,
      ),
    }))

    // Listen for progress events
    const onProgressFn = api.onDownloadProgress as
      | ((cb: (data: { catalogId: string; progress: number; phase: string }) => void) => () => void)
      | undefined

    const unsub = onProgressFn?.((data) => {
      if (data.catalogId !== catalogId) return
      progressMapRef.current.set(catalogId, data.progress)
      setState(prev => ({
        ...prev,
        marketplace: prev.marketplace.map(i =>
          i.catalogId === catalogId ? { ...i, downloadProgress: data.progress } : i,
        ),
        mySouls: prev.mySouls.map(i =>
          i.catalogId === catalogId ? { ...i, downloadProgress: data.progress } : i,
        ),
      }))
    })

    try {
      if (downloadFn) {
        await downloadFn({ catalogId })
      }
    } catch {
      // Download failed — reset progress
    } finally {
      unsub?.()
      progressMapRef.current.delete(catalogId)
      // Refresh full state to pick up new cache entries
      await refresh()
    }
  }, [refresh])

  const activatePersona = useCallback(async (catalogId: string) => {
    const api = window.electronAPI as Record<string, unknown>
    const fn = api.soulSetActive as ((params: { catalogId: string; sourceType: string; sourceRef: string }) => Promise<void>) | undefined

    // Look up sourceType/sourceRef from known items
    const allItems = [...state.marketplace, ...state.mySouls, ...state.downloaded]
    const item = allItems.find(i => i.catalogId === catalogId)

    try {
      await fn?.({
        catalogId,
        sourceType: item?.sourceType ?? 'starter',
        sourceRef: item?.sourceRef ?? catalogId,
      })
    } catch {
      // IPC not registered yet — graceful degradation
    }
    await refresh()
  }, [refresh, state.marketplace, state.mySouls, state.downloaded])

  const resetToDefault = useCallback(async () => {
    const api = window.electronAPI as Record<string, unknown>
    const fn = api.soulSetActive as ((params: null) => Promise<void>) | undefined
    try {
      await fn?.(null)
    } catch {
      // IPC not registered yet
    }
    await refresh()
  }, [refresh])

  const removePersona = useCallback(async (catalogId: string) => {
    const spriteId = spriteIdForCatalog(catalogId)
    try {
      await window.electronAPI.cacheRemoveSprite(spriteId)
    } catch {
      // Cache removal failed
    }
    await refresh()
  }, [refresh])

  const loadMoreMarketplace = useCallback(async () => {
    const nextPage = state.marketplacePage + 1
    const catalogPage = await fetchMarketplacePage(nextPage)
    if (!catalogPage || catalogPage.items.length === 0) return

    const cached = await loadCachedSprites()
    const cachedIds = new Set(cached.map(c => c.spriteId))
    const activeId = await loadActiveId()

    const newItems = catalogPage.items.map(i =>
      buildPersonaItem(i, cachedIds, activeId),
    )

    setState(prev => ({
      ...prev,
      marketplace: [...prev.marketplace, ...newItems],
      marketplacePage: catalogPage.page,
      hasMoreMarketplace: catalogPage.hasMore,
    }))
  }, [state.marketplacePage, fetchMarketplacePage, loadCachedSprites, loadActiveId, buildPersonaItem])

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
