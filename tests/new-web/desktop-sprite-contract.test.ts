import { describe, expect, it } from 'vitest'

import { resolveDesktopSpriteManifest } from '../../web/lib/desktop/sprite-contract'

describe('resolveDesktopSpriteManifest', () => {
  it('marks public sprite metadata invalid when the bound public asset is missing', async () => {
    const manifest = await resolveDesktopSpriteManifest({
      metadataOnChainId: '0xmetadata',
      activeSpriteAssetName: 'persona-sprite',
      activeSpriteVersionIndex: 0,
      activeSpriteDownloadPolicy: 'public',
      spriteConfigJson: JSON.stringify({
        frameWidth: 64,
        frameHeight: 64,
        columns: 6,
        animations: {
          idle: {
            frames: [0, 1],
            fps: 8,
            loop: true,
          },
        },
      }),
      spriteMoodMapJson: JSON.stringify({ idle: 'idle' }),
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
})
