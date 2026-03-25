/**
 * Post-TX DB write functions.
 *
 * Each function mirrors a former indexer event handler but accepts data
 * directly from the TX result instead of decoded on-chain events.
 * All writes use upsert/updateMany for idempotency.
 */

import { Prisma } from '../../../generated/prisma/client'
import { isValidSuiAddress, normalizeSuiAddress } from '@mysten/sui/utils'
import { prisma } from '@web/lib/prisma'

const MS_PER_DAY = 86_400_000
const MAX_SAFE_PERIOD_MS = BigInt(Number.MAX_SAFE_INTEGER)
type SoulDbClient = typeof prisma | Prisma.TransactionClient

function isPrismaUniqueConstraintError(error: unknown): error is { code: string } {
  return typeof error === 'object' && error != null && 'code' in error && typeof error.code === 'string'
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

// ---------------------------------------------------------------------------
// Wallet → Member resolution (shared helper)
// ---------------------------------------------------------------------------

async function resolveOwnerMemberId(db: SoulDbClient, address: string): Promise<string | null> {
  const binding = await db.walletBinding.findFirst({
    where: { address, chain: 'sui' },
  })
  return binding?.memberId ?? null
}

// ---------------------------------------------------------------------------
// Series
// ---------------------------------------------------------------------------

export async function dbCreateSeries(params: {
  seriesOnChainId: string
  authorAddress: string
  authorMemberId: string
  name: string
  description: string
  category: string
  tags: string[]
  previewImages: string[]
  readme?: string
  db?: SoulDbClient
}) {
  const db = params.db ?? prisma
  const existingSeries = await db.soulSeries.findUnique({
    where: { onChainId: params.seriesOnChainId },
    select: {
      authorMemberId: true,
      authorAddress: true,
    },
  })
  if (
    existingSeries
    && (
      existingSeries.authorMemberId !== params.authorMemberId
      || !sameSuiAddress(existingSeries.authorAddress, params.authorAddress)
    )
  ) {
    throw new Error('existing Soul series author does not match the submitted on-chain author')
  }

  return db.soulSeries.upsert({
    where: { onChainId: params.seriesOnChainId },
    create: {
      onChainId: params.seriesOnChainId,
      authorMemberId: params.authorMemberId,
      authorAddress: params.authorAddress,
      name: params.name,
      description: params.description,
      category: params.category,
      tags: params.tags,
      previewImages: params.previewImages,
      readme: params.readme ?? null,
    },
    update: {
      authorAddress: params.authorAddress,
      name: params.name,
      description: params.description,
      category: params.category,
      tags: params.tags,
      previewImages: params.previewImages,
      readme: params.readme ?? null,
    },
  })
}

// ---------------------------------------------------------------------------
// Release
// ---------------------------------------------------------------------------

export async function dbCreateRelease(params: {
  releaseOnChainId: string
  seriesDbId: string
  seriesLatestReleaseOnChainId: string | null
  version: string
  walrusBlobRef: string
  publicMetadataRef?: string | null
  contentHash: string
  changelog?: string | null
  db?: SoulDbClient
}) {
  const db = params.db ?? prisma
  let release
  try {
    release = await db.soulRelease.upsert({
      where: { onChainId: params.releaseOnChainId },
      create: {
        onChainId: params.releaseOnChainId,
        seriesId: params.seriesDbId,
        version: params.version,
        walrusBlobRef: params.walrusBlobRef,
        publicMetadataRef: params.publicMetadataRef ?? null,
        contentHash: params.contentHash,
        changelog: params.changelog ?? null,
      },
      update: {
        seriesId: params.seriesDbId,
        version: params.version,
        walrusBlobRef: params.walrusBlobRef,
        publicMetadataRef: params.publicMetadataRef ?? null,
        contentHash: params.contentHash,
        changelog: params.changelog ?? null,
      },
    })
  } catch (error) {
    if (!isPrismaUniqueConstraintError(error) || error.code !== 'P2002') {
      throw error
    }

    release = await db.soulRelease.update({
      where: {
        seriesId_version: {
          seriesId: params.seriesDbId,
          version: params.version,
        },
      },
      data: {
        onChainId: params.releaseOnChainId,
        walrusBlobRef: params.walrusBlobRef,
        publicMetadataRef: params.publicMetadataRef ?? null,
        contentHash: params.contentHash,
        changelog: params.changelog ?? null,
      },
    })
  }

  if (
    params.seriesLatestReleaseOnChainId
    && sameSuiAddress(params.seriesLatestReleaseOnChainId, params.releaseOnChainId)
  ) {
    await db.soulSeries.update({
      where: { id: params.seriesDbId },
      data: { latestReleaseId: release.id },
    })
  }

  return release
}

// ---------------------------------------------------------------------------
// Pricing Plan
// ---------------------------------------------------------------------------

export async function dbUpdatePricingPlan(params: {
  seriesOnChainId: string
  planType: 'onetime' | 'subscription'
  planOnChainId: string
  priceUsdc: bigint // atomic USDC (6 decimals)
  periodMs?: bigint
  db?: SoulDbClient
}) {
  const db = params.db ?? prisma
  const priceAtomic = new Prisma.Decimal(params.priceUsdc.toString())

  if (params.planType === 'onetime') {
    await db.soulSeries.updateMany({
      where: { onChainId: params.seriesOnChainId },
      data: {
        oneTimePriceUsdc: priceAtomic,
        oneTimePlanOnChainId: params.planOnChainId,
      },
    })
  } else {
    if (params.periodMs == null || params.periodMs <= 0n) {
      throw new Error('subscription pricing plans require a positive periodMs')
    }
    if (params.periodMs > MAX_SAFE_PERIOD_MS) {
      throw new Error('subscription periodMs exceeds supported range')
    }
    const periodDays = Math.ceil(Number(params.periodMs) / MS_PER_DAY)
    await db.soulSeries.updateMany({
      where: { onChainId: params.seriesOnChainId },
      data: {
        subPriceUsdc: priceAtomic,
        subPlanOnChainId: params.planOnChainId,
        subPeriodDays: periodDays,
      },
    })
  }
}

// ---------------------------------------------------------------------------
// Pass
// ---------------------------------------------------------------------------

export async function dbCreatePass(params: {
  passOnChainId: string
  seriesOnChainId: string
  ownerAddress: string
  ownerMemberId?: string | null
  passType: 'perpetual' | 'subscription'
  lockedReleaseId?: string | null
  expiresAt?: Date | null
  mintTxDigest: string
  db?: SoulDbClient
}) {
  const db = params.db ?? prisma
  if (params.passType === 'perpetual' && !params.lockedReleaseId) {
    throw new Error('perpetual passes require a lockedReleaseId')
  }
  if (params.passType === 'subscription' && params.lockedReleaseId != null) {
    throw new Error('subscription passes cannot set lockedReleaseId')
  }

  // Resolve ownerMemberId if not provided
  const ownerMemberId = params.ownerMemberId ?? (await resolveOwnerMemberId(db, params.ownerAddress))

  // Look up series DB id
  const series = await db.soulSeries.findUnique({
    where: { onChainId: params.seriesOnChainId },
  })
  if (!series) {
    throw new Error(`Series ${params.seriesOnChainId} not found in DB`)
  }

  return db.soulPassSnapshot.upsert({
    where: { onChainId: params.passOnChainId },
    create: {
      onChainId: params.passOnChainId,
      seriesId: series.id,
      ownerAddress: params.ownerAddress,
      ownerMemberId,
      passType: params.passType,
      lockedReleaseId: params.lockedReleaseId ?? null,
      expiresAt: params.expiresAt ?? null,
      mintTxDigest: params.mintTxDigest,
    },
    update: {
      seriesId: series.id,
      ownerAddress: params.ownerAddress,
      ownerMemberId,
      passType: params.passType,
      lockedReleaseId: params.lockedReleaseId ?? null,
      expiresAt: params.expiresAt ?? null,
      mintTxDigest: params.mintTxDigest,
    },
  })
}

// ---------------------------------------------------------------------------
// Renew
// ---------------------------------------------------------------------------

export async function dbRenewPass(params: {
  passOnChainId: string
  newExpiresAt: Date
  renewTxDigest: string
  db?: SoulDbClient
}): Promise<void> {
  const db = params.db ?? prisma
  const result = await db.soulPassSnapshot.updateMany({
    where: {
      onChainId: params.passOnChainId,
      passType: 'subscription',
    },
    data: {
      expiresAt: params.newExpiresAt,
      lastRenewTxDigest: params.renewTxDigest,
      lastSyncedAt: new Date(),
    },
  })
  if (result.count === 0) {
    throw new Error(`Subscription pass ${params.passOnChainId} not found`)
  }
}

// ---------------------------------------------------------------------------
// Agent Grant
// ---------------------------------------------------------------------------

export async function dbSetAgentGrant(params: {
  passOnChainId: string
  agentAddress: string
  db?: SoulDbClient
}) {
  const db = params.db ?? prisma
  const result = await db.soulPassSnapshot.updateMany({
    where: { onChainId: params.passOnChainId },
    data: { agentGrant: params.agentAddress },
  })
  if (result.count === 0) {
    throw new Error(`Pass ${params.passOnChainId} not found`)
  }
}

export async function dbRevokeAgentGrant(params: {
  passOnChainId: string
  db?: SoulDbClient
}) {
  const db = params.db ?? prisma
  const result = await db.soulPassSnapshot.updateMany({
    where: { onChainId: params.passOnChainId },
    data: { agentGrant: null },
  })
  if (result.count === 0) {
    throw new Error(`Pass ${params.passOnChainId} not found`)
  }
}
