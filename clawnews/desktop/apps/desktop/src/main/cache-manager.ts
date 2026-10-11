/**
 * CacheManager — local sprite/persona asset caching.
 *
 * Stores downloaded sprites from the desktop catalog in userData/cache/.
 * Canonical files are `persona-sprite.png` and `persona-sprite-config.json`.
 * Legacy `sprite.png` / `sprite-config.json` are still readable and are
 * migrated to canonical names on the next successful read.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { app } from 'electron'

const CANONICAL_SPRITE_FILE_NAME = 'persona-sprite.png'
const CANONICAL_CONFIG_FILE_NAME = 'persona-sprite-config.json'
const LEGACY_SPRITE_FILE_NAME = 'sprite.png'
const LEGACY_CONFIG_FILE_NAME = 'sprite-config.json'

interface CacheMeta {
  spriteId: string
  source: string
  version: string
  downloadedAt: number
  size: number
  catalogSourceType?: 'starter' | 'soul'
  catalogSourceRef?: string
}

interface CachedSprite {
  meta: CacheMeta
  spritePath: string
  configPath: string
  thumbnailPath: string | null
}

function getCacheDir(): string {
  return path.join(app.getPath('userData'), 'cache')
}

function getSpriteDir(spriteId: string): string {
  const safe = spriteId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return path.join(getCacheDir(), 'sprites', safe)
}

function getThumbnailPath(spriteId: string): string {
  const safe = spriteId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return path.join(getCacheDir(), 'thumbnails', `${safe}.png`)
}

function migrateLegacyFile(dir: string, legacyName: string, canonicalName: string) {
  const canonicalPath = path.join(dir, canonicalName)
  const legacyPath = path.join(dir, legacyName)

  if (fs.existsSync(canonicalPath)) {
    return canonicalPath
  }

  if (!fs.existsSync(legacyPath)) {
    return null
  }

  try {
    fs.renameSync(legacyPath, canonicalPath)
    return canonicalPath
  } catch {
    return legacyPath
  }
}

function resolveCachedAssetPaths(dir: string) {
  const spritePath = migrateLegacyFile(dir, LEGACY_SPRITE_FILE_NAME, CANONICAL_SPRITE_FILE_NAME)
  const configPath = migrateLegacyFile(dir, LEGACY_CONFIG_FILE_NAME, CANONICAL_CONFIG_FILE_NAME)

  if (!spritePath || !configPath) {
    return null
  }

  return { spritePath, configPath }
}

export function hasCachedSprite(spriteId: string): boolean {
  const dir = getSpriteDir(spriteId)
  return fs.existsSync(path.join(dir, 'meta.json')) && resolveCachedAssetPaths(dir) !== null
}

export function getCachedSprite(spriteId: string): CachedSprite | null {
  const dir = getSpriteDir(spriteId)
  const metaPath = path.join(dir, 'meta.json')

  if (!fs.existsSync(metaPath)) {
    return null
  }

  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as CacheMeta
    const assets = resolveCachedAssetPaths(dir)
    if (!assets) {
      return null
    }

    const thumbPath = getThumbnailPath(spriteId)
    return {
      meta,
      spritePath: assets.spritePath,
      configPath: assets.configPath,
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
    fs.writeFileSync(path.join(dir, CANONICAL_SPRITE_FILE_NAME), files.sprite)
    totalSize += files.sprite.length
  }

  if (files.config) {
    fs.writeFileSync(path.join(dir, CANONICAL_CONFIG_FILE_NAME), files.config, 'utf-8')
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
      totalSprites++
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
