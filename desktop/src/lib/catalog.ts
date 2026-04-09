import type { DesktopCatalogItem, DesktopPersonaManifest } from '../../../web/lib/types/desktop.ts'
import type { CatalogCacheRecord } from './persistence'

export interface DesktopCatalogListResponse {
  items: DesktopCatalogItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface DesktopCatalogRefreshResult extends DesktopCatalogListResponse {
  source: 'network' | 'cache'
  stale: boolean
  syncedAt: string | null
  warning: string | null
}

export interface DesktopPersonaManifestLoadResult {
  manifest: DesktopPersonaManifest
  source: 'network' | 'cache'
  stale: boolean
  warning: string | null
}

export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface RefreshDesktopCatalogOptions {
  fetchCatalogPage: () => Promise<DesktopCatalogListResponse>
  loadCache: () => Promise<CatalogCacheRecord | null> | CatalogCacheRecord | null
  now?: () => Date
  page: number
  pageSize: number
  saveCache: (cache: CatalogCacheRecord) => Promise<void> | void
}

export interface LoadDesktopPersonaManifestOptions {
  fetchManifest: () => Promise<DesktopPersonaManifest>
  loadCache: () => Promise<CatalogCacheRecord | null> | CatalogCacheRecord | null
  personaId: string
  saveCache: (cache: CatalogCacheRecord) => Promise<void> | void
}

const BROWSER_CATALOG_CACHE_STORAGE_KEY = 'soulidity.desktop.catalog-cache'

function createEmptyCatalogCache(): CatalogCacheRecord {
  return {
    syncedAt: null,
    items: [],
    manifestsById: {},
  }
}

function toCatalogItemFromManifest(manifest: DesktopPersonaManifest): DesktopCatalogItem {
  return {
    id: manifest.id,
    sourceType: manifest.sourceType,
    sourceRef: manifest.sourceRef,
    title: manifest.title,
    description: manifest.description,
    coverImage: manifest.coverImage,
    thumbnail: manifest.thumbnail,
    updatedAt: manifest.updatedAt,
  }
}

function getResolvedCache(cache: CatalogCacheRecord | null) {
  return cache ?? createEmptyCatalogCache()
}

function withManifestInCache(cache: CatalogCacheRecord, manifest: DesktopPersonaManifest): CatalogCacheRecord {
  const catalogItem = toCatalogItemFromManifest(manifest)
  const nextItems = cache.items.some((item) => item.id === catalogItem.id)
    ? cache.items.map((item) => (item.id === catalogItem.id ? catalogItem : item))
    : [...cache.items, catalogItem]

  return {
    syncedAt: cache.syncedAt,
    items: nextItems,
    manifestsById: {
      ...cache.manifestsById,
      [manifest.id]: manifest,
    },
  }
}

function buildOfflineWarning(syncedAt: string | null) {
  return syncedAt
    ? `Offline fallback active. Showing the latest cached catalog from ${syncedAt}.`
    : 'Offline fallback active. Showing the latest cached catalog.'
}

export async function refreshDesktopCatalog(
  options: RefreshDesktopCatalogOptions,
): Promise<DesktopCatalogRefreshResult> {
  const now = options.now ?? (() => new Date())
  const cachedCatalog = getResolvedCache(await options.loadCache())

  try {
    const response = await options.fetchCatalogPage()
    const nextCache: CatalogCacheRecord = {
      syncedAt: now().toISOString(),
      items: response.items,
      manifestsById: cachedCatalog.manifestsById,
    }

    await options.saveCache(nextCache)

    return {
      ...response,
      source: 'network',
      stale: false,
      syncedAt: nextCache.syncedAt,
      warning: null,
    }
  } catch (error) {
    if (cachedCatalog.items.length === 0) {
      throw error
    }

    return {
      items: cachedCatalog.items,
      total: cachedCatalog.items.length,
      page: options.page,
      pageSize: options.pageSize,
      totalPages: Math.max(1, Math.ceil(cachedCatalog.items.length / options.pageSize)),
      source: 'cache',
      stale: true,
      syncedAt: cachedCatalog.syncedAt,
      warning: buildOfflineWarning(cachedCatalog.syncedAt),
    }
  }
}

export async function loadDesktopPersonaManifest(
  options: LoadDesktopPersonaManifestOptions,
): Promise<DesktopPersonaManifestLoadResult> {
  const cachedCatalog = getResolvedCache(await options.loadCache())

  try {
    const manifest = await options.fetchManifest()
    await options.saveCache(withManifestInCache(cachedCatalog, manifest))

    return {
      manifest,
      source: 'network',
      stale: false,
      warning: null,
    }
  } catch (error) {
    const cachedManifest = cachedCatalog.manifestsById[options.personaId]
    if (!cachedManifest) {
      throw error
    }

    return {
      manifest: cachedManifest,
      source: 'cache',
      stale: true,
      warning: buildOfflineWarning(cachedCatalog.syncedAt),
    }
  }
}

export function filterDesktopCatalogItems(items: DesktopCatalogItem[], query: string) {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) {
    return items
  }

  return items.filter((item) => {
    const keywords = [
      item.title,
      item.description ?? '',
      item.sourceType,
      item.sourceType === 'starter' ? 'starter persona anonymous install' : 'curated soul',
    ]
      .join(' ')
      .toLowerCase()

    return keywords.includes(normalizedQuery)
  })
}

function getDefaultStorage(storage?: KeyValueStorage | null) {
  if (storage) {
    return storage
  }

  if (typeof window === 'undefined') {
    return null
  }

  return window.localStorage
}

export function loadDesktopCatalogCacheFromStorage(storage?: KeyValueStorage | null): CatalogCacheRecord | null {
  const resolvedStorage = getDefaultStorage(storage)
  if (!resolvedStorage) {
    return null
  }

  const rawValue = resolvedStorage.getItem(BROWSER_CATALOG_CACHE_STORAGE_KEY)
  if (!rawValue) {
    return null
  }

  try {
    return JSON.parse(rawValue) as CatalogCacheRecord
  } catch {
    return null
  }
}

export function saveDesktopCatalogCacheToStorage(cache: CatalogCacheRecord, storage?: KeyValueStorage | null) {
  const resolvedStorage = getDefaultStorage(storage)
  if (!resolvedStorage) {
    return
  }

  resolvedStorage.setItem(BROWSER_CATALOG_CACHE_STORAGE_KEY, JSON.stringify(cache))
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  let body: unknown = null

  try {
    body = await response.json()
  } catch {
    body = null
  }

  if (!response.ok) {
    const errorMessage = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
      ? body.error
      : `Desktop catalog request failed with status ${response.status}`
    throw new Error(errorMessage)
  }

  return body as T
}

export async function fetchDesktopCatalogPageFromApi(page: number, pageSize: number) {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  })
  const response = await fetch(`/api/desktop/catalog?${params.toString()}`)
  return parseJsonResponse<DesktopCatalogListResponse>(response)
}

export async function fetchDesktopPersonaManifestFromApi(personaId: string) {
  const response = await fetch(`/api/desktop/catalog/${encodeURIComponent(personaId)}`)
  return parseJsonResponse<DesktopPersonaManifest>(response)
}
