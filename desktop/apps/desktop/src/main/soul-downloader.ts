/**
 * Soul Download Manager — downloads and caches persona assets from the desktop catalog.
 *
 * Flow:
 * 1. Fetch manifest from /api/desktop/catalog/{catalogId}
 * 2. For starter: download each file (sprite.png, sprite-config.json) directly
 * 3. For soul: try persona-bundle endpoint first (handles auth), fall back to Walrus blob
 * 4. Write downloaded files to cache via cache-manager
 * 5. Return the cached sprite ID
 */

import { cacheSprite, hasCachedSprite } from './cache-manager'

// ── Types ────────────────────────────────────────────────

export interface SoulDownloadRequest {
  catalogId: string
}

export interface SoulDownloadProgress {
  catalogId: string
  phase: 'manifest' | 'metadata' | 'downloading' | 'caching' | 'complete' | 'error'
  progress: number // 0-100
  error?: string
}

type ProgressCallback = (progress: SoulDownloadProgress) => void

interface ManifestFile {
  path: string
  url: string
  checksum: string
}

interface CatalogManifest {
  id: string
  sourceType: 'starter' | 'soul'
  sourceRef: string
  title: string
  version: string
  checksum: string
  downloadMode?: 'direct' | 'authenticated'
  routeId?: string
  onChainId?: string
  files: ManifestFile[]
}

// ── Bundle format ────────────────────────────────────────
// Soul bundles use a simple header+data format:
//   [4 bytes: header length (big-endian uint32)]
//   [JSON header with file entries]
//   [concatenated file data]

interface BundleFileEntry {
  path: string
  offset: number
  size: number
}

interface BundleHeader {
  files: BundleFileEntry[]
}

interface PersonaBundleMetadata {
  blobUrl: string
  blobId: string
  isEncrypted: boolean
}

function parseSoulBundle(data: Buffer): { sprite: Buffer | null; config: string | null } {
  if (data.length < 4) {
    return { sprite: null, config: null }
  }

  const headerLength = data.readUInt32BE(0)
  if (data.length < 4 + headerLength) {
    return { sprite: null, config: null }
  }

  let header: BundleHeader
  try {
    header = JSON.parse(data.subarray(4, 4 + headerLength).toString('utf-8')) as BundleHeader
  } catch {
    return { sprite: null, config: null }
  }

  const dataStart = 4 + headerLength
  let sprite: Buffer | null = null
  let config: string | null = null

  for (const entry of header.files) {
    const start = dataStart + entry.offset
    const end = start + entry.size
    if (end > data.length) continue

    const slice = data.subarray(start, end)

    if (entry.path === 'sprite.png' || entry.path.endsWith('/sprite.png')) {
      sprite = Buffer.from(slice)
    } else if (entry.path === 'sprite-config.json' || entry.path.endsWith('/sprite-config.json')) {
      config = slice.toString('utf-8')
    }
  }

  return { sprite, config }
}

function isPersonaBundleMetadata(value: unknown): value is PersonaBundleMetadata {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<PersonaBundleMetadata>
  return (
    typeof candidate.blobUrl === 'string'
    && typeof candidate.blobId === 'string'
    && typeof candidate.isEncrypted === 'boolean'
  )
}

function bundleLooksComplete(parsed: { sprite: Buffer | null; config: string | null }): boolean {
  return Boolean(parsed.sprite && parsed.config)
}

async function readBundleBytes(response: Response): Promise<Buffer> {
  const contentType = response.headers?.get?.('content-type')?.toLowerCase() ?? ''

  if (contentType.includes('application/json')) {
    const metadata = await response.json()
    if (!isPersonaBundleMetadata(metadata)) {
      throw new Error('Persona bundle endpoint returned invalid metadata')
    }

    const blobRes = await fetch(metadata.blobUrl, {})
    if (!blobRes.ok) {
      throw new Error(`Failed to download soul bundle blob: ${blobRes.status} ${blobRes.statusText}`)
    }

    return Buffer.from(await blobRes.arrayBuffer())
  }

  return Buffer.from(await response.arrayBuffer())
}

// ── Helpers ──────────────────────────────────────────────

function spriteIdForCatalog(catalogId: string): string {
  return `catalog-${catalogId}`
}

function emitProgress(
  callback: ProgressCallback | undefined,
  catalogId: string,
  phase: SoulDownloadProgress['phase'],
  progress: number,
  error?: string,
): void {
  callback?.({ catalogId, phase, progress, error })
}

