import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { readCollectionListingCandidate, readCollectionRightCustody } from '@soulidity/sdk'
import { MAINNET_GENESIS_DIGEST } from '../animacraft/mainnet-chain'
import { check, parseCollectionCommandTarget, type CollectionCommandPlan, type CollectionCommandQuery } from './collection-command-plan'
import { collectionCommandChain, collectionCommandSignal } from './collection-command-state'

/** Read the historical command's exact Listing and current Right custody separately. */
export async function readCollectionCommandListing({ client, plan, receipt, signal: parent }: {
  client: SuiGrpcClient; plan: CollectionCommandPlan; receipt: NonNullable<CollectionCommandQuery['receipt']>; signal?: AbortSignal
}) {
  const target = parseCollectionCommandTarget(plan.target), signal = collectionCommandSignal(parent)
  const { callablePackageId: _callable, callableDigest: _digest, ...deployment } = target
  const { collectionId, rightId, oldListingId, newListingId, priceAtomic } = receipt
  const listingId = newListingId ?? oldListingId
  check(collectionId === plan.request.collectionId && rightId === plan.rightId && oldListingId === plan.oldListingId
    && priceAtomic === plan.request.priceAtomic && listingId, 'CURRENT_LISTING_RECEIPT')
  const genesis = await collectionCommandChain(client, target, signal)
  if (target.chainIdentifier === '35834a8a') check(genesis === MAINNET_GENESIS_DIGEST, 'WRONG_MAINNET')

  const [custody, observation] = await Promise.all([
    readCollectionRightCustody({ client, deployment, collectionId, rightId, signal }),
    readCollectionListingCandidate({ client, deployment, listingId, signal }),
  ])
  const listing = observation?.listing
  if (listing) check(listing.collection_id === collectionId && listing.right_id === rightId
    && listing.seller === plan.author && listing.seller_kiosk_id === plan.kioskId
    && (priceAtomic === null || listing.price === priceAtomic)
    && (newListingId !== null || !listing.is_active), 'CURRENT_LISTING_IDENTITY')
  return { ...custody, listingId, listingStatus: listing ? listing.is_active ? 'ACTIVE' as const : 'INACTIVE' as const : 'UNAVAILABLE' as const }
}
