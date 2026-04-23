import { PrismaRuntime } from '@db/prisma-client'
import { prisma } from '@/lib/prisma'
import type { SoulMetadataObject, SoulObject, SoulStateObject, SoulMemoryObject } from '@/lib/soulidity/types'
import type { Prisma } from '@db/prisma-client'

export async function upsertSoulProjection(params: {
  soul: SoulObject
  state: SoulStateObject
  memory: SoulMemoryObject
  metadata?: SoulMetadataObject | null
  currentKioskCapOnChainId: string
  creatorMemberId?: string | null
  currentOwnerMemberId?: string | null
  tags: string[]
  previewImages: string[]
  readme?: string | null
  sealSidecar?: Prisma.InputJsonValue | null
  listingObjectOnChainId?: string | null
  listedPriceAtomic?: bigint | null
  listingStatus?: 'held' | 'listed' | 'floor-violation'
}) {
  // Prevent RPC indexing lag from nulling out a previously-mirrored skillsOnChainId.
  // On-chain state queries can transiently return null for skills_id right after a
  // purchase or ownership transfer. Only overwrite with a non-null chain value.
  const skillsUpdate = params.state.skillsId != null
    ? { skillsOnChainId: params.state.skillsId }
    : {}

  const assetsUpdate = params.state.assetsId != null
    ? { assetsOnChainId: params.state.assetsId }
    : {}

  const accessListUpdate = params.state.accessListId != null
    ? { accessListOnChainId: params.state.accessListId }
    : {}

  const result = await prisma.soulAsset.upsert({
    where: { onChainId: params.soul.objectId },
    update: {
      stateOnChainId: params.state.objectId,
      memoryOnChainId: params.memory.objectId,
      creatorMemberId: params.creatorMemberId ?? null,
      creatorAddress: params.soul.creatorAddress,
      creatorRoyaltyBps: params.state.creatorRoyaltyBps,
      currentOwnerMemberId: params.currentOwnerMemberId ?? null,
      currentOwnerAddress: params.state.currentOwnerAddress,
      currentKioskId: params.state.currentKioskId,
      currentKioskCapOnChainId: params.currentKioskCapOnChainId,
      listingObjectOnChainId: params.listingObjectOnChainId ?? null,
      listedPriceAtomic: params.listedPriceAtomic?.toString() ?? null,
      listingStatus: params.listingStatus ?? 'held',
      name: params.soul.name,
      description: params.soul.description,
      imageUrl: params.soul.imageUrl,
      metadataOnChainId: params.metadata?.objectId ?? params.state.metadataId ?? null,
      activeSpriteAssetName: params.metadata?.activeSprite?.assetName ?? null,
      activeSpriteVersionIndex: params.metadata?.activeSprite?.versionIndex ?? null,
      activeSpriteDownloadPolicy: params.metadata?.activeSprite?.downloadPolicy ?? null,
      activeVoiceAssetName: params.metadata?.activeVoice?.assetName ?? null,
      activeVoiceVersionIndex: params.metadata?.activeVoice?.versionIndex ?? null,
      activeVoiceDownloadPolicy: params.metadata?.activeVoice?.downloadPolicy ?? null,
      spriteConfigJson: params.metadata?.spriteConfigJson ?? null,
      spriteMoodMapJson: params.metadata?.spriteMoodMapJson ?? null,
      voiceConfigJson: params.metadata?.voiceConfigJson ?? null,
      contentBlobId: params.soul.protectedBlobId ?? params.soul.protectedBlobObjectId,
      contentBlobObjectId: params.soul.protectedBlobObjectId,
      provenanceKind: params.soul.provenanceKind,
      originRef: params.soul.originRef,
      collectionOnChainId: params.state.collectionId,
      grantCapacity: params.state.grantCapacity,
      activeGrantCount: params.state.activeGrantCount,
      ...skillsUpdate,
      ...assetsUpdate,
      ...accessListUpdate,
      sealSidecar: params.sealSidecar ?? PrismaRuntime.DbNull,
      tags: params.tags,
      previewImages: params.previewImages,
      readme: params.readme ?? null,
    },
    create: {
      onChainId: params.soul.objectId,
      stateOnChainId: params.state.objectId,
      memoryOnChainId: params.memory.objectId,
      creatorMemberId: params.creatorMemberId ?? null,
      creatorAddress: params.soul.creatorAddress,
      creatorRoyaltyBps: params.state.creatorRoyaltyBps,
      currentOwnerMemberId: params.currentOwnerMemberId ?? null,
      currentOwnerAddress: params.state.currentOwnerAddress,
      currentKioskId: params.state.currentKioskId,
      currentKioskCapOnChainId: params.currentKioskCapOnChainId,
      listingObjectOnChainId: params.listingObjectOnChainId ?? null,
      listedPriceAtomic: params.listedPriceAtomic?.toString() ?? null,
      listingStatus: params.listingStatus ?? 'held',
      name: params.soul.name,
      description: params.soul.description,
      imageUrl: params.soul.imageUrl,
      metadataOnChainId: params.metadata?.objectId ?? params.state.metadataId ?? null,
      activeSpriteAssetName: params.metadata?.activeSprite?.assetName ?? null,
      activeSpriteVersionIndex: params.metadata?.activeSprite?.versionIndex ?? null,
      activeSpriteDownloadPolicy: params.metadata?.activeSprite?.downloadPolicy ?? null,
      activeVoiceAssetName: params.metadata?.activeVoice?.assetName ?? null,
      activeVoiceVersionIndex: params.metadata?.activeVoice?.versionIndex ?? null,
      activeVoiceDownloadPolicy: params.metadata?.activeVoice?.downloadPolicy ?? null,
      spriteConfigJson: params.metadata?.spriteConfigJson ?? null,
      spriteMoodMapJson: params.metadata?.spriteMoodMapJson ?? null,
      voiceConfigJson: params.metadata?.voiceConfigJson ?? null,
      contentBlobId: params.soul.protectedBlobId ?? params.soul.protectedBlobObjectId,
      contentBlobObjectId: params.soul.protectedBlobObjectId,
      provenanceKind: params.soul.provenanceKind,
      originRef: params.soul.originRef,
      collectionOnChainId: params.state.collectionId,
      grantCapacity: params.state.grantCapacity,
      activeGrantCount: params.state.activeGrantCount,
      skillsOnChainId: params.state.skillsId,
      assetsOnChainId: params.state.assetsId,
      accessListOnChainId: params.state.accessListId,
      sealSidecar: params.sealSidecar ?? PrismaRuntime.DbNull,
      tags: params.tags,
      previewImages: params.previewImages,
      readme: params.readme ?? null,
    },
  })

  // Keep collection soulCount in sync when a Soul belongs to a collection
  const collectionId = params.state.collectionId
  if (collectionId) {
    const count = await prisma.soulAsset.count({
      where: { collectionOnChainId: collectionId },
    })
    await prisma.soulCollectionAsset.updateMany({
      where: { onChainId: collectionId },
      data: { soulCount: count },
    })
  }

  return result
}
