import { prisma } from '@web/lib/prisma'
import type { MemoryEntryObject } from '@/lib/soulidity/types'
import { toProjectionBigInt } from '@/lib/soulidity/projection-scalars'

export async function upsertMemoryEntryProjection(params: {
  entry: MemoryEntryObject
  sealSidecar?: object | null
}) {
  const timestampKey = toProjectionBigInt(params.entry.timestampKey, 'MemoryEntry timestampKey')
  return prisma.soulMemoryEntry.upsert({
    where: {
      memoryOnChainId_timestampKey: {
        memoryOnChainId: params.entry.memoryId,
        timestampKey,
      },
    },
    update: {
      soulOnChainId: params.entry.soulId,
      memoryOnChainId: params.entry.memoryId,
      timestampKey,
      writerAddress: params.entry.writerAddress,
      writerKind: params.entry.writerKind,
      blobObjectId: params.entry.blobObjectId,
      blobId: params.entry.blobId,
      createdAtMs: toProjectionBigInt(params.entry.createdAtMs, 'MemoryEntry createdAtMs'),
      sealSidecar: params.sealSidecar ?? undefined,
    },
    create: {
      soulOnChainId: params.entry.soulId,
      memoryOnChainId: params.entry.memoryId,
      timestampKey,
      writerAddress: params.entry.writerAddress,
      writerKind: params.entry.writerKind,
      blobObjectId: params.entry.blobObjectId,
      blobId: params.entry.blobId,
      createdAtMs: toProjectionBigInt(params.entry.createdAtMs, 'MemoryEntry createdAtMs'),
      sealSidecar: params.sealSidecar ?? undefined,
    },
  })
}
