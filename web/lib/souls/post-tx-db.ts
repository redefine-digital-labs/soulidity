import { Prisma } from '../../../generated/prisma/client'
import { isValidSuiAddress, normalizeSuiAddress } from '@mysten/sui/utils'
import { prisma } from '@web/lib/prisma'
import type { SealEnvelopeSidecar } from '@web/lib/services/seal-crypto'

type SoulDbClient = typeof prisma | Prisma.TransactionClient

function sameSuiAddress(left: string, right: string): boolean {
  try {
    const normalizedLeft = normalizeSuiAddress(left)
    const normalizedRight = normalizeSuiAddress(right)
    return isValidSuiAddress(normalizedLeft)
      && isValidSuiAddress(normalizedRight)
      && normalizedLeft === normalizedRight
  } catch {
    return false
  }
}

function normalizeStoredSuiAddress(address: string): string {
  try {
    const normalized = normalizeSuiAddress(address)
    return isValidSuiAddress(normalized) ? normalized : address
  } catch {
    return address
  }
}

async function resolveMemberIdBySuiAddress(db: SoulDbClient, address: string): Promise<string | null> {
  const binding = await db.walletBinding.findFirst({
    where: { address: normalizeStoredSuiAddress(address), chain: 'sui' },
  })
  return binding?.memberId ?? null
}

export async function dbUpsertSoulAsset(params: {
  soulOnChainId: string
  creatorAddress: string
  creatorMemberId: string | null
  currentOwnerAddress: string
  currentOwnerMemberId?: string | null
  sellerKioskId: string | null
  listedPriceSui: bigint | null
  listingStatus: 'listed' | 'held'
  name: string
  description: string
  imageUrl: string
  metadataRef?: string | null
  contentBlobId: string
  contentBlobObjectId: string
  sealSidecar?: SealEnvelopeSidecar | null
  category: string
  tags: string[]
  previewImages: string[]
  readme?: string | null
  grantVersion: bigint
  agentGrantAddress?: string | null
  agentAccessCapOnChainId?: string | null
  listingSource?: 'adapter' | 'core' | null
  db?: SoulDbClient
}) {
  const db = params.db ?? prisma
  const creatorAddress = normalizeStoredSuiAddress(params.creatorAddress)
  const currentOwnerAddress = normalizeStoredSuiAddress(params.currentOwnerAddress)
  const creatorMemberId = params.creatorMemberId ?? await resolveMemberIdBySuiAddress(db, creatorAddress)
  const currentOwnerMemberId = params.currentOwnerMemberId ?? await resolveMemberIdBySuiAddress(db, currentOwnerAddress)
  const existingSoul = await db.soulAsset.findUnique({
    where: { onChainId: params.soulOnChainId },
    select: {
      creatorMemberId: true,
      creatorAddress: true,
    },
  })
  if (
    existingSoul
    && !sameSuiAddress(existingSoul.creatorAddress, creatorAddress)
  ) {
    throw new Error('existing Soul creator does not match the submitted on-chain creator')
  }
  if (
    existingSoul
    && existingSoul.creatorMemberId != null
    && creatorMemberId != null
    && existingSoul.creatorMemberId !== creatorMemberId
  ) {
    throw new Error('existing Soul creator does not match the submitted on-chain creator')
  }

  return db.soulAsset.upsert({
    where: { onChainId: params.soulOnChainId },
    create: {
      onChainId: params.soulOnChainId,
      creatorAddress,
      creatorMemberId,
      currentOwnerAddress,
      currentOwnerMemberId,
      sellerKioskId: params.sellerKioskId,
      listedPriceSui: params.listedPriceSui ? new Prisma.Decimal(params.listedPriceSui.toString()) : null,
      listingStatus: params.listingStatus,
      listingSource: params.listingSource ?? null,
      name: params.name,
      description: params.description,
      imageUrl: params.imageUrl,
      metadataRef: params.metadataRef ?? null,
      contentBlobId: params.contentBlobId,
      contentBlobObjectId: params.contentBlobObjectId,
      sealSidecar: (params.sealSidecar ?? null) as unknown as Prisma.InputJsonValue,
      category: params.category,
      tags: params.tags,
      previewImages: params.previewImages,
      readme: params.readme ?? null,
      grantVersion: params.grantVersion.toString(),
      agentGrantAddress: params.agentGrantAddress ?? null,
      agentAccessCapOnChainId: params.agentAccessCapOnChainId ?? null,
    },
    update: {
      creatorAddress,
      currentOwnerAddress,
      currentOwnerMemberId,
      sellerKioskId: params.sellerKioskId,
      listedPriceSui: params.listedPriceSui ? new Prisma.Decimal(params.listedPriceSui.toString()) : null,
      listingStatus: params.listingStatus,
      listingSource: params.listingSource ?? null,
      name: params.name,
      description: params.description,
      imageUrl: params.imageUrl,
      metadataRef: params.metadataRef ?? null,
      contentBlobId: params.contentBlobId,
      contentBlobObjectId: params.contentBlobObjectId,
      sealSidecar: (params.sealSidecar ?? null) as unknown as Prisma.InputJsonValue,
      category: params.category,
      tags: params.tags,
      previewImages: params.previewImages,
      readme: params.readme ?? null,
      grantVersion: params.grantVersion.toString(),
      agentGrantAddress: params.agentGrantAddress ?? null,
      agentAccessCapOnChainId: params.agentAccessCapOnChainId ?? null,
    },
  })
}

