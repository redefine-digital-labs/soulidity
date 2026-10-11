import { prisma } from '@/lib/prisma'
import type { Prisma } from '@db/prisma-client'
import type { SealEnvelopeSidecar } from '@soulidity/sdk'
import {
  CANONICAL_MEMORY_NAME,
  CANONICAL_SOUL_DOC_NAME,
  KIND_MEMORY,
  KIND_SOUL_DOC,
} from '@soulidity/sdk'
import type { SoulDownloadPolicy } from '@soulidity/sdk'

// Retained mint/publish consumers may batch projection writes with a Prisma
// transaction. Ordinary append envelopes now persist atomically on chain;
// delete/purge/active recovery never relies on this mirror or a Seal sidecar.
type MirrorDbClient = Prisma.TransactionClient | typeof prisma

/**
 * Phase 2 unified content-version mirror. Called by post-TX sync routes
 * for every `ContentVersionAppended` event emitted by `content::*` /
 * `market::*` paths.
 */
export async function upsertContentVersionProjection(
  params: {
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
  },
  client: MirrorDbClient = prisma,
) {
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

  return client.soulContentVersionRecord.upsert({
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

function downloadPolicyToU8(policy: SoulDownloadPolicy): number {
  switch (policy) {
    case 'public': return 0
    case 'owner_only': return 1
    case 'allowlist': return 2
  }
}
