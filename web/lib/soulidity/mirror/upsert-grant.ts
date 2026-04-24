import { prisma } from '@/lib/prisma'
import type { SoulGrantObject } from '@/lib/soulidity/types'

export async function upsertGrantProjection(params: {
  grant: SoulGrantObject
  soulOnChainId: string
  issuedByMemberId?: string | null
  granteeMemberId?: string | null
  status?: 'active' | 'revoked' | 'expired' | 'superseded' | 'invalidated'
  endedAt?: Date | null
  replacedByGrantOnChainId?: string | null
}) {
  return prisma.soulGrantRecord.upsert({
    where: { onChainId: params.grant.objectId },
    update: {
      soulOnChainId: params.soulOnChainId,
      issuedByMemberId: params.issuedByMemberId ?? null,
      issuedByAddress: params.grant.issuedByAddress,
      granteeMemberId: params.granteeMemberId ?? null,
      granteeAddress: params.grant.granteeAddress,
      scopes: params.grant.scopes,
      status: params.status ?? 'active',
      expiresAt: params.grant.expiresAtMs != null ? new Date(params.grant.expiresAtMs) : null,
      endedAt: params.endedAt ?? null,
      replacedByGrantOnChainId: params.replacedByGrantOnChainId ?? null,
    },
    create: {
      onChainId: params.grant.objectId,
      soulOnChainId: params.soulOnChainId,
      issuedByMemberId: params.issuedByMemberId ?? null,
      issuedByAddress: params.grant.issuedByAddress,
      granteeMemberId: params.granteeMemberId ?? null,
      granteeAddress: params.grant.granteeAddress,
      scopes: params.grant.scopes,
      status: params.status ?? 'active',
      expiresAt: params.grant.expiresAtMs != null ? new Date(params.grant.expiresAtMs) : null,
      endedAt: params.endedAt ?? null,
      replacedByGrantOnChainId: params.replacedByGrantOnChainId ?? null,
    },
  })
}

export async function endSoulGrantProjection(params: {
  grantOnChainId: string
  status: 'revoked' | 'expired' | 'superseded' | 'invalidated'
  endedAt?: Date | null
  replacedByGrantOnChainId?: string | null
}) {
  return prisma.soulGrantRecord.updateMany({
    where: { onChainId: params.grantOnChainId },
    data: {
      status: params.status,
      endedAt: params.endedAt ?? new Date(),
      replacedByGrantOnChainId: params.replacedByGrantOnChainId ?? null,
    },
  })
}

export async function endActiveSoulGrantProjections(params: {
  soulOnChainId: string
  status: 'revoked' | 'expired' | 'superseded' | 'invalidated'
  endedAt?: Date | null
}) {
  return prisma.soulGrantRecord.updateMany({
    where: {
      soulOnChainId: params.soulOnChainId,
      status: 'active',
    },
    data: {
      status: params.status,
      endedAt: params.endedAt ?? new Date(),
    },
  })
}
