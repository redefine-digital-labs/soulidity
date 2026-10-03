import { assertCollectionPublicDeployment, readCollectionPublicRoot,
  type CollectionPublicDeployment, type CollectionPublicReadClient } from './collection-public-read'

export interface CollectionBindPreflight {
  readonly collectionId: string; readonly creatorAddress: string; readonly walletAddress: string
  readonly currentSupply: string; readonly maxSupply: string | null
  readonly collectionVersion: string; readonly collectionDigest: string
  readonly notTransactionAuthorization: true
}
const MAX_SUPPLY = 18446744073709551615n
function id(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/.test(value) || /^0x0+$/.test(value)) throw new Error('COLLECTION_BIND_INVALID_ID')
}

/** Read-only early check before paid upload/mint. Only the Collection creator
 * may bind Souls, even after selling its Right. Binding does not depend on the
 * Right's listing, holder, tradeability or member floor, so no Listing scan is
 * needed. The raw reader verifies chain/type/shared custody/canonical BCS and a
 * stable second read. Move still checks creator, Soul owner, unlisted state and
 * remaining capacity atomically when the mint+bind transaction executes. */
export async function preflightCollectionBindTarget(params: {
  client: CollectionPublicReadClient; deployment: CollectionPublicDeployment
  walletAddress: string; collectionId: string; signal: AbortSignal
}): Promise<CollectionBindPreflight> {
  const { walletAddress, collectionId } = params, client = params.client, signal = params.signal
  id(walletAddress); id(collectionId); signal.throwIfAborted()
  const deployment = assertCollectionPublicDeployment(params.deployment)
  const root = await readCollectionPublicRoot({ client, deployment, collectionId, signal })
  signal.throwIfAborted()
  const collection = root.collection
  if (collection.creator !== walletAddress) {
    throw new Error('Only the collection creator can add Souls to this collection.')
  }
  const current = BigInt(collection.current_supply)
  // Unbounded product supply still increments an on-chain u64 counter.
  if (current === MAX_SUPPLY || collection.max_supply !== null && current >= BigInt(collection.max_supply)) {
    throw new Error('Collection at maximum capacity')
  }
  return Object.freeze({ collectionId, creatorAddress: collection.creator, walletAddress,
    currentSupply: collection.current_supply, maxSupply: collection.max_supply,
    collectionVersion: root.objectVersion, collectionDigest: root.objectDigest, notTransactionAuthorization: true })
}
