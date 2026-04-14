/**
 * CacheManager — local sprite/persona asset caching.
 *
 * Stores downloaded sprites from the Soul marketplace in userData/cache/.
 * Provides cache, get, check, prune, and size operations.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { app } from 'electron'

interface CacheMeta {
  spriteId: string
  source: string // e.g. 'soul-marketplace', 'community', 'local'
  version: string
  downloadedAt: number // epoch ms
  size: number // total bytes
  catalogSourceType?: 'starter' | 'soul'
  catalogSourceRef?: string
}

interface CachedSprite {
  meta: CacheMeta
  spritePath: string // absolute path to sprite.png
  configPath: string // absolute path to sprite-config.json
  thumbnailPath: string | null
}

function getCacheDir(): string {
  return path.join(app.getPath('userData'), 'cache')
}

function getSpriteDir(spriteId: string): string {
  // Sanitize spriteId to prevent directory traversal
  const safe = spriteId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return path.join(getCacheDir(), 'sprites', safe)
}

function getThumbnailPath(spriteId: string): string {
  const safe = spriteId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return path.join(getCacheDir(), 'thumbnails', `${safe}.png`)
}

export function hasCachedSprite(spriteId: string): boolean {
  const dir = getSpriteDir(spriteId)
  return (
    fs.existsSync(path.join(dir, 'meta.json'))
    && fs.existsSync(path.join(dir, 'sprite.png'))
    && fs.existsSync(path.join(dir, 'sprite-config.json'))
  )
}

export function getCachedSprite(spriteId: string): CachedSprite | null {
  const dir = getSpriteDir(spriteId)
  const metaPath = path.join(dir, 'meta.json')

  if (!fs.existsSync(metaPath)) return null

  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as CacheMeta
    const spritePath = path.join(dir, 'sprite.png')
    const configPath = path.join(dir, 'sprite-config.json')
    const thumbPath = getThumbnailPath(spriteId)

    if (!fs.existsSync(spritePath) || !fs.existsSync(configPath)) {
      return null
    }

    return {
      meta,
      spritePath,
      configPath,
      thumbnailPath: fs.existsSync(thumbPath) ? thumbPath : null,
    }
  } catch {
    return null
  }
}

export function cacheSprite(
  spriteId: string,
  files: { sprite?: Buffer; config?: string; thumbnail?: Buffer },
  meta: Omit<CacheMeta, 'downloadedAt' | 'size'>,
): CacheMeta {
  const dir = getSpriteDir(spriteId)
  fs.mkdirSync(dir, { recursive: true })

  let totalSize = 0

  if (files.sprite) {
    fs.writeFileSync(path.join(dir, 'sprite.png'), files.sprite)
    totalSize += files.sprite.length
  }

  if (files.config) {
    fs.writeFileSync(path.join(dir, 'sprite-config.json'), files.config, 'utf-8')
    totalSize += Buffer.byteLength(files.config)
  }

  if (files.thumbnail) {
    const thumbDir = path.join(getCacheDir(), 'thumbnails')
    fs.mkdirSync(thumbDir, { recursive: true })
    fs.writeFileSync(getThumbnailPath(spriteId), files.thumbnail)
    totalSize += files.thumbnail.length
  }

  const fullMeta: CacheMeta = {
    ...meta,
    spriteId,
    downloadedAt: Date.now(),
    size: totalSize,
  }

  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(fullMeta, null, 2), 'utf-8')

  return fullMeta
}

export function removeCachedSprite(spriteId: string): boolean {
  const dir = getSpriteDir(spriteId)
  if (!fs.existsSync(dir)) return false

  fs.rmSync(dir, { recursive: true, force: true })

  const thumbPath = getThumbnailPath(spriteId)
  if (fs.existsSync(thumbPath)) {
    fs.unlinkSync(thumbPath)
  }

  return true
}

export function pruneCache(maxAgeMs: number): number {
  const spritesDir = path.join(getCacheDir(), 'sprites')
  if (!fs.existsSync(spritesDir)) return 0

  const now = Date.now()
  let pruned = 0

  for (const entry of fs.readdirSync(spritesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue

    const metaPath = path.join(spritesDir, entry.name, 'meta.json')
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as CacheMeta
      if (now - meta.downloadedAt > maxAgeMs) {
        removeCachedSprite(meta.spriteId)
        pruned++
      }
    } catch {
      // No valid meta — remove orphan directory
      fs.rmSync(path.join(spritesDir, entry.name), { recursive: true, force: true })
      pruned++
    }
  }

  return pruned
}

export function getCacheStats(): { totalSprites: number; totalBytes: number } {
  const spritesDir = path.join(getCacheDir(), 'sprites')
  if (!fs.existsSync(spritesDir)) return { totalSprites: 0, totalBytes: 0 }

  let totalSprites = 0
  let totalBytes = 0

  for (const entry of fs.readdirSync(spritesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue

    const metaPath = path.join(spritesDir, entry.name, 'meta.json')
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as CacheMeta
      totalSprites++
      totalBytes += meta.size
    } catch {
      totalSprites++ // count even without valid meta
    }
  }

  return { totalSprites, totalBytes }
}

export function listCachedSprites(): CacheMeta[] {
  const spritesDir = path.join(getCacheDir(), 'sprites')
  if (!fs.existsSync(spritesDir)) return []

  const result: CacheMeta[] = []
  for (const entry of fs.readdirSync(spritesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue

    const metaPath = path.join(spritesDir, entry.name, 'meta.json')
    try {
      result.push(JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as CacheMeta)
    } catch {
      /* skip */
    }
  }

  return result.sort((a, b) => b.downloadedAt - a.downloadedAt)
}
