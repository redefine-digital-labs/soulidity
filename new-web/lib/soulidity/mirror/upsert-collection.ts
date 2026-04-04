import { prisma } from '@web/lib/prisma'
import type { SoulCollectionObject, SoulCollectionRightObject } from '@/lib/soulidity/types'

export async function upsertCollectionProjection(params: {
  collection: SoulCollectionObject
  right: SoulCollectionRightObject
  creatorMemberId?: string | null
  currentHolderMemberId?: string | null
  listingObjectOnChainId?: string | null
  listedPriceAtomic?: bigint | null
  listingStatus?: 'held' | 'listed'
}) {
  const soulCount = await prisma.soulAsset.count({
    where: { collectionOnChainId: params.collection.objectId },
  })

  return prisma.soulCollectionAsset.upsert({
    where: { onChainId: params.collection.objectId },
    update: {
      rightOnChainId: params.right.objectId,
      creatorMemberId: params.creatorMemberId ?? null,
      creatorAddress: params.collection.creatorAddress,
      currentHolderMemberId: params.currentHolderMemberId ?? null,
      currentHolderAddress: params.collection.currentHolderAddress,
      currentHolderKioskId: params.collection.currentHolderKioskId,
      name: params.right.name,
      description: params.right.description,
      imageUrl: params.right.imageUrl,
      extraRoyaltyBps: params.collection.extraRoyaltyBps,
      tradeable: params.collection.tradeable,
      listingObjectOnChainId: params.listingObjectOnChainId ?? null,
      listedPriceAtomic: params.listedPriceAtomic?.toString() ?? null,
      listingStatus: params.listingStatus ?? 'held',
      soulCount,
    },
    create: {
      onChainId: params.collection.objectId,
      rightOnChainId: params.right.objectId,
      creatorMemberId: params.creatorMemberId ?? null,
      creatorAddress: params.collection.creatorAddress,
      currentHolderMemberId: params.currentHolderMemberId ?? null,
      currentHolderAddress: params.collection.currentHolderAddress,
      currentHolderKioskId: params.collection.currentHolderKioskId,
      name: params.right.name,
      description: params.right.description,
      imageUrl: params.right.imageUrl,
      extraRoyaltyBps: params.collection.extraRoyaltyBps,
      tradeable: params.collection.tradeable,
      listingObjectOnChainId: params.listingObjectOnChainId ?? null,
      listedPriceAtomic: params.listedPriceAtomic?.toString() ?? null,
      listingStatus: params.listingStatus ?? 'held',
      soulCount,
    },
  })
}

