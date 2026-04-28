import {
  assertDocumentIdMatchesExpectedBinding,
  generateAssetDocumentIdForVersion,
  generateMemoryDocumentId,
  generateSkillDocumentIdForVersion,
  parseSealEnvelopeSidecar,
  type SealEnvelopeSidecar,
} from '@/lib/services/seal-crypto'

export class SealSidecarSyncConfigError extends Error {}

export async function buildSyncSealSidecars(params: {
  packageId: string
  soulObjectId: string
  stateObjectId: string
  soulSidecar?: SealEnvelopeSidecar | null
  memorySidecar?: SealEnvelopeSidecar | null
  memoryBinding?: { memoryObjectId: string; timestampKey: number } | null
  skillsSidecar?: SealEnvelopeSidecar | null
  skillBinding?: { skillsObjectId: string; skillName: string; versionIndex: number } | null
  assetsSidecar?: SealEnvelopeSidecar | null
  assetBinding?: { assetsObjectId: string; assetName: string; versionIndex: number } | null
}): Promise<{
  soulSidecar: SealEnvelopeSidecar | null
  memorySidecar: SealEnvelopeSidecar | null
  skillsSidecar: SealEnvelopeSidecar | null
  assetsSidecar: SealEnvelopeSidecar | null
}> {
  const providedSoulSidecar = params.soulSidecar ? parseSealEnvelopeSidecar(params.soulSidecar) : null
  const providedMemorySidecar = params.memorySidecar ? parseSealEnvelopeSidecar(params.memorySidecar) : null
  const providedSkillsSidecar = params.skillsSidecar ? parseSealEnvelopeSidecar(params.skillsSidecar) : null
  const providedAssetsSidecar = params.assetsSidecar ? parseSealEnvelopeSidecar(params.assetsSidecar) : null

  if (
    !providedSoulSidecar && !providedMemorySidecar && !providedSkillsSidecar && !providedAssetsSidecar
  ) {
    return {
      soulSidecar: null,
      memorySidecar: null,
      skillsSidecar: null,
      assetsSidecar: null,
    }
  }

  let soulSidecar: SealEnvelopeSidecar | null = null
  let memorySidecar: SealEnvelopeSidecar | null = null
  let skillsSidecar: SealEnvelopeSidecar | null = null
  let assetsSidecar: SealEnvelopeSidecar | null = null

  if (providedSoulSidecar) {
    assertDocumentIdMatchesExpectedBinding({
      documentId: providedSoulSidecar.documentId,
      expectedSoulObjectId: params.soulObjectId,
    })
    soulSidecar = providedSoulSidecar
  }

  if (providedMemorySidecar && !params.memoryBinding) {
    throw new Error('Memory Seal sidecar was provided without an appended memory entry')
  }
  if (providedMemorySidecar && params.memoryBinding) {
    const expectedDocumentId = generateMemoryDocumentId(
      params.memoryBinding.memoryObjectId,
      params.memoryBinding.timestampKey,
    ).toLowerCase()
    if (providedMemorySidecar.documentId.toLowerCase() !== expectedDocumentId) {
      throw new Error('Memory Seal sidecar documentId does not match the appended memory entry')
    }
    memorySidecar = providedMemorySidecar
  }

  if (providedSkillsSidecar && !params.skillBinding) {
    throw new Error('Skill Seal sidecar was provided without an appended skill version')
  }
  if (providedSkillsSidecar && params.skillBinding) {
    const expectedDocumentId = generateSkillDocumentIdForVersion(
      params.skillBinding.skillsObjectId,
      params.skillBinding.skillName,
      params.skillBinding.versionIndex,
    ).toLowerCase()
    if (providedSkillsSidecar.documentId.toLowerCase() !== expectedDocumentId) {
      throw new Error('Skill Seal sidecar documentId does not match the appended skill version')
    }
    skillsSidecar = providedSkillsSidecar
  }

  if (providedAssetsSidecar && !params.assetBinding) {
    throw new Error('Asset Seal sidecar was provided without an appended asset version')
  }
  if (providedAssetsSidecar && params.assetBinding) {
    const expectedDocumentId = generateAssetDocumentIdForVersion(
      params.assetBinding.assetsObjectId,
      params.assetBinding.assetName,
      params.assetBinding.versionIndex,
    ).toLowerCase()
    if (providedAssetsSidecar.documentId.toLowerCase() !== expectedDocumentId) {
      throw new Error('Asset Seal sidecar documentId does not match the appended asset version')
    }
    assetsSidecar = providedAssetsSidecar
  }

  return {
    soulSidecar,
    memorySidecar,
    skillsSidecar,
    assetsSidecar,
  }
}
