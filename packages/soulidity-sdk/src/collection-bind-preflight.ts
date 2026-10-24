import { assertCollectionPublicDeployment, readCollectionBindSnapshot,
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
 * remaining capacity, primary gate, provenance and combined royalties atomically
 * when the mint+bind transaction executes. */
export async function preflightCollectionBindTarget(params: {
  client: CollectionPublicReadClient; deployment: CollectionPublicDeployment
  walletAddress: string; collectionId: string; signal: AbortSignal
  souls: ReadonlyArray<{ hasAnimacraftProvenance: boolean; creatorRoyaltyBps: number }>
}): Promise<CollectionBindPreflight> {
  const { walletAddress, collectionId } = params, client = params.client, signal = params.signal
  id(walletAddress); id(collectionId); signal.throwIfAborted()
  const souls = structuredClone(params.souls)
  if (!Array.isArray(souls) || souls.length === 0 || souls.some(soul => !soul
    || typeof soul.hasAnimacraftProvenance !== 'boolean' || !Number.isSafeInteger(soul.creatorRoyaltyBps)
    || soul.creatorRoyaltyBps < 0 || soul.creatorRoyaltyBps > 10000)) {
    throw new Error('COLLECTION_BIND_SOULS_INVALID')
  }
  if (souls.some(soul => soul.hasAnimacraftProvenance)) {
    throw new Error('Animacraft native Souls cannot be added to a collection.')
  }
  const deployment = assertCollectionPublicDeployment(params.deployment)
  const root = await readCollectionBindSnapshot({ client, deployment, collectionId, signal })
  signal.throwIfAborted()
  const collection = root.collection
  if (collection.creator !== walletAddress) {
    throw new Error('Only the collection creator can add Souls to this collection.')
  }
  if (!root.market.primary_enabled) throw new Error('Primary Soul issuance is paused in the successor market.')
  if (souls.some(soul => root.market.platform_fee_bps + soul.creatorRoyaltyBps + collection.extra_royalty_bps > 10000)) {
    throw new Error('Combined platform + creator + collection royalty exceeds 100%.')
  }
  const current = BigInt(collection.current_supply)
  // Unbounded product supply still increments an on-chain u64 counter.
  const nextSupply = current + BigInt(souls.length)
  if (nextSupply > MAX_SUPPLY || collection.max_supply !== null && nextSupply > BigInt(collection.max_supply)) {
    throw new Error('Collection at maximum capacity')
  }
  return Object.freeze({ collectionId, creatorAddress: collection.creator, walletAddress,
    currentSupply: collection.current_supply, maxSupply: collection.max_supply,
    collectionVersion: root.objectVersion, collectionDigest: root.objectDigest, notTransactionAuthorization: true })
}
