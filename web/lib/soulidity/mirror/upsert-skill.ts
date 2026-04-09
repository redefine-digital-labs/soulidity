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
    where: {
      skillsOnChainId_skillName_versionIndex: {
        skillsOnChainId: params.skillsOnChainId,
        skillName: params.version.skillName,
        versionIndex: params.version.versionIndex,
      },
    },
    update: {
      soulOnChainId: params.soulOnChainId,
      skillsOnChainId: params.skillsOnChainId,
      skillName: params.version.skillName,
      versionIndex: params.version.versionIndex,
      visibility: params.version.visibility,
      deletedAt: params.deletedAt === undefined ? undefined : params.deletedAt,
      blobObjectId: params.version.blobObjectId,
      blobId: params.version.blobId,
      sealSidecar: params.sealSidecar ?? undefined,
      createdAtMs: toProjectionBigInt(params.version.createdAtMs, 'SkillVersion createdAtMs'),
    },
    create: {
      soulOnChainId: params.soulOnChainId,
      skillsOnChainId: params.skillsOnChainId,
      skillName: params.version.skillName,
      versionIndex: params.version.versionIndex,
      visibility: params.version.visibility,
      deletedAt: params.deletedAt ?? null,
      blobObjectId: params.version.blobObjectId,
      blobId: params.version.blobId,
      sealSidecar: params.sealSidecar ?? undefined,
      createdAtMs: toProjectionBigInt(params.version.createdAtMs, 'SkillVersion createdAtMs'),
    },
  })
}

export async function markSkillVersionDeleted(params: {
  skillsOnChainId: string
  skillName: string
  versionIndex: number
  deletedAt?: Date | null
}) {
  return prisma.soulSkillVersionRecord.updateMany({
    where: {
      skillsOnChainId: params.skillsOnChainId,
      skillName: params.skillName,
      versionIndex: params.versionIndex,
    },
    data: {
      deletedAt: params.deletedAt ?? new Date(),
    },
  })
}
