import { Prisma } from '../../../generated/prisma/client'
import { isValidSuiAddress, normalizeSuiAddress } from '@mysten/sui/utils'
import { prisma } from '@web/lib/prisma'
import type { SealEnvelopeSidecar } from '@web/lib/services/seal-crypto'

type SoulDbClient = typeof prisma | Prisma.TransactionClient

type SoulListingStatus = 'listed' | 'held'

type ExpectedSoulMirrorOwnership = {
  expectedCurrentOwnerAddress?: string | null
  expectedCurrentKioskId?: string | null
  expectedListingStatus?: SoulListingStatus
}

export function narrowListingStatus(value: string | null | undefined): SoulListingStatus | undefined {
  if (value === 'listed' || value === 'held') return value
  return undefined
}

export class SoulMirrorOwnershipConflictError extends Error {
  constructor(soulOnChainId: string) {
    super(`Soul ${soulOnChainId} ownership changed before the local mirror could be updated`)
    this.name = 'SoulMirrorOwnershipConflictError'
  }
}

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

function toNullableDecimal(value: bigint | null) {
  return value != null ? new Prisma.Decimal(value.toString()) : null
}

function buildSoulMirrorWhere(params: { soulOnChainId: string } & ExpectedSoulMirrorOwnership) {
  const where: Record<string, unknown> = {
    onChainId: params.soulOnChainId,
  }
  if (typeof params.expectedCurrentOwnerAddress === 'string' && params.expectedCurrentOwnerAddress.trim().length > 0) {
    where.currentOwnerAddress = normalizeStoredSuiAddress(params.expectedCurrentOwnerAddress)
  }
  if (typeof params.expectedCurrentKioskId === 'string' && params.expectedCurrentKioskId.trim().length > 0) {
    where.currentKioskId = normalizeStoredSuiAddress(params.expectedCurrentKioskId)
  }
  if (params.expectedListingStatus) {
    where.listingStatus = params.expectedListingStatus
  }
  return where
}

function hasSoulMirrorOwnershipGuard(params: ExpectedSoulMirrorOwnership) {
  return Boolean(
    (typeof params.expectedCurrentOwnerAddress === 'string' && params.expectedCurrentOwnerAddress.trim().length > 0)
    || (typeof params.expectedCurrentKioskId === 'string' && params.expectedCurrentKioskId.trim().length > 0)
    || params.expectedListingStatus,
  )
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
  creatorRoyaltyBps: number
  currentOwnerAddress: string
  currentOwnerMemberId?: string | null
  currentKioskId: string
  currentKioskCapOnChainId: string
  listingObjectOnChainId: string | null
  listedPriceAtomic: bigint | null
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
  allowlistVersion: bigint
  allowlistAddress?: string | null
  allowlistCapOnChainId?: string | null
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
      // Legacy web runtime is retired; preserve compilability with a self-keyed fallback.
      stateOnChainId: params.soulOnChainId,
      memoryOnChainId: params.soulOnChainId,
      creatorAddress,
      creatorMemberId,
      creatorRoyaltyBps: params.creatorRoyaltyBps,
      currentOwnerAddress,
      currentOwnerMemberId,
      currentKioskId: params.currentKioskId,
      currentKioskCapOnChainId: params.currentKioskCapOnChainId,
      listingObjectOnChainId: params.listingObjectOnChainId,
      listedPriceAtomic: toNullableDecimal(params.listedPriceAtomic),
      listingStatus: params.listingStatus,
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
    },
    update: {
      creatorAddress,
      creatorRoyaltyBps: params.creatorRoyaltyBps,
      currentOwnerAddress,
      currentOwnerMemberId,
      currentKioskId: params.currentKioskId,
      currentKioskCapOnChainId: params.currentKioskCapOnChainId,
      listingObjectOnChainId: params.listingObjectOnChainId,
      listedPriceAtomic: toNullableDecimal(params.listedPriceAtomic),
      listingStatus: params.listingStatus,
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
    },
  })
}

export async function dbSetSoulAllowlist(params: {
  soulOnChainId: string
  allowlistAddress: string
  allowlistCapOnChainId: string
  allowlistVersion: bigint
  expectedCurrentOwnerAddress?: string | null
  expectedCurrentKioskId?: string | null
  expectedListingStatus?: 'listed' | 'held'
  db?: SoulDbClient
}) {
  void params
  throw new Error('Legacy Soul allowlist mirror has been retired. Use Soulidity grants instead.')
}

export async function dbClearSoulAllowlist(params: {
  soulOnChainId: string
  allowlistVersion: bigint
  expectedCurrentOwnerAddress?: string | null
  expectedCurrentKioskId?: string | null
  expectedListingStatus?: 'listed' | 'held'
  db?: SoulDbClient
}) {
  void params
  throw new Error('Legacy Soul allowlist mirror has been retired. Use Soulidity grants instead.')
}

export async function dbSetSoulOwnership(params: {
  soulOnChainId: string
  currentOwnerAddress: string
  currentOwnerMemberId?: string | null
  currentKioskId: string
  currentKioskCapOnChainId: string
  listingObjectOnChainId: string | null
  listingStatus: 'listed' | 'held'
  listedPriceAtomic: bigint | null
  allowlistVersion: bigint
  preserveExistingAllowlistMirror?: boolean
  expectedCurrentOwnerAddress?: string | null
  expectedCurrentKioskId?: string | null
  expectedListingStatus?: 'listed' | 'held'
  db?: SoulDbClient
}) {
  const db = params.db ?? prisma
  const currentOwnerAddress = normalizeStoredSuiAddress(params.currentOwnerAddress)
  const currentKioskId = normalizeStoredSuiAddress(params.currentKioskId)
  const currentKioskCapOnChainId = normalizeStoredSuiAddress(params.currentKioskCapOnChainId)
  const currentOwnerMemberId = params.currentOwnerMemberId ?? await resolveMemberIdBySuiAddress(db, currentOwnerAddress)
  const result = await db.soulAsset.updateMany({
    where: buildSoulMirrorWhere(params),
    data: {
      currentOwnerAddress,
      currentOwnerMemberId,
      currentKioskId,
      currentKioskCapOnChainId,
      listingObjectOnChainId: params.listingObjectOnChainId,
      listingStatus: params.listingStatus,
      listedPriceAtomic: toNullableDecimal(params.listedPriceAtomic),
    },
  })
  if (result.count === 0) {
    if (hasSoulMirrorOwnershipGuard(params)) {
      throw new SoulMirrorOwnershipConflictError(params.soulOnChainId)
    }
    throw new Error(`Soul ${params.soulOnChainId} not found`)
  }
}

export async function dbCancelSoulListing(params: {
  soulOnChainId: string
  expectedCurrentOwnerAddress?: string | null
  expectedCurrentKioskId?: string | null
  expectedListingStatus?: 'listed' | 'held'
  db?: SoulDbClient
}) {
  const db = params.db ?? prisma
  const result = await db.soulAsset.updateMany({
    where: buildSoulMirrorWhere(params),
    data: {
      listingObjectOnChainId: null,
      listingStatus: 'held',
      listedPriceAtomic: null,
    },
  })
  if (result.count === 0) {
    if (hasSoulMirrorOwnershipGuard(params)) {
      throw new SoulMirrorOwnershipConflictError(params.soulOnChainId)
    }
    throw new Error(`Soul ${params.soulOnChainId} not found`)
  }
}
