import type { SuiGrpcClient } from '@mysten/sui/grpc'
import type { ActivityCheckpointTransactionRef } from '../soulidity/activity-transaction-evidence'
import type { CollectionBuyQuery, CollectionBuyRecord } from './collection-buy-plan'
import { parseCollectionCommandRecord, queryCollectionCommandOriginal } from './collection-command-operation'
import { check, same, type CollectionCommandQuery, type CollectionCommandRecord, type CollectionCommandTarget } from './collection-command-plan'

export type CollectionBuyerListingExpectation = {
  listingDigest: string
  cancellationDigest: string
  buyerListingId: string
}

type FollowUp = {
  transactionDigest: string
  checkpoint: ActivityCheckpointTransactionRef
  netGasMist: string
}

export function bindCollectionBuyerListingOriginals(input: {
  expected: CollectionBuyerListingExpectation
  purchase: CollectionBuyRecord
  listingText: string
  cancellationText: string
}) {
  const { purchase, expected } = input
  const listing = parseCollectionCommandRecord(JSON.parse(input.listingText))
  const cancellation = parseCollectionCommandRecord(JSON.parse(input.cancellationText))
  const p = purchase.plan
  for (const { plan } of [listing, cancellation]) {
    const targetFields = Object.keys(plan.target) as Array<keyof CollectionCommandTarget>
    check(targetFields.every(key => plan.target[key] === p.target[key]) && plan.author === p.author
      && plan.request.collectionId === p.request.collectionId && plan.rightId === p.rightId
      && (p.buyerKiosk.kind === 'NEW' || plan.kioskId === p.buyerKiosk.kioskId && plan.kioskCapId === p.buyerKiosk.capId),
    'BUYER_FOLLOW_UP_AUTHORITY')
  }
  check(listing.plan.kioskId === cancellation.plan.kioskId && listing.plan.kioskCapId === cancellation.plan.kioskCapId
    && listing.plan.request.action === 'list' && cancellation.plan.request.action === 'delist'
    && listing.packet.digest === expected.listingDigest && cancellation.packet.digest === expected.cancellationDigest
    && cancellation.plan.oldListingId === expected.buyerListingId && expected.buyerListingId !== p.request.listingId
    && new Set([purchase.packet.digest, listing.packet.digest, cancellation.packet.digest]).size === 3, 'BUYER_FOLLOW_UP_ORIGINAL')
  return { expected, listing, cancellation }
}

function ordered(earlier: ActivityCheckpointTransactionRef, later: ActivityCheckpointTransactionRef) {
  return BigInt(later.checkpoint) >= BigInt(earlier.checkpoint)
    && (later.checkpoint !== earlier.checkpoint || later.digest === earlier.digest)
}

function readFollowUp(record: CollectionCommandRecord, result: CollectionCommandQuery) {
  if (result.status !== 'SUCCEEDED') return { status: result.status, transactionDigest: record.packet.digest, checkpoint: result.checkpoint }
  check(result.receipt?.history && result.checkpointProof, 'BUYER_FOLLOW_UP_RECEIPT')
  const { history } = result.receipt
  const proof: FollowUp = { transactionDigest: record.packet.digest, checkpoint: result.checkpointProof, netGasMist: history.netGasMist }
  return { status: 'VERIFIED' as const, receipt: result.receipt, history, proof }
}

/** The original purchase output binds both buyer commands to the same custody
 * frontier. The cancellation must consume the exact listing created here. */
export async function readCollectionBuyerListingHistory({ client, signal, originals, purchase }: {
  client: SuiGrpcClient
  signal: AbortSignal
  originals: ReturnType<typeof bindCollectionBuyerListingOriginals>
  purchase: CollectionBuyQuery
}) {
  const { listing, cancellation, expected } = originals, receipt = purchase.receipt
  check(purchase.status === 'SUCCEEDED' && purchase.checkpointProof && receipt?.custodyRootOutput
    && receipt.buyerKioskId === listing.plan.kioskId && receipt.buyerKioskCapId === listing.plan.kioskCapId,
  'BUYER_FOLLOW_UP_PURCHASE_CUSTODY')

  const opened = readFollowUp(listing, await queryCollectionCommandOriginal({ client, record: listing, signal }))
  if (opened.status !== 'VERIFIED') return { status: 'BUYER_LISTING_UNPROVED' as const, original: opened }
  check(opened.receipt.newListingId === expected.buyerListingId && opened.history.createdListing?.objectId === expected.buyerListingId
    && same(opened.history.collectionInput, receipt.custodyRootOutput)
    && ordered(purchase.checkpointProof, opened.proof.checkpoint), 'BUYER_FOLLOW_UP_LISTING_LINK')

  const buyerListing = { ...opened.proof, created: opened.history.createdListing }
  const closed = readFollowUp(cancellation, await queryCollectionCommandOriginal({ client, record: cancellation, signal }))
  if (closed.status !== 'VERIFIED') return { status: 'BUYER_CANCELLATION_UNPROVED' as const, listing: buyerListing, original: closed }
  check(closed.receipt.oldListingId === expected.buyerListingId && closed.receipt.newListingId === null
    && closed.history.closedListing?.objectId === expected.buyerListingId
    && same(closed.history.collectionInput, receipt.custodyRootOutput)
    && same(closed.history.listingInput, opened.history.createdListing)
    && ordered(opened.proof.checkpoint, closed.proof.checkpoint), 'BUYER_FOLLOW_UP_CANCELLATION_LINK')

  return { status: 'BUYER_LIST_AND_CANCEL_PROVED' as const, buyerListingId: expected.buyerListingId,
    custodyRoot: receipt.custodyRootOutput, listing: buyerListing,
    cancellation: { ...closed.proof, closed: closed.history.closedListing } }
}
