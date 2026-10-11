import { createChainObjectDiscovery, type ChainObjectDiscoveryOptions, type ChainObjectDiscoveryPage } from './chain-object-discovery'
import { assertCollectionPublicDeployment, readCollectionListingCandidate, readCollectionPublicRoot,
  readCollectionPublicSnapshot, type CollectionListingObservation, type CollectionPublicDeployment,
  type CollectionPublicReadClient, type CollectionPublicSnapshot } from './collection-public-read'
import { profileReadStep } from './profile-read-step'

export interface CollectionDetailDiscoveryOptions {
  client: CollectionPublicReadClient; deployment: CollectionPublicDeployment
  viewerAddress: string | null; collectionId: string
  discovery: Omit<ChainObjectDiscoveryOptions, 'scope' | 'expectedChainIdentifier'>
  /** Lifetime cancellation permanently ends this captured viewer/client/release session. */
  signal?: AbortSignal
}
export interface CollectionDetailDiscoveryResult {
  readonly collection: Readonly<CollectionPublicSnapshot> | null
  readonly candidateStatus: ChainObjectDiscoveryPage['page']['status']
  readonly phase: 'LISTINGS' | 'COLLECTION'
  readonly listingSource: ChainObjectDiscoveryPage['source']
  readonly verifiedListingCandidates: number
  readonly readConsistency: 'NON_ATOMIC_CURRENT_READSET'
  readonly notTransactionAuthorization: true
}
const validId = (value: unknown): value is string => typeof value === 'string'
  && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value)
function freeze<T>(value: T): T { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }; return value }

/** A known Collection deep link needs only one type-scoped Listing scan, followed
 * by the exact requested root and its current custody/quote readset. It never
 * scans all Collection roots or narrows discovery to a wallet's portfolio.
 * Listing pages commit only after all four bounded workers succeed; an accepted
 * page remains pending through raw failure/cancellation, including a terminal
 * cursor handoff. Missing/malformed roots are errors, not not-found or empty data.
 * COMPLETE means the listing candidate scan and the requested current readset
 * finished, not a single atomic checkpoint or transaction authorization. */
export function createCollectionDetailDiscovery(options: CollectionDetailDiscoveryOptions) {
  const deployment = assertCollectionPublicDeployment(options.deployment), viewer = options.viewerAddress,
    collectionId = options.collectionId, client = options.client, lifetime = options.signal
  if (!validId(collectionId) || viewer !== null && !validId(viewer)) throw new Error('COLLECTION_DETAIL_INPUT_INVALID')
  lifetime?.throwIfAborted()
  const discovery = { ...options.discovery }
  const listings = createChainObjectDiscovery({ ...discovery, expectedChainIdentifier: deployment.chainIdentifier,
    scope: { packageId: deployment.originalPackageId, type: `${deployment.originalPackageId}::market::CollectionListing`, owner: { kind: 'SHARED' } } })
  let pending: ChainObjectDiscoveryPage | null = null, listingPage: ChainObjectDiscoveryPage | null = null
  let busy = false, terminal = false, phase: CollectionDetailDiscoveryResult['phase'] = 'LISTINGS', verifiedListingCandidates = 0
  let collection: Readonly<CollectionPublicSnapshot> | null = null
  const observations: CollectionListingObservation[] = []
  function result(candidateStatus: CollectionDetailDiscoveryResult['candidateStatus']): CollectionDetailDiscoveryResult {
    return freeze({ collection: structuredClone(collection), candidateStatus, phase,
      listingSource: listingPage!.source, verifiedListingCandidates,
      readConsistency: 'NON_ATOMIC_CURRENT_READSET', notTransactionAuthorization: true })
  }
  return Object.freeze({
    async next({ signal }: { signal?: AbortSignal } = {}): Promise<CollectionDetailDiscoveryResult> {
      lifetime?.throwIfAborted(); signal?.throwIfAborted()
      if (busy) throw new Error('COLLECTION_DETAIL_BUSY')
      if (terminal) throw new Error('COLLECTION_DETAIL_SCAN_ENDED')
      busy = true
      const controller = new AbortController(), readSignal = AbortSignal.any([controller.signal, AbortSignal.timeout(40000),
        ...(lifetime ? [lifetime] : []), ...(signal ? [signal] : [])])
      try {
        if (phase === 'LISTINGS') {
          // The scanner already bounds transport. Do not externally race its
          // promise: always latch a page whose underlying cursor was committed.
          if (!pending) pending = await listings.next({ signal: readSignal })
          const page = pending, accepted: Array<CollectionListingObservation | null> = []
          let position = 0
          await Promise.all(Array.from({ length: Math.min(4, page.ids.length) }, async () => {
            while (position < page.ids.length) {
              readSignal.throwIfAborted(); const index = position++
              accepted[index] = await profileReadStep(readSignal, () => readCollectionListingCandidate({
                client, deployment, listingId: page.ids[index], signal: readSignal }))
            }
          }))
          readSignal.throwIfAborted()
          observations.push(...accepted.filter((value): value is CollectionListingObservation => value !== null))
          verifiedListingCandidates += page.ids.length; listingPage = page; pending = null
          terminal = page.page.status === 'LIMIT_REACHED'
          // A completed listing scan is not yet a completed Collection detail.
          const output = result(page.page.status === 'COMPLETE' ? 'PARTIAL' : page.page.status)
          if (page.page.status === 'COMPLETE') phase = 'COLLECTION'
          return output
        }
        const root = await profileReadStep(readSignal, () => readCollectionPublicRoot({ client, deployment, collectionId, signal: readSignal }))
        const snapshot = await profileReadStep(readSignal, () => readCollectionPublicSnapshot({ client, deployment,
          collectionId, viewerAddress: viewer, expectedRoot: root,
          listingScan: { observations, status: 'COMPLETE', source: listingPage!.source }, signal: readSignal }))
        readSignal.throwIfAborted()
        collection = snapshot; terminal = true
        return result('COMPLETE')
      } finally { controller.abort(); busy = false }
    },
  })
}
