import { describe, expect, it } from 'vitest'

import { resolveDesktopSpriteManifest } from '../../web/lib/desktop/sprite-contract'

const BASE_CONFIG = JSON.stringify({
  frameWidth: 64,
  frameHeight: 64,
  columns: 6,
  animations: {
    idle: { frames: [0, 1], fps: 8, loop: true },
    working: { frames: [2, 3], fps: 8, loop: true },
  },
})

const BASE_MOOD_MAP = JSON.stringify({ idle: 'idle', working: 'working' })

describe('resolveDesktopSpriteManifest', () => {
  it('marks public sprite metadata invalid when the bound public asset is missing', async () => {
    const manifest = await resolveDesktopSpriteManifest({
      metadataOnChainId: '0xmetadata',
      activeSpriteAssetName: 'persona-sprite',
      activeSpriteVersionIndex: 0,
      activeSpriteDownloadPolicy: 'public',
      spriteConfigJson: BASE_CONFIG,
      spriteMoodMapJson: BASE_MOOD_MAP,
      assetVersions: [{
        assetName: 'persona-sprite',
        versionIndex: 0,
        visibility: 'public',
        assetType: 'sprite',
        blobId: null,
        blobObjectId: '0xblob',
      }],
    })

    expect(manifest.downloadPolicy).toBe('invalid')
    expect(manifest.publicUrl).toBeUndefined()
    expect(manifest.error).toContain('public active sprite asset URL is missing')
  })

  it('resolves to a public manifest with walrus URL when the active version is a matching public blob', async () => {
    const manifest = await resolveDesktopSpriteManifest({
      metadataOnChainId: '0xmetadata',
      activeSpriteAssetName: 'persona-sprite',
      activeSpriteVersionIndex: 0,
      activeSpriteDownloadPolicy: 'public',
      spriteConfigJson: BASE_CONFIG,
      spriteMoodMapJson: BASE_MOOD_MAP,
      assetVersions: [{
        assetName: 'persona-sprite',
        versionIndex: 0,
        visibility: 'public',
        assetType: 'sprite',
        blobId: 'SGVsbG9QdWJsaWNCbG9i',
        blobObjectId: '0xblob',
      }],
    })

    expect(manifest.downloadPolicy).toBe('public')
    expect(manifest.publicUrl).toMatch(/\/v1\/blobs\/SGVsbG9QdWJsaWNCbG9i$/)
    expect(manifest.versionIndex).toBe(0)
    expect(manifest.config?.animations.idle).toBeDefined()
  })

  it('falls through to owner_only when the binding policy becomes private and the version is private', async () => {
    const manifest = await resolveDesktopSpriteManifest({
      metadataOnChainId: '0xmetadata',
      activeSpriteAssetName: 'persona-sprite',
      activeSpriteVersionIndex: 1,
      activeSpriteDownloadPolicy: 'owner_only',
      spriteConfigJson: BASE_CONFIG,
      spriteMoodMapJson: BASE_MOOD_MAP,
      assetVersions: [{
        assetName: 'persona-sprite',
        versionIndex: 1,
        visibility: 'private',
        assetType: 'sprite',
        blobId: 'UHJpdmF0ZUNpcGhlckJsb2I',
        blobObjectId: '0xblob-private',
      }],
    })

    expect(manifest.downloadPolicy).toBe('owner_only')
    expect(manifest.publicUrl).toBeUndefined()
    expect(manifest.versionIndex).toBe(1)
    expect(manifest.error).toBeNull()
  })

  it('flags invalid when public policy is bound to a private-visibility version', async () => {
    const manifest = await resolveDesktopSpriteManifest({
      metadataOnChainId: '0xmetadata',
      activeSpriteAssetName: 'persona-sprite',
      activeSpriteVersionIndex: 2,
      activeSpriteDownloadPolicy: 'public',
      spriteConfigJson: BASE_CONFIG,
      spriteMoodMapJson: BASE_MOOD_MAP,
      assetVersions: [{
        assetName: 'persona-sprite',
        versionIndex: 2,
        visibility: 'private',
        assetType: 'sprite',
        blobId: 'U29tZVByaXZhdGVCbG9i',
        blobObjectId: '0xblob-private',
      }],
    })

    expect(manifest.downloadPolicy).toBe('invalid')
    expect(manifest.error).toContain('public active sprite must point to a public asset version')
  })

  it('flags invalid when the active versionIndex is not in the available version set', async () => {
    const manifest = await resolveDesktopSpriteManifest({
      metadataOnChainId: '0xmetadata',
      activeSpriteAssetName: 'persona-sprite',
      activeSpriteVersionIndex: 3,
      activeSpriteDownloadPolicy: 'public',
      spriteConfigJson: BASE_CONFIG,
      spriteMoodMapJson: BASE_MOOD_MAP,
      assetVersions: [{
        assetName: 'persona-sprite',
        versionIndex: 0,
        visibility: 'public',
        assetType: 'sprite',
        blobId: 'SGVsbG8',
        blobObjectId: '0xblob-0',
      }],
    })

    expect(manifest.downloadPolicy).toBe('invalid')
    expect(manifest.error).toMatch(/version/i)
  })

  it('treats the missing active binding as downloadPolicy=missing', async () => {
    const manifest = await resolveDesktopSpriteManifest({
      metadataOnChainId: '0xmetadata',
      activeSpriteAssetName: null,
      activeSpriteVersionIndex: null,
      activeSpriteDownloadPolicy: null,
      spriteConfigJson: null,
      spriteMoodMapJson: null,
      assetVersions: [],
    })

    expect(manifest.downloadPolicy).toBe('missing')
    expect(manifest.error).toContain('Active sprite binding is missing')
  })
})
