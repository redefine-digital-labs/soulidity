import { prisma } from '@web/lib/prisma'
import { toProjectionBigInt } from '@/lib/soulidity/projection-scalars'

export async function upsertContentAccessProjection(params: {
  soulOnChainId: string
  accessListOnChainId: string
  granteeAddress: string
  scopeMask: number
  pricePaidAtomic: number | bigint
  grantedAtMs: number | bigint
  expiresAtMs?: number | bigint | null
}) {
  return prisma.contentAccessRecord.upsert({
    where: {
      content_access_unique: {
        accessListOnChainId: params.accessListOnChainId,
        granteeAddress: params.granteeAddress,
      },
    },
    update: {
      scopeMask: params.scopeMask,
      pricePaidAtomic: toProjectionBigInt(params.pricePaidAtomic, 'ContentAccess pricePaidAtomic'),
      grantedAtMs: toProjectionBigInt(params.grantedAtMs, 'ContentAccess grantedAtMs'),
      expiresAtMs: params.expiresAtMs != null ? toProjectionBigInt(params.expiresAtMs, 'ContentAccess expiresAtMs') : null,
      revokedAt: null,
    },
    create: {
      soulOnChainId: params.soulOnChainId,
      accessListOnChainId: params.accessListOnChainId,
      granteeAddress: params.granteeAddress,
      scopeMask: params.scopeMask,
      pricePaidAtomic: toProjectionBigInt(params.pricePaidAtomic, 'ContentAccess pricePaidAtomic'),
      grantedAtMs: toProjectionBigInt(params.grantedAtMs, 'ContentAccess grantedAtMs'),
      expiresAtMs: params.expiresAtMs != null ? toProjectionBigInt(params.expiresAtMs, 'ContentAccess expiresAtMs') : null,
    },
  })
}

export async function markContentAccessRevoked(params: {
  accessListOnChainId: string
  granteeAddress: string
}) {
  return prisma.contentAccessRecord.update({
    where: {
      content_access_unique: {
        accessListOnChainId: params.accessListOnChainId,
        granteeAddress: params.granteeAddress,
      },
    },
    data: { revokedAt: new Date() },
  })
}
