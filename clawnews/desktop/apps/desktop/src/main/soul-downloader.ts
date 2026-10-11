/**
 * Soul Download Manager — downloads and caches persona assets from the desktop catalog.
 *
 * Flow:
 * 1. Fetch manifest from /api/desktop/catalog/{catalogId}
 * 2. Starter personas still download direct files from the manifest
 * 3. Soul personas download via normalized sprite metadata
 * 4. Cache canonical files as persona-sprite.*
 */

import { cacheSprite, hasCachedSprite } from './cache-manager'

export interface SoulDownloadRequest {
  catalogId: string
}

export interface SoulDownloadProgress {
  catalogId: string
  phase: 'manifest' | 'metadata' | 'downloading' | 'caching' | 'complete' | 'error'
  progress: number
  error?: string
}

type ProgressCallback = (progress: SoulDownloadProgress) => void

type SoulSpriteDownloadPolicy = 'public' | 'owner_only' | 'allowlist' | 'missing' | 'invalid'

interface ManifestFile {
  path: string
  url: string
  checksum: string
}

interface SpriteConfig {
  src: string
  frameWidth: number
  frameHeight: number
  columns: number
  animations: Record<string, {
    frames: number[]
    fps: number
    loop: boolean
  }>
}

interface CatalogManifest {
  id: string
  sourceType: 'starter' | 'soul'
  sourceRef: string
  title: string
  version: string
  checksum: string
  downloadMode?: 'direct' | 'authenticated'
  files: ManifestFile[]
  sprite: {
    assetName?: string | null
    versionIndex?: number | null
    contentOnChainId?: string | null
    downloadPolicy: SoulSpriteDownloadPolicy
    publicUrl?: string | null
    config?: SpriteConfig | null
    privateAccess?: unknown
    error?: string | null
  } | null
}

function isProtectedSpritePolicy(
  value: SoulSpriteDownloadPolicy | null | undefined,
): value is 'owner_only' | 'allowlist' {
  return value === 'owner_only' || value === 'allowlist'
}

function spriteIdForCatalog(catalogId: string): string {
  return `catalog-${catalogId}`
}

function emitProgress(
  callback: ProgressCallback | undefined,
  catalogId: string,
  phase: SoulDownloadProgress['phase'],
  progress: number,
  error?: string,
) {
  callback?.({ catalogId, phase, progress, error })
}

function isSpriteFilePath(value: string) {
  return (
    value === 'persona-sprite.png'
    || value === 'sprite.png'
    || value.endsWith('/persona-sprite.png')
    || value.endsWith('/sprite.png')
  )
}

function isSpriteConfigFilePath(value: string) {
  return (
    value === 'persona-sprite-config.json'
    || value === 'sprite-config.json'
    || value.endsWith('/persona-sprite-config.json')
    || value.endsWith('/sprite-config.json')
  )
}

async function downloadStarterFiles(
  manifest: CatalogManifest,
  catalogId: string,
  onProgress?: ProgressCallback,
): Promise<{ sprite: Buffer | null; config: string | null } | { error: string }> {
  let sprite: Buffer | null = null
  let config: string | null = null

  if (manifest.files.length === 0) {
    return { error: 'Starter manifest is missing downloadable files' }
  }

  for (let index = 0; index < manifest.files.length; index += 1) {
    const file = manifest.files[index]!
    emitProgress(onProgress, catalogId, 'downloading', 10 + Math.round((index / manifest.files.length) * 70))

    const response = await fetch(file.url)
    if (!response.ok) {
      return { error: `Failed to download ${file.path}: ${response.status} ${response.statusText}` }
    }

    if (isSpriteFilePath(file.path)) {
      sprite = Buffer.from(await response.arrayBuffer())
    } else if (isSpriteConfigFilePath(file.path)) {
      config = await response.text()
    }

    emitProgress(onProgress, catalogId, 'downloading', 10 + Math.round(((index + 1) / manifest.files.length) * 70))
  }

  return { sprite, config }
}

