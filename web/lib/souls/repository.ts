import type { Prisma } from '../../../generated/prisma/client'
import { prisma } from '@web/lib/prisma'
import { isUuid } from '@web/lib/is-uuid'
import { sameSuiValue } from '@web/lib/souls/on-chain-verification'
import { parseRequiredObjectId } from '@web/lib/souls/request-validation'
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
  creatorRoyaltyBps: true,
  listingObjectOnChainId: true,
  listedPriceAtomic: true,
  listingStatus: true,
  creatorAddress: true,
  currentOwnerAddress: true,
  currentKioskId: true,
  createdAt: true,
  updatedAt: true,
} as const

export const soulAssetDetailSelect = {
  ...soulAssetSummarySelect,
  metadataRef: true,
  contentBlobId: true,
  contentBlobObjectId: true,
  currentKioskCapOnChainId: true,
  readme: true,
  allowlistAddress: true,
  allowlistCapOnChainId: true,
  allowlistVersion: true,
  creatorMemberId: true,
  currentOwnerMemberId: true,
  sealSidecar: true,
} as const

type SoulAssetSummaryRecord = Prisma.SoulAssetGetPayload<{ select: typeof soulAssetSummarySelect }>
type SoulAssetDetailRecord = Prisma.SoulAssetGetPayload<{ select: typeof soulAssetDetailSelect }>

export function buildSoulAssetRouteWhere(id: string) {
  if (isUuid(id)) {
    return { id }
  }
  const objectId = parseRequiredObjectId(id)
  return objectId ? { onChainId: objectId } : null
}

export async function findSoulAssetSummaryByRouteId(id: string) {
  const where = buildSoulAssetRouteWhere(id)
  if (!where) {
    return null
  }
  return prisma.soulAsset.findFirst({
    where,
    select: soulAssetSummarySelect,
  })
}

export async function findSoulAssetDetailByRouteId(id: string) {
  const where = buildSoulAssetRouteWhere(id)
  if (!where) {
    return null
  }
  return prisma.soulAsset.findFirst({
    where,
    select: soulAssetDetailSelect,
  })
}

export function toSoulAssetSummary(record: SoulAssetSummaryRecord): SoulAssetSummary {
  const listingStatus = record.listingStatus === 'listed' ? 'listed' : 'held'
  return serializeSoulPreviewImages({
    ...record,
    listingStatus,
    listedPriceAtomic: record.listedPriceAtomic?.toString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  })
}

export function toSoulAssetSummaryList(records: SoulAssetSummaryRecord[]): SoulAssetSummary[] {
  return serializeSoulPreviewImageList(records.map((record) => ({
    ...record,
    listingStatus: record.listingStatus === 'listed' ? 'listed' : 'held',
    listedPriceAtomic: record.listedPriceAtomic?.toString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  })))
}

export function toSoulAssetDetail(
  record: SoulAssetDetailRecord,
  params: { viewerMemberId: string | null; viewerWalletAddresses?: string[] },
): SoulAssetDetail {
  const summary = toSoulAssetSummary(record)
  const viewerWalletAddresses = params.viewerWalletAddresses ?? []
  const isOwner =
    (params.viewerMemberId != null && record.currentOwnerMemberId === params.viewerMemberId)
    || viewerWalletAddresses.some((address) => sameSuiValue(address, record.currentOwnerAddress))
  const isAllowlisted = record.allowlistAddress != null
    && viewerWalletAddresses.some((address) => sameSuiValue(address, record.allowlistAddress))
  const isCreator = params.viewerMemberId != null && record.creatorMemberId === params.viewerMemberId

  return {
    ...summary,
    metadataRef: record.metadataRef,
    contentBlobId: (isOwner || isAllowlisted) ? record.contentBlobId : null,
    contentBlobObjectId: (isOwner || isAllowlisted) ? record.contentBlobObjectId : null,
    currentKioskCapOnChainId: isOwner ? record.currentKioskCapOnChainId : null,
    readme: record.readme,
    allowlistAddress: isOwner ? record.allowlistAddress : null,
    allowlistCapOnChainId: (isOwner || isAllowlisted) ? record.allowlistCapOnChainId : null,
    allowlistVersion: (isOwner || isAllowlisted) ? record.allowlistVersion : null,
    creatorMemberId: isOwner ? record.creatorMemberId : null,
    currentOwnerMemberId: isOwner ? record.currentOwnerMemberId : null,
    purchasePlatformFeeAtomic: null,
    purchaseCreatorRoyaltyAtomic: null,
    purchaseTotalAtomic: null,
    quotedPriceAtomic: null,
    isOwner,
    isCreator,
    isAllowlisted,
  }
}
