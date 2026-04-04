import { prisma } from '@web/lib/prisma'
import type { SkillVersionObject } from '@/lib/soulidity/types'
import { toProjectionBigInt } from '@/lib/soulidity/projection-scalars'

export async function upsertSkillVersionProjection(params: {
  version: SkillVersionObject
  soulOnChainId: string
  skillsOnChainId: string
  deletedAt?: Date | null
  sealSidecar?: object | null
}) {
  return prisma.soulSkillVersionRecord.upsert({
    where: { versionOnChainId: params.version.objectId },
    update: {
      soulOnChainId: params.soulOnChainId,
      skillsOnChainId: params.skillsOnChainId,
      versionNumber: params.version.versionNumber,
      visibility: params.version.visibility,
      deletedAt: params.deletedAt === undefined ? undefined : params.deletedAt,
      blobObjectId: params.version.blobObjectId,
      blobId: params.version.blobId,
      previousVersionOnChainId: params.version.previousVersionId,
      sealSidecar: params.sealSidecar ?? undefined,
      createdAtMs: toProjectionBigInt(params.version.createdAtMs, 'SkillVersion createdAtMs'),
    },
    create: {
      soulOnChainId: params.soulOnChainId,
      skillsOnChainId: params.skillsOnChainId,
      versionOnChainId: params.version.objectId,
      versionNumber: params.version.versionNumber,
      visibility: params.version.visibility,
      deletedAt: params.deletedAt ?? null,
      blobObjectId: params.version.blobObjectId,
      blobId: params.version.blobId,
      previousVersionOnChainId: params.version.previousVersionId,
      sealSidecar: params.sealSidecar ?? undefined,
      createdAtMs: toProjectionBigInt(params.version.createdAtMs, 'SkillVersion createdAtMs'),
    },
  })
}

export async function markSkillVersionDeleted(params: {
  versionOnChainId: string
  deletedAt?: Date | null
}) {
  return prisma.soulSkillVersionRecord.updateMany({
    where: { versionOnChainId: params.versionOnChainId },
    data: {
      deletedAt: params.deletedAt ?? new Date(),
    },
  })
}
