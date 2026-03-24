import { prisma } from '@web/lib/prisma'
import {
  getVerifiedReleaseState,
  OnChainVerificationError,
  sameSuiValue,
} from '@web/lib/souls/on-chain-verification'
import { dbCreateRelease } from '@web/lib/souls/post-tx-db'

type ReleaseResolutionDb = typeof prisma

export type ResolvedSoulRelease = {
  id: string | null
  onChainId: string
  version: string
  walrusBlobRef: string
  contentHash: string
}

function mapResolvedRelease(release: {
  id: string
  onChainId: string
  version: string
  walrusBlobRef: string
  contentHash: string
}): ResolvedSoulRelease {
  return {
    id: release.id,
    onChainId: release.onChainId,
    version: release.version,
    walrusBlobRef: release.walrusBlobRef,
    contentHash: release.contentHash,
  }
}

export async function resolveReleaseByOnChainId(params: {
  releaseOnChainId: string
  seriesDbId: string
  seriesOnChainId: string
  soulPackageId: string
  seriesLatestReleaseOnChainId: string | null
  db?: ReleaseResolutionDb
}): Promise<ResolvedSoulRelease> {
  const db = params.db ?? prisma

  const mirroredRelease = await db.soulRelease.findFirst({
    where: {
      onChainId: params.releaseOnChainId,
      seriesId: params.seriesDbId,
    },
    select: {
      id: true,
      onChainId: true,
      version: true,
      walrusBlobRef: true,
      contentHash: true,
    },
  })
  if (mirroredRelease) {
    return mapResolvedRelease(mirroredRelease)
  }

  const releaseState = await getVerifiedReleaseState(params.releaseOnChainId, params.soulPackageId)
  if (!sameSuiValue(releaseState.seriesId, params.seriesOnChainId)) {
    throw new OnChainVerificationError('Release does not belong to this Soul series')
  }

  const mirroredBackfill = await dbCreateRelease({
    db,
    releaseOnChainId: releaseState.objectId,
    seriesDbId: params.seriesDbId,
    seriesLatestReleaseOnChainId: params.seriesLatestReleaseOnChainId,
    version: releaseState.version,
    walrusBlobRef: releaseState.walrusBlobRef,
    publicMetadataRef: releaseState.publicMetadataRef,
    contentHash: releaseState.contentHash,
  })

  return mapResolvedRelease(mirroredBackfill)
}

export async function resolveLatestSeriesRelease(params: {
  seriesDbId: string
  seriesOnChainId: string
  latestReleaseOnChainId: string | null
  soulPackageId: string
  db?: ReleaseResolutionDb
}): Promise<ResolvedSoulRelease | null> {
  if (!params.latestReleaseOnChainId) {
    return null
  }

  return resolveReleaseByOnChainId({
    db: params.db,
    releaseOnChainId: params.latestReleaseOnChainId,
    seriesDbId: params.seriesDbId,
    seriesOnChainId: params.seriesOnChainId,
    seriesLatestReleaseOnChainId: params.latestReleaseOnChainId,
    soulPackageId: params.soulPackageId,
  })
}