export async function dbSetSoulAgentGrant(params: {
  soulOnChainId: string
  agentGrantAddress: string
  agentAccessCapOnChainId: string
  grantVersion: bigint
  db?: SoulDbClient
}) {
  const db = params.db ?? prisma
  const result = await db.soulAsset.updateMany({
    where: { onChainId: params.soulOnChainId },
    data: {
      agentGrantAddress: normalizeStoredSuiAddress(params.agentGrantAddress),
      agentAccessCapOnChainId: params.agentAccessCapOnChainId,
      grantVersion: params.grantVersion.toString(),
    },
  })
  if (result.count === 0) {
    throw new Error(`Soul ${params.soulOnChainId} not found`)
  }
}

export async function dbRevokeSoulAgentGrant(params: {
  soulOnChainId: string
  grantVersion: bigint
  db?: SoulDbClient
}) {
  const db = params.db ?? prisma
  const result = await db.soulAsset.updateMany({
    where: { onChainId: params.soulOnChainId },
    data: {
      agentGrantAddress: null,
      agentAccessCapOnChainId: null,
      grantVersion: params.grantVersion.toString(),
    },
  })
  if (result.count === 0) {
    throw new Error(`Soul ${params.soulOnChainId} not found`)
  }
}

export async function dbSetSoulOwnership(params: {
  soulOnChainId: string
  currentOwnerAddress: string
  currentOwnerMemberId?: string | null
  listingStatus: 'listed' | 'held'
  sellerKioskId: string | null
  listedPriceSui: bigint | null
  grantVersion: bigint
  db?: SoulDbClient
}) {
  const db = params.db ?? prisma
  const currentOwnerAddress = normalizeStoredSuiAddress(params.currentOwnerAddress)
  const currentOwnerMemberId = params.currentOwnerMemberId ?? await resolveMemberIdBySuiAddress(db, currentOwnerAddress)
  const result = await db.soulAsset.updateMany({
    where: { onChainId: params.soulOnChainId },
    data: {
      currentOwnerAddress,
      currentOwnerMemberId,
      listingStatus: params.listingStatus,
      sellerKioskId: params.sellerKioskId,
      listedPriceSui: params.listedPriceSui ? new Prisma.Decimal(params.listedPriceSui.toString()) : null,
      agentGrantAddress: null,
      agentAccessCapOnChainId: null,
      grantVersion: params.grantVersion.toString(),
    },
  })
  if (result.count === 0) {
    throw new Error(`Soul ${params.soulOnChainId} not found`)
  }
}
