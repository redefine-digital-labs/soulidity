import { unsealDekEnvelope } from '@web/lib/services/dek-envelope'
import { createSealClient, getSealRuntimeConfig } from '@web/lib/services/seal'
import { createSealEnvelopeSidecar, createSkillVersionSealEnvelopeSidecar, type SealEnvelopeSidecar } from '@web/lib/services/seal-crypto'
import { getSoulSkillsObject, getSoulStateObject } from '@/lib/soulidity/queries'

export class SealSidecarSyncConfigError extends Error {}

export async function buildSyncSealSidecars(params: {
  packageId: string
  soulObjectId: string
  stateObjectId: string
  rawSoulEnvelope?: string | null
  rawSkillsEnvelope?: string | null
}): Promise<{
  soulSidecar: SealEnvelopeSidecar | null
  skillsSidecar: SealEnvelopeSidecar | null
}> {
  const rawSoulEnvelope = params.rawSoulEnvelope ?? null
  const rawSkillsEnvelope = params.rawSkillsEnvelope ?? null

  if (!rawSoulEnvelope && !rawSkillsEnvelope) {
    return {
      soulSidecar: null,
      skillsSidecar: null,
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
  let skillsSidecar: SealEnvelopeSidecar | null = null

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

  if (rawSkillsEnvelope && soulState.skillsId) {
    const skills = await getSoulSkillsObject(soulState.skillsId, params.packageId)
    if (skills.latestVersionId) {
      const unsealedSkillsEnvelope = unsealDekEnvelope(rawSkillsEnvelope)
      try {
        skillsSidecar = await createSkillVersionSealEnvelopeSidecar({
          sealClient,
          packageId: sealPackageId,
          versionObjectId: skills.latestVersionId,
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
  }

  return {
    soulSidecar,
    skillsSidecar,
  }
}
