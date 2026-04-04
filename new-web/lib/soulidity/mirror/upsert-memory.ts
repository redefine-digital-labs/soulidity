import { prisma } from '@web/lib/prisma'
import type { MemoryEntryObject } from '@/lib/soulidity/types'
import { toProjectionBigInt } from '@/lib/soulidity/projection-scalars'

export async function upsertMemoryEntryProjection(params: {
  entry: MemoryEntryObject
  memoryOnChainId: string
}) {
  return prisma.soulMemoryEntry.upsert({
    where: { onChainId: params.entry.objectId },
    update: {
      soulOnChainId: params.entry.soulId,
      memoryOnChainId: params.memoryOnChainId,
      entryIndex: params.entry.index,
      writerAddress: params.entry.writerAddress,
      writerKind: params.entry.writerKind,
      blobObjectId: params.entry.blobObjectId,
      blobId: params.entry.blobId,
      createdAtMs: toProjectionBigInt(params.entry.createdAtMs, 'MemoryEntry createdAtMs'),
    },
    create: {
      onChainId: params.entry.objectId,
      soulOnChainId: params.entry.soulId,
      memoryOnChainId: params.memoryOnChainId,
      entryIndex: params.entry.index,
      writerAddress: params.entry.writerAddress,
      writerKind: params.entry.writerKind,
      blobObjectId: params.entry.blobObjectId,
      blobId: params.entry.blobId,
      createdAtMs: toProjectionBigInt(params.entry.createdAtMs, 'MemoryEntry createdAtMs'),
    },
  })
}
