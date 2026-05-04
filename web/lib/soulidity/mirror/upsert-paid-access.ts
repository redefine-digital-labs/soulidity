import { prisma } from '@/lib/prisma'

/**
 * Phase 2 mirror writers for `SoulPaidAccessList`. Each function mirrors
 * one event emitted by `paid_access.move`:
 *
 *   SoulPaidAccessKindConfigured / Updated → upsertPaidAccessKindConfig
 *   SoulPaidAccessKindDeleted              → markPaidAccessKindConfigDeleted
 *   SoulPaidAccessGranted                  → upsertPaidAccessEntry
 *   SoulPaidAccessRevoked                  → markPaidAccessEntryRevoked
 *
 * Stale ownership-epoch entries are NOT auto-purged here — they remain in
 * the table for audit purposes and are filtered out by `access.ts` access
 * resolution. Operators may run a cron with
 * `paid_access::cleanup_stale_entries` + a follow-up sync to reclaim
 * storage rebate.
 */
export async function upsertPaidAccessKindConfig(params: {
  soulOnChainId: string
  paidAccessListOnChainId: string
  kind: number
  version: number
  priceAtomic: bigint | number
  scopeMask: number
  durationMs?: number | bigint | null
  ownershipEpochSnapshot: number
}) {
  const priceAtomic = BigInt(params.priceAtomic).toString()
  const durationMs = params.durationMs == null ? null : BigInt(params.durationMs)
  return prisma.soulPaidAccessKindConfig.upsert({
    where: {
      paidAccessListOnChainId_kind: {
        paidAccessListOnChainId: params.paidAccessListOnChainId,
        kind: params.kind,
      },
    },
    update: {
      soulOnChainId: params.soulOnChainId,
      version: params.version,
      priceAtomic,
      scopeMask: params.scopeMask,
      durationMs,
      ownershipEpochSnapshot: params.ownershipEpochSnapshot,
      deletedAt: null,
    },
    create: {
      soulOnChainId: params.soulOnChainId,
      paidAccessListOnChainId: params.paidAccessListOnChainId,
      kind: params.kind,
      version: params.version,
      priceAtomic,
      scopeMask: params.scopeMask,
      durationMs,
      ownershipEpochSnapshot: params.ownershipEpochSnapshot,
    },
  })
}

export async function markPaidAccessKindConfigDeleted(params: {
  paidAccessListOnChainId: string
  kind: number
  deletedAt?: Date | null
}) {
  return prisma.soulPaidAccessKindConfig.update({
    where: {
      paidAccessListOnChainId_kind: {
        paidAccessListOnChainId: params.paidAccessListOnChainId,
        kind: params.kind,
      },
    },
    data: {
      deletedAt: params.deletedAt ?? new Date(),
    },
  })
}

export async function upsertPaidAccessEntry(params: {
  soulOnChainId: string
  paidAccessListOnChainId: string
  buyerAddress: string
  kind: number
  version: number
  scopeMask: number
  pricePaidAtomic: bigint | number
  expiresAtMs?: number | bigint | null
  ownershipEpochSnapshot: number
  createdAtMs: number | bigint
}) {
  const pricePaidAtomic = BigInt(params.pricePaidAtomic).toString()
  const expiresAtMs = params.expiresAtMs == null ? null : BigInt(params.expiresAtMs)
  const createdAtMs = BigInt(params.createdAtMs)
  return prisma.soulPaidAccessEntry.upsert({
    where: {
      buyerAddress_paidAccessListOnChainId_kind: {
        buyerAddress: params.buyerAddress,
        paidAccessListOnChainId: params.paidAccessListOnChainId,
        kind: params.kind,
      },
    },
    update: {
      soulOnChainId: params.soulOnChainId,
      version: params.version,
      scopeMask: params.scopeMask,
      pricePaidAtomic,
      expiresAtMs,
      ownershipEpochSnapshot: params.ownershipEpochSnapshot,
      createdAtMs,
      revokedAt: null,
    },
    create: {
      soulOnChainId: params.soulOnChainId,
      paidAccessListOnChainId: params.paidAccessListOnChainId,
      buyerAddress: params.buyerAddress,
      kind: params.kind,
      version: params.version,
      scopeMask: params.scopeMask,
      pricePaidAtomic,
      expiresAtMs,
      ownershipEpochSnapshot: params.ownershipEpochSnapshot,
      createdAtMs,
    },
  })
}

export async function markPaidAccessEntryRevoked(params: {
  paidAccessListOnChainId: string
  buyerAddress: string
  kind: number
  revokedAt?: Date | null
}) {
  return prisma.soulPaidAccessEntry.update({
    where: {
      buyerAddress_paidAccessListOnChainId_kind: {
        buyerAddress: params.buyerAddress,
        paidAccessListOnChainId: params.paidAccessListOnChainId,
        kind: params.kind,
      },
    },
    data: {
      revokedAt: params.revokedAt ?? new Date(),
    },
  })
}
