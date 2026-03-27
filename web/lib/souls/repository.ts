import type { Prisma } from '../../../generated/prisma/client'
import { prisma } from '@web/lib/prisma'
import { isUuid } from '@web/lib/is-uuid'
import { serializeSoulPreviewImages, serializeSoulPreviewImageList } from '@web/lib/souls/serialization'
import type { SoulAssetDetail, SoulAssetSummary } from '@web/lib/souls/types'

export const soulAssetSummarySelect = {
  id: true,
  onChainId: true,
  name: true,
  description: true,
  imageUrl: true,
  category: true,
  tags: true,
  previewImages: true,
  listedPriceSui: true,
  listingStatus: true,
  creatorAddress: true,
  currentOwnerAddress: true,
  createdAt: true,
  updatedAt: true,
} as const

export const soulAssetDetailSelect = {
  ...soulAssetSummarySelect,
  metadataRef: true,
  contentBlobId: true,
  contentBlobObjectId: true,
  sellerKioskId: true,
  listingSource: true,
  readme: true,
  agentGrantAddress: true,
  agentAccessCapOnChainId: true,
  grantVersion: true,
  creatorMemberId: true,
  currentOwnerMemberId: true,
  sealSidecar: true,
} as const

type SoulAssetSummaryRecord = Prisma.SoulAssetGetPayload<{ select: typeof soulAssetSummarySelect }>
type SoulAssetDetailRecord = Prisma.SoulAssetGetPayload<{ select: typeof soulAssetDetailSelect }>

export function buildSoulAssetRouteWhere(id: string) {
  return isUuid(id) ? { id } : { onChainId: id }
}

export async function findSoulAssetSummaryByRouteId(id: string) {
  return prisma.soulAsset.findFirst({
    where: buildSoulAssetRouteWhere(id),
    select: soulAssetSummarySelect,
  })
}

export async function findSoulAssetDetailByRouteId(id: string) {
  return prisma.soulAsset.findFirst({
    where: buildSoulAssetRouteWhere(id),
    select: soulAssetDetailSelect,
  })
}

export function toSoulAssetSummary(record: SoulAssetSummaryRecord): SoulAssetSummary {
  const listingStatus = record.listingStatus === 'listed' ? 'listed' : 'held'
  return serializeSoulPreviewImages({
    ...record,
    listingStatus,
    listedPriceSui: record.listedPriceSui?.toString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  })
}

export function toSoulAssetSummaryList(records: SoulAssetSummaryRecord[]): SoulAssetSummary[] {
  return serializeSoulPreviewImageList(records.map((record) => ({
    ...record,
    listingStatus: record.listingStatus === 'listed' ? 'listed' : 'held',
    listedPriceSui: record.listedPriceSui?.toString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  })))
}

export function toSoulAssetDetail(record: SoulAssetDetailRecord, viewerMemberId: string | null): SoulAssetDetail {
  const summary = toSoulAssetSummary(record)
  return {
    ...summary,
    metadataRef: record.metadataRef,
    contentBlobId: record.contentBlobId,
    contentBlobObjectId: record.contentBlobObjectId,
    sellerKioskId: record.sellerKioskId,
    listingSource: record.listingSource,
    readme: record.readme,
    agentGrantAddress: record.agentGrantAddress,
    agentAccessCapOnChainId: record.agentAccessCapOnChainId,
    grantVersion: record.grantVersion,
    creatorMemberId: record.creatorMemberId,
    currentOwnerMemberId: record.currentOwnerMemberId,
    purchaseFeeAmountSui: null,
    quotedPriceSui: null,
    isOwner: viewerMemberId != null && record.currentOwnerMemberId === viewerMemberId,
    isCreator: viewerMemberId != null && record.creatorMemberId === viewerMemberId,
  }
}
