/**
 * Post-TX DB write functions.
 *
 * Each function mirrors a former indexer event handler but accepts data
 * directly from the TX result instead of decoded on-chain events.
 * All writes use upsert/updateMany for idempotency.
 */

import { Prisma } from '../../../generated/prisma/client'
import { prisma } from '@web/lib/prisma'

const USDC_ATOMIC_TO_CENTS = 10_000n
const HALF_CENT_IN_ATOMIC_USDC = 5_000n
const MS_PER_DAY = 86_400_000
type SoulDbClient = typeof prisma | Prisma.TransactionClient

function atomicUsdcToRoundedCents(amountUsdc: bigint): number {
  if (amountUsdc <= 0n) {
    return 0
  }

  const rounded = (amountUsdc + HALF_CENT_IN_ATOMIC_USDC) / USDC_ATOMIC_TO_CENTS
  return Number(rounded === 0n ? 1n : rounded)
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
      authorMemberId: params.authorMemberId,
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
  version: string
  walrusBlobRef: string
  publicMetadataRef?: string | null
  contentHash: string
  changelog?: string | null
  db?: SoulDbClient
}) {
  const db = params.db ?? prisma
  const release = await db.soulRelease.upsert({
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
      version: params.version,
      walrusBlobRef: params.walrusBlobRef,
      publicMetadataRef: params.publicMetadataRef ?? null,
      contentHash: params.contentHash,
      changelog: params.changelog ?? null,
    },
  })

  // Update series latestReleaseId
  await db.soulSeries.update({
    where: { id: params.seriesDbId },
    data: { latestReleaseId: release.id },
  })

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
  const priceCents = atomicUsdcToRoundedCents(params.priceUsdc)

  if (params.planType === 'onetime') {
    await db.soulSeries.updateMany({
      where: { onChainId: params.seriesOnChainId },
      data: {
        oneTimePriceUsdc: priceCents,
        oneTimePlanOnChainId: params.planOnChainId,
      },
    })
  } else {
    const periodDays = Math.ceil(Number(params.periodMs ?? 0n) / MS_PER_DAY)
    await db.soulSeries.updateMany({
      where: { onChainId: params.seriesOnChainId },
      data: {
        subPriceUsdc: priceCents,
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
