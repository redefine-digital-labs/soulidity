import { prisma } from '@web/lib/prisma'
import type { AssetVersionObject } from '@/lib/soulidity/types'
import { toProjectionBigInt } from '@/lib/soulidity/projection-scalars'

export async function upsertAssetVersionProjection(params: {
  version: AssetVersionObject
  soulOnChainId: string
  assetsOnChainId: string
  deletedAt?: Date | null
  sealSidecar?: object | null
}) {
  return prisma.soulAssetVersionRecord.upsert({
    where: {
      assetsOnChainId_assetName_versionIndex: {
        assetsOnChainId: params.assetsOnChainId,
        assetName: params.version.assetName,
        versionIndex: params.version.versionIndex,
      },
    },
    update: {
      soulOnChainId: params.soulOnChainId,
      assetsOnChainId: params.assetsOnChainId,
      assetName: params.version.assetName,
      versionIndex: params.version.versionIndex,
      assetType: params.version.assetType,
      visibility: params.version.visibility,
      deletedAt: params.deletedAt === undefined ? undefined : params.deletedAt,
      blobObjectId: params.version.blobObjectId,
      blobId: params.version.blobId,
      sealSidecar: params.sealSidecar ?? undefined,
      createdAtMs: toProjectionBigInt(params.version.createdAtMs, 'AssetVersion createdAtMs'),
    },
    create: {
      soulOnChainId: params.soulOnChainId,
      assetsOnChainId: params.assetsOnChainId,
      assetName: params.version.assetName,
      versionIndex: params.version.versionIndex,
      assetType: params.version.assetType,
      visibility: params.version.visibility,
      deletedAt: params.deletedAt ?? null,
      blobObjectId: params.version.blobObjectId,
      blobId: params.version.blobId,
      sealSidecar: params.sealSidecar ?? undefined,
      createdAtMs: toProjectionBigInt(params.version.createdAtMs, 'AssetVersion createdAtMs'),
    },
  })
}

export async function markAssetVersionDeleted(params: {
  assetsOnChainId: string
  assetName: string
  versionIndex: number
  deletedAt?: Date | null
}) {
  return prisma.soulAssetVersionRecord.updateMany({
    where: {
      assetsOnChainId: params.assetsOnChainId,
      assetName: params.assetName,
      versionIndex: params.versionIndex,
    },
    data: {
      deletedAt: params.deletedAt ?? new Date(),
    },
  })
}
