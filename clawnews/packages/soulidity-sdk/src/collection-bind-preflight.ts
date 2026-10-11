import type { CollectionDetailResponse } from './types'

type CollectionBindPreflight = Pick<
  CollectionDetailResponse,
  'onChainId' | 'isCreator' | 'currentSoulSupply' | 'maxSoulSupply'
>

export async function preflightCollectionBindTarget(
  headers: Record<string, string>,
  collectionOnChainId: string,
): Promise<CollectionBindPreflight> {
  const res = await fetch(`/api/collections/${encodeURIComponent(collectionOnChainId)}`, {
    cache: 'no-store',
    headers,
  })

  if (res.status === 404) {
    throw new Error('Collection not found. Refresh the collection page before adding a Soul.')
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || 'Failed to verify the target collection before minting')
  }

  const collection = await res.json() as CollectionBindPreflight
  if (collection.onChainId.toLowerCase() !== collectionOnChainId.toLowerCase()) {
    throw new Error('Collection verification returned a different collection. Refresh and retry.')
  }
  if (!collection.isCreator) {
    throw new Error('Only the collection creator can add Souls to this collection.')
  }
  if (collection.maxSoulSupply != null) {
    const current = BigInt(collection.currentSoulSupply)
    const cap = BigInt(collection.maxSoulSupply)
    if (current >= cap) {
      throw new Error('Collection at maximum capacity')
    }
  }

  return collection
}
