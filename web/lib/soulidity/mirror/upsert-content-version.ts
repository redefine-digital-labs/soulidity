import { prisma } from '@/lib/prisma'
import type { Prisma } from '@db/prisma-client'
import type { SealEnvelopeSidecar } from '@/lib/services/seal-crypto'
import {
  CANONICAL_MEMORY_NAME,
  CANONICAL_SOUL_DOC_NAME,
  KIND_MEMORY,
  KIND_SOUL_DOC,
} from '@/lib/soulidity/kinds'
import type { SoulDownloadPolicy } from '@/lib/soulidity/types'

/**
 * Phase 2 unified content-version mirror. Called by post-TX sync routes
 * for every `ContentVersionAppended` event emitted by `content::*` /
 * `market::*` paths.
 */
export async function upsertContentVersionProjection(params: {
  soulOnChainId: string
  contentOnChainId: string
  kind: number
  kindName: string
  name: string
  versionIndex: number
  blobObjectId: string
  blobId?: string | null
  readModeMask: number
  opMask: number
  grantScopeMask: number
  isPublic: boolean
  sealEncrypted: boolean
  downloadPolicy: SoulDownloadPolicy
  sealSidecar?: SealEnvelopeSidecar | null
  createdAtMs: number | bigint
}) {
  // Defensive: invariant kinds must use their canonical names. The chain
  // already enforces this via `EMemoryNameMismatch` / `ESoulDocNameMismatch`,
  // but bad data would corrupt the mirror PK so we double-check.
  if (params.kind === KIND_SOUL_DOC && params.name !== CANONICAL_SOUL_DOC_NAME) {
    throw new Error(`SOUL_DOC slot name must be "${CANONICAL_SOUL_DOC_NAME}"`)
  }
  if (params.kind === KIND_MEMORY && params.name !== CANONICAL_MEMORY_NAME) {
    throw new Error(`MEMORY slot name must be "${CANONICAL_MEMORY_NAME}"`)
  }

  const sealSidecar: Prisma.InputJsonValue | typeof Prisma.JsonNull = params.sealSidecar
    ? (params.sealSidecar as unknown as Prisma.InputJsonValue)
    : (await import('@db/prisma-client')).PrismaRuntime.JsonNull

  const downloadPolicyU8 = downloadPolicyToU8(params.downloadPolicy)
  const createdAtMs = BigInt(params.createdAtMs)

  return prisma.soulContentVersionRecord.upsert({
    where: {
      contentOnChainId_kind_name_versionIndex: {
        contentOnChainId: params.contentOnChainId,
        kind: params.kind,
        name: params.name,
        versionIndex: params.versionIndex,
      },
    },
    update: {
      soulOnChainId: params.soulOnChainId,
      kindName: params.kindName,
      blobObjectId: params.blobObjectId,
      blobId: params.blobId ?? null,
      readModeMask: params.readModeMask,
      opMask: params.opMask,
      grantScopeMask: params.grantScopeMask,
      isPublic: params.isPublic,
      sealEncrypted: params.sealEncrypted,
      downloadPolicy: downloadPolicyU8,
      sealSidecar,
      createdAtMs,
    },
    create: {
      soulOnChainId: params.soulOnChainId,
      contentOnChainId: params.contentOnChainId,
      kind: params.kind,
      kindName: params.kindName,
      name: params.name,
      versionIndex: params.versionIndex,
      blobObjectId: params.blobObjectId,
      blobId: params.blobId ?? null,
      readModeMask: params.readModeMask,
      opMask: params.opMask,
      grantScopeMask: params.grantScopeMask,
      isPublic: params.isPublic,
      sealEncrypted: params.sealEncrypted,
      downloadPolicy: downloadPolicyU8,
      sealSidecar,
      createdAtMs,
    },
  })
}

export async function markContentVersionDeleted(params: {
  contentOnChainId: string
  kind: number
  name: string
  versionIndex: number
  deletedAt?: Date | null
}) {
  return prisma.soulContentVersionRecord.update({
    where: {
      contentOnChainId_kind_name_versionIndex: {
        contentOnChainId: params.contentOnChainId,
        kind: params.kind,
        name: params.name,
        versionIndex: params.versionIndex,
      },
    },
    data: {
      deletedAt: params.deletedAt ?? new Date(),
    },
  })
}

export async function markContentVersionPurged(params: {
  contentOnChainId: string
  kind: number
  name: string
  versionIndex: number
  purgedAt?: Date | null
}) {
  return prisma.soulContentVersionRecord.update({
    where: {
      contentOnChainId_kind_name_versionIndex: {
        contentOnChainId: params.contentOnChainId,
        kind: params.kind,
        name: params.name,
        versionIndex: params.versionIndex,
      },
    },
    data: {
      purgedAt: params.purgedAt ?? new Date(),
    },
  })
}

function downloadPolicyToU8(policy: SoulDownloadPolicy): number {
  switch (policy) {
    case 'public': return 0
    case 'owner_only': return 1
    case 'allowlist': return 2
  }
}