// ── Main download function ───────────────────────────────

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

  // ── Cache hit — skip download ──────────────────────────
  if (hasCachedSprite(spriteId)) {
    emitProgress(onProgress, catalogId, 'complete', 100)
    return { catalogId, spriteId }
  }

  try {
    // ── Phase 1: Fetch manifest ──────────────────────────
    emitProgress(onProgress, catalogId, 'manifest', 0)

    const manifestUrl = `${webBaseUrl}/api/desktop/catalog/${catalogId}`
    const manifestHeaders: Record<string, string> = {}
    if (desktopToken) {
      manifestHeaders['Authorization'] = `Bearer ${desktopToken}`
    }

    const manifestRes = await fetch(manifestUrl, { headers: manifestHeaders })
    if (!manifestRes.ok) {
      const msg = `Failed to fetch manifest: ${manifestRes.status} ${manifestRes.statusText}`
      emitProgress(onProgress, catalogId, 'error', 0, msg)
      return { error: msg }
    }

    const manifest = (await manifestRes.json()) as CatalogManifest
    emitProgress(onProgress, catalogId, 'manifest', 10)

    // ── Phase 2: Download assets ─────────────────────────
    let sprite: Buffer | null = null
    let config: string | null = null

    if (manifest.sourceType === 'starter' || manifest.downloadMode === 'direct') {
      // Starter persona: download individual files directly
      const result = await downloadStarterFiles(manifest, catalogId, onProgress)
      if ('error' in result) {
        emitProgress(onProgress, catalogId, 'error', 0, result.error)
        return result
      }
      sprite = result.sprite
      config = result.config
    } else {
      // Soul persona: try persona-bundle endpoint, fall back to direct Walrus
      const result = await downloadSoulBundle(
        manifest,
        catalogId,
        webBaseUrl,
        desktopToken,
        onProgress,
      )
      if ('error' in result) {
        emitProgress(onProgress, catalogId, 'error', 0, result.error)
        return result
      }
      sprite = result.sprite
      config = result.config
    }

    // ── Phase 3: Cache assets ────────────────────────────
    if (!sprite || !config) {
      const msg = 'Downloaded soul persona bundle is incomplete'
      emitProgress(onProgress, catalogId, 'error', 0, msg)
      return { error: msg }
    }

    emitProgress(onProgress, catalogId, 'caching', 80)

    cacheSprite(
      spriteId,
      {
        sprite,
        config,
      },
      {
        spriteId,
        source: 'desktop-catalog',
        version: manifest.version,
        catalogSourceType: manifest.sourceType,
        catalogSourceRef: manifest.sourceRef,
      },
    )

    emitProgress(onProgress, catalogId, 'caching', 95)

    // ── Complete ─────────────────────────────────────────
    emitProgress(onProgress, catalogId, 'complete', 100)
    return { catalogId, spriteId }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    emitProgress(onProgress, catalogId, 'error', 0, msg)
    return { error: msg }
  }
}

// ── Starter: download individual files ───────────────────

async function downloadStarterFiles(
  manifest: CatalogManifest,
  catalogId: string,
  onProgress?: ProgressCallback,
): Promise<{ sprite: Buffer | null; config: string | null } | { error: string }> {
  let sprite: Buffer | null = null
  let config: string | null = null

  const fileCount = manifest.files.length
  for (let i = 0; i < fileCount; i++) {
    const file = manifest.files[i]!
    const fileProgress = 10 + Math.round(((i + 1) / fileCount) * 70)
    emitProgress(onProgress, catalogId, 'downloading', 10 + Math.round((i / fileCount) * 70))

    const res = await fetch(file.url, {})
    if (!res.ok) {
      return { error: `Failed to download ${file.path}: ${res.status} ${res.statusText}` }
    }

    if (file.path === 'sprite.png' || file.path.endsWith('/sprite.png')) {
      const ab = await res.arrayBuffer()
      sprite = Buffer.from(ab)
    } else if (file.path === 'sprite-config.json' || file.path.endsWith('/sprite-config.json')) {
      config = await res.text()
    }

    emitProgress(onProgress, catalogId, 'downloading', fileProgress)
  }

  return { sprite, config }
}

// ── Soul: download bundle via persona-bundle or direct ───

async function downloadSoulBundle(
  manifest: CatalogManifest,
  catalogId: string,
  webBaseUrl: string,
  desktopToken?: string | null,
  onProgress?: ProgressCallback,
): Promise<{ sprite: Buffer | null; config: string | null } | { error: string }> {
  emitProgress(onProgress, catalogId, 'downloading', 10)

  const bundleUrl = `${webBaseUrl}/api/desktop/souls/${catalogId}/persona-bundle`
  const headers: Record<string, string> = {}
  if (desktopToken) {
    headers['Authorization'] = `Bearer ${desktopToken}`
  }

  // Try persona-bundle endpoint first
  const bundleRes = await fetch(bundleUrl, { headers })

  if (bundleRes.ok) {
    try {
      const bundleData = await readBundleBytes(bundleRes)
      emitProgress(onProgress, catalogId, 'downloading', 70)

      if (bundleData.length > 0) {
        const parsed = parseSoulBundle(bundleData)
        if (bundleLooksComplete(parsed)) {
          emitProgress(onProgress, catalogId, 'downloading', 80)
          return { sprite: parsed.sprite, config: parsed.config }
        }
      }
    } catch {
      // Fall through to the direct Walrus URL as a recovery path.
    }
  }

  // Fall back to direct Walrus blob URL
  const directUrl = manifest.files[0]?.url
  if (!directUrl) {
    return { error: 'No download URL available for soul bundle' }
  }

  emitProgress(onProgress, catalogId, 'downloading', 30)
  const directRes = await fetch(directUrl, {})
  if (!directRes.ok) {
    return { error: `Failed to download soul bundle: ${directRes.status} ${directRes.statusText}` }
  }

  const bundleData = Buffer.from(await directRes.arrayBuffer())
  emitProgress(onProgress, catalogId, 'downloading', 70)

  if (bundleData.length === 0) {
    return { error: 'Downloaded soul bundle is empty' }
  }

  const parsed = parseSoulBundle(bundleData)
  if (!bundleLooksComplete(parsed)) {
    return { error: 'Downloaded soul bundle is incomplete' }
  }

  emitProgress(onProgress, catalogId, 'downloading', 80)
  return { sprite: parsed.sprite, config: parsed.config }
}
