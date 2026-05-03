import { prisma } from '@/lib/prisma'
import { assertBigIntFitsPrismaInt } from '@/lib/soulidity/projection-scalars'
import type { SoulCollectionObject, SoulCollectionRightObject } from '@/lib/soulidity/types'

export async function upsertCollectionProjection(params: {
  collection: SoulCollectionObject
  right: SoulCollectionRightObject
  // Required: must come from on-chain SoulCollection.current_supply. The DB
  // column was previously rebuilt via prisma.soulAsset.count which raced with
  // ownership transfers. Now soulCount mirrors current_supply 1:1 and is
  // monotonically increasing.
  currentSupply: bigint
  // null = unlimited. BigInt mirrors Move Option<u64>.
  maxSoulSupply: bigint | null
  creatorMemberId?: string | null
  currentHolderMemberId?: string | null
  listingObjectOnChainId?: string | null
  listedPriceAtomic?: bigint | null
  listingStatus?: 'held' | 'listed'
  floorPriceAtomic?: bigint | null
}) {
  assertBigIntFitsPrismaInt(params.currentSupply, 'SoulCollectionAsset.soulCount')
  const soulCount = Number(params.currentSupply)

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
      maxSoulSupply: params.maxSoulSupply,
      ...(params.floorPriceAtomic != null ? { floorPriceAtomic: params.floorPriceAtomic.toString() } : {}),
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
      maxSoulSupply: params.maxSoulSupply,
      ...(params.floorPriceAtomic != null ? { floorPriceAtomic: params.floorPriceAtomic.toString() } : {}),
    },
  })
}
