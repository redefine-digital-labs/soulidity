import { describe, expect, it, vi, beforeEach } from 'vitest'

const mockedTryExtractAssetVersionAppendedEvent = vi.hoisted(() => vi.fn())
const mockedCreateAssetSealSidecarFromMaterial = vi.hoisted(() => vi.fn())

vi.mock('@/lib/soulidity/events', () => ({
  tryExtractAssetVersionAppendedEvent: mockedTryExtractAssetVersionAppendedEvent,
}))

vi.mock('@/lib/upload/client-seal', () => ({
  createAssetSealSidecarFromMaterial: mockedCreateAssetSealSidecarFromMaterial,
}))

import {
  createLegacyInitialAssetSealSidecar,
  hasValidOptionalLegacyAssetsSealMaterial,
} from '@/lib/hooks/legacy-mint-asset-recovery'

const legacyMaterial = {
  version: 1,
  dek: 'legacy-dek',
  iv: 'legacy-iv',
  contentHash: 'legacy-hash',
  mimeType: 'image/png',
  fileName: 'persona-sprite.png',
}

describe('legacy mint-time asset recovery', () => {
  beforeEach(() => {
    mockedTryExtractAssetVersionAppendedEvent.mockReset()
    mockedCreateAssetSealSidecarFromMaterial.mockReset()
  })

  it('builds an asset Seal sidecar for a legacy private initial asset recovery', async () => {
    mockedTryExtractAssetVersionAppendedEvent.mockReturnValue({
      assetsId: '0xassets',
      assetName: 'persona-sprite',
      versionIndex: 0,
      visibility: 'private',
    })
    mockedCreateAssetSealSidecarFromMaterial.mockResolvedValue({ mode: 'seal-envelope' })

    await expect(createLegacyInitialAssetSealSidecar({
      txResult: { digest: '0xlegacy-tx' },
      syncMaterial: { assetsSealMaterial: legacyMaterial },
      packageId: '0xpackage',
      suiClient: { rpc: 'client' },
    })).resolves.toEqual({ mode: 'seal-envelope' })

    expect(mockedTryExtractAssetVersionAppendedEvent).toHaveBeenCalledWith({ digest: '0xlegacy-tx' }, '0xpackage')
    expect(mockedCreateAssetSealSidecarFromMaterial).toHaveBeenCalledWith({
      suiClient: { rpc: 'client' },
      packageId: '0xpackage',
      assetsObjectId: '0xassets',
      assetName: 'persona-sprite',
      versionIndex: 0,
      material: legacyMaterial,
    })
  })

  it('does not parse events or build a sidecar when no legacy material is present', async () => {
    await expect(createLegacyInitialAssetSealSidecar({
      txResult: { digest: '0xcurrent-tx' },
      syncMaterial: {},
      packageId: '0xpackage',
      suiClient: {},
    })).resolves.toBeNull()

    expect(mockedTryExtractAssetVersionAppendedEvent).not.toHaveBeenCalled()
    expect(mockedCreateAssetSealSidecarFromMaterial).not.toHaveBeenCalled()
  })

  it('ignores legacy material for public initial assets', async () => {
    mockedTryExtractAssetVersionAppendedEvent.mockReturnValue({
      assetsId: '0xassets',
      assetName: 'persona-sprite',
      versionIndex: 0,
      visibility: 'public',
    })

    await expect(createLegacyInitialAssetSealSidecar({
      txResult: { digest: '0xpublic-tx' },
      syncMaterial: { assetsSealMaterial: legacyMaterial },
      packageId: '0xpackage',
      suiClient: {},
    })).resolves.toBeNull()

    expect(mockedCreateAssetSealSidecarFromMaterial).not.toHaveBeenCalled()
  })

  it('validates malformed legacy material before accepting recovery payloads', () => {
    expect(hasValidOptionalLegacyAssetsSealMaterial({})).toBe(true)
    expect(hasValidOptionalLegacyAssetsSealMaterial({ assetsSealMaterial: null })).toBe(true)
    expect(hasValidOptionalLegacyAssetsSealMaterial({ assetsSealMaterial: legacyMaterial })).toBe(true)
    expect(hasValidOptionalLegacyAssetsSealMaterial({ assetsSealMaterial: { version: 1 } })).toBe(false)
  })
})
