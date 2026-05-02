'use client'

import { tryExtractAssetVersionAppendedEvent } from '@/lib/soulidity/events'
import {
  createAssetSealSidecarFromMaterial,
  type PendingSealMaterial,
} from '@/lib/upload/client-seal'
import type { SealEnvelopeSidecar } from '@/lib/services/seal-crypto'

const LEGACY_ASSETS_SEAL_MATERIAL_KEY = 'assetsSealMaterial'

function isPendingSealMaterial(value: unknown): value is PendingSealMaterial {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<PendingSealMaterial>
  return candidate.version === 1
    && typeof candidate.dek === 'string'
    && typeof candidate.iv === 'string'
    && typeof candidate.contentHash === 'string'
    && typeof candidate.mimeType === 'string'
    && typeof candidate.fileName === 'string'
}

function isOptionalPendingSealMaterial(value: unknown): value is PendingSealMaterial | null | undefined {
  return value == null || isPendingSealMaterial(value)
}

export function hasValidOptionalLegacyAssetsSealMaterial(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return isOptionalPendingSealMaterial(candidate[LEGACY_ASSETS_SEAL_MATERIAL_KEY])
}

function readLegacyAssetsSealMaterial(value: unknown): PendingSealMaterial | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  const material = candidate[LEGACY_ASSETS_SEAL_MATERIAL_KEY]
  return isPendingSealMaterial(material) ? material : null
}

export async function createLegacyInitialAssetSealSidecar(params: {
  txResult: unknown
  syncMaterial: unknown
  packageId: string
  suiClient: unknown
}): Promise<SealEnvelopeSidecar | null> {
  const material = readLegacyAssetsSealMaterial(params.syncMaterial)
  if (!material) return null

  const initialAsset = tryExtractAssetVersionAppendedEvent(params.txResult as never, params.packageId)
  if (!initialAsset || initialAsset.visibility !== 'private') return null

  return createAssetSealSidecarFromMaterial({
    suiClient: params.suiClient as never,
    packageId: params.packageId,
    assetsObjectId: initialAsset.assetsId,
    assetName: initialAsset.assetName,
    versionIndex: initialAsset.versionIndex,
    material,
  })
}