async function downloadPublicSoulSprite(
  manifest: CatalogManifest,
  catalogId: string,
  onProgress?: ProgressCallback,
): Promise<{ sprite: Buffer | null; config: string | null } | { error: string }> {
  const sprite = manifest.sprite
  if (!sprite || sprite.downloadPolicy !== 'public') {
    return { error: 'Soul sprite is not publicly downloadable' }
  }
  if (!sprite.publicUrl) {
    return { error: 'Soul sprite URL is missing from metadata' }
  }
  if (!sprite.config) {
    return { error: 'Soul sprite config is missing from metadata' }
  }

  emitProgress(onProgress, catalogId, 'metadata', 15)
  emitProgress(onProgress, catalogId, 'downloading', 30)

  const response = await fetch(sprite.publicUrl)
  if (!response.ok) {
    return { error: `Failed to download sprite: ${response.status} ${response.statusText}` }
  }

  const spriteBytes = Buffer.from(await response.arrayBuffer())
  emitProgress(onProgress, catalogId, 'downloading', 80)

  return {
    sprite: spriteBytes,
    config: JSON.stringify(sprite.config),
  }
}

export async function downloadSoulPersona(
  request: SoulDownloadRequest,
  options: {
    webBaseUrl: string
    desktopToken?: string | null
    onProgress?: ProgressCallback
  },
): Promise<{ catalogId: string; spriteId: string } | { error: string }> {
  const { catalogId } = request
  const { webBaseUrl, desktopToken, onProgress } = options
  const spriteId = spriteIdForCatalog(catalogId)

  if (hasCachedSprite(spriteId)) {
    emitProgress(onProgress, catalogId, 'complete', 100)
    return { catalogId, spriteId }
  }

  try {
    emitProgress(onProgress, catalogId, 'manifest', 0)

    const manifestHeaders: Record<string, string> = {}
    if (desktopToken) {
      manifestHeaders.Authorization = `Bearer ${desktopToken}`
    }

    const manifestUrl = `${webBaseUrl}/api/desktop/catalog/${encodeURIComponent(catalogId)}`
    const manifestResponse = await fetch(manifestUrl, { headers: manifestHeaders })
    if (!manifestResponse.ok) {
      const message = `Failed to fetch manifest: ${manifestResponse.status} ${manifestResponse.statusText}`
      emitProgress(onProgress, catalogId, 'error', 0, message)
      return { error: message }
    }

    const manifest = (await manifestResponse.json()) as CatalogManifest
    emitProgress(onProgress, catalogId, 'manifest', 10)

    const downloaded = manifest.sourceType === 'starter' || manifest.downloadMode === 'direct'
      ? await downloadStarterFiles(manifest, catalogId, onProgress)
      : await downloadPublicSoulSprite(manifest, catalogId, onProgress)

    if ('error' in downloaded) {
      emitProgress(onProgress, catalogId, 'error', 0, downloaded.error)
      return downloaded
    }

    if (!downloaded.sprite || !downloaded.config) {
      const message = manifest.sourceType === 'starter'
        ? 'Starter persona download is incomplete'
        : isProtectedSpritePolicy(manifest.sprite?.downloadPolicy)
          ? 'Protected soul sprites must be downloaded from My Souls with desktop wallet auth'
          : manifest.sprite?.error ?? 'Downloaded soul sprite is incomplete'
      emitProgress(onProgress, catalogId, 'error', 0, message)
      return { error: message }
    }

    emitProgress(onProgress, catalogId, 'caching', 85)
    cacheSprite(
      spriteId,
      {
        sprite: downloaded.sprite,
        config: downloaded.config,
      },
      {
        spriteId,
        source: 'desktop-catalog',
        version: manifest.version,
        catalogSourceType: manifest.sourceType,
        catalogSourceRef: manifest.sourceRef,
      },
    )

    emitProgress(onProgress, catalogId, 'complete', 100)
    return { catalogId, spriteId }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    emitProgress(onProgress, catalogId, 'error', 0, message)
    return { error: message }
  }
}
