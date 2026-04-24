import { unsealDekEnvelope } from '@/lib/services/dek-envelope'
import { createSealClient, getSealRuntimeConfig } from '@/lib/services/seal'
import {
  createAssetVersionSealEnvelopeSidecar,
  createMemoryEntrySealEnvelopeSidecar,
  createSealEnvelopeSidecar,
  createSkillVersionSealEnvelopeSidecar,
  type SealEnvelopeSidecar,
} from '@/lib/services/seal-crypto'
import { getSoulStateObject } from '@/lib/soulidity/queries'

export class SealSidecarSyncConfigError extends Error {}

export async function buildSyncSealSidecars(params: {
  packageId: string
  soulObjectId: string
  stateObjectId: string
  rawSoulEnvelope?: string | null
  rawMemoryEnvelope?: string | null
  memoryBinding?: { memoryObjectId: string; timestampKey: number } | null
  rawSkillsEnvelope?: string | null
  skillBinding?: { skillsObjectId: string; skillName: string; versionIndex: number } | null
  rawAssetsEnvelope?: string | null
  assetBinding?: { assetsObjectId: string; assetName: string; versionIndex: number } | null
}): Promise<{
  soulSidecar: SealEnvelopeSidecar | null
  memorySidecar: SealEnvelopeSidecar | null
  skillsSidecar: SealEnvelopeSidecar | null
  assetsSidecar: SealEnvelopeSidecar | null
}> {
  const rawSoulEnvelope = params.rawSoulEnvelope ?? null
  const rawMemoryEnvelope = params.rawMemoryEnvelope ?? null
  const rawSkillsEnvelope = params.rawSkillsEnvelope ?? null
  const rawAssetsEnvelope = params.rawAssetsEnvelope ?? null

  if (!rawSoulEnvelope && !rawMemoryEnvelope && !rawSkillsEnvelope && !rawAssetsEnvelope) {
    return {
      soulSidecar: null,
      memorySidecar: null,
      skillsSidecar: null,
      assetsSidecar: null,
    }
  }

  const runtimeConfig = getSealRuntimeConfig()
  if (runtimeConfig.threshold <= 0 || runtimeConfig.serverConfigs.length === 0) {
    throw new SealSidecarSyncConfigError('Seal is not configured for Soul publishing')
  }

  const sealClient = createSealClient()
  const soulState = await getSoulStateObject(params.stateObjectId, params.packageId)
  const sealPackageId = soulState.packageId ?? params.packageId

  let soulSidecar: SealEnvelopeSidecar | null = null
  let memorySidecar: SealEnvelopeSidecar | null = null
  let skillsSidecar: SealEnvelopeSidecar | null = null
  let assetsSidecar: SealEnvelopeSidecar | null = null

  if (rawSoulEnvelope) {
    const unsealedEnvelope = unsealDekEnvelope(rawSoulEnvelope)
    try {
      soulSidecar = await createSealEnvelopeSidecar({
        sealClient,
        packageId: sealPackageId,
        soulObjectId: params.soulObjectId,
        threshold: runtimeConfig.threshold,
        dek: unsealedEnvelope.dek,
        iv: unsealedEnvelope.iv,
        contentHash: unsealedEnvelope.contentHash,
        mimeType: unsealedEnvelope.mimeType,
        fileName: unsealedEnvelope.fileName,
      })
    } finally {
      unsealedEnvelope.dek.fill(0)
    }
  }

  if (rawMemoryEnvelope && params.memoryBinding) {
    const unsealedMemoryEnvelope = unsealDekEnvelope(rawMemoryEnvelope)
    try {
      memorySidecar = await createMemoryEntrySealEnvelopeSidecar({
        sealClient,
        packageId: sealPackageId,
        memoryObjectId: params.memoryBinding.memoryObjectId,
        timestampKey: params.memoryBinding.timestampKey,
        threshold: runtimeConfig.threshold,
        dek: unsealedMemoryEnvelope.dek,
        iv: unsealedMemoryEnvelope.iv,
        contentHash: unsealedMemoryEnvelope.contentHash,
        mimeType: unsealedMemoryEnvelope.mimeType,
        fileName: unsealedMemoryEnvelope.fileName,
      })
    } finally {
      unsealedMemoryEnvelope.dek.fill(0)
    }
  }

  if (rawSkillsEnvelope && params.skillBinding) {
    const unsealedSkillsEnvelope = unsealDekEnvelope(rawSkillsEnvelope)
    try {
      skillsSidecar = await createSkillVersionSealEnvelopeSidecar({
        sealClient,
        packageId: sealPackageId,
        skillsObjectId: params.skillBinding.skillsObjectId,
        skillName: params.skillBinding.skillName,
        versionIndex: params.skillBinding.versionIndex,
        threshold: runtimeConfig.threshold,
        dek: unsealedSkillsEnvelope.dek,
        iv: unsealedSkillsEnvelope.iv,
        contentHash: unsealedSkillsEnvelope.contentHash,
        mimeType: unsealedSkillsEnvelope.mimeType,
        fileName: unsealedSkillsEnvelope.fileName,
      })
    } finally {
      unsealedSkillsEnvelope.dek.fill(0)
    }
  }

  if (rawAssetsEnvelope && params.assetBinding) {
    const unsealedAssetsEnvelope = unsealDekEnvelope(rawAssetsEnvelope)
    try {
      assetsSidecar = await createAssetVersionSealEnvelopeSidecar({
        sealClient,
        packageId: sealPackageId,
        assetsObjectId: params.assetBinding.assetsObjectId,
        assetName: params.assetBinding.assetName,
        versionIndex: params.assetBinding.versionIndex,
        threshold: runtimeConfig.threshold,
        dek: unsealedAssetsEnvelope.dek,
        iv: unsealedAssetsEnvelope.iv,
        contentHash: unsealedAssetsEnvelope.contentHash,
        mimeType: unsealedAssetsEnvelope.mimeType,
        fileName: unsealedAssetsEnvelope.fileName,
      })
    } finally {
      unsealedAssetsEnvelope.dek.fill(0)
    }
  }

  return {
    soulSidecar,
    memorySidecar,
    skillsSidecar,
    assetsSidecar,
  }
}
