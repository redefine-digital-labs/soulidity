import { Prisma } from '../../../generated/prisma/client'
import { prisma } from '@web/lib/prisma'
import { unsealDekEnvelope } from '@web/lib/services/dek-envelope'
import { createSealClient, getSealRuntimeConfig } from '@web/lib/services/seal'
import {
  createSealKeyMaterial,
  generateSealDocumentId,
  type SealEnvelopeSidecar,
} from '@web/lib/services/seal-crypto'

export async function createAndStoreReleaseSealSidecar(params: {
  sealDekEnvelope: string
  seriesOnChainId: string
  releaseOnChainId: string
  releaseContentHash: string
  soulPackageId: string
}): Promise<SealEnvelopeSidecar> {
  const { dek, iv, contentHash, mimeType, fileName } = unsealDekEnvelope(params.sealDekEnvelope)

  if (contentHash !== params.releaseContentHash) {
    throw new Error('DEK envelope content hash does not match the on-chain release')
  }

  const sealConfig = getSealRuntimeConfig()
  const sealClient = createSealClient()
  const documentId = generateSealDocumentId(
    params.seriesOnChainId,
    undefined,
    params.releaseOnChainId,
  )
  const keyMaterial = createSealKeyMaterial(dek, contentHash)

  try {
    const { encryptedObject } = await sealClient.encrypt({
      threshold: sealConfig.threshold,
      packageId: params.soulPackageId,
      id: documentId,
      data: keyMaterial,
    })

    const sidecar: SealEnvelopeSidecar = {
      version: 1,
      mode: 'seal-envelope',
      documentId,
      encryptedDek: Buffer.from(encryptedObject).toString('base64'),
      iv: Buffer.from(iv).toString('base64'),
      cipher: 'AES-GCM-256',
      mimeType,
      fileName,
      contentHash,
    }

    await prisma.soulRelease.updateMany({
      where: { onChainId: params.releaseOnChainId },
      data: { sealSidecar: sidecar as unknown as Prisma.InputJsonValue },
    })

    return sidecar
  } finally {
    keyMaterial.fill(0)
    dek.fill(0)
  }
}
