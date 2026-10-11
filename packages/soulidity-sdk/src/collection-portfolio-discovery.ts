import { createChainObjectDiscovery, type ChainObjectDiscoveryOptions, type ChainObjectDiscoveryPage } from './chain-object-discovery'
import { assertCollectionPublicDeployment, readCollectionListingCandidate, readCollectionPublicRoot,
  readCollectionPublicSnapshot, readCollectionRightCandidate, type CollectionListingObservation,
  type CollectionPublicDeployment, type CollectionPublicReadClient, type CollectionPublicSnapshot } from './collection-public-read'

export interface CollectionPortfolioDiscoveryOptions {
  client: CollectionPublicReadClient; deployment: CollectionPublicDeployment; viewerAddress: string
  /** Candidate Rights from the viewer's independently verified Kiosk inventory.
   * These are not an alternative ownership authority. */
  heldRightIds?: readonly string[]
  discovery: Omit<ChainObjectDiscoveryOptions, 'scope' | 'expectedChainIdentifier'>
}
export interface CollectionPortfolioDiscoveryResult {
  readonly collections: readonly Readonly<CollectionPublicSnapshot>[]
  readonly candidateStatus: ChainObjectDiscoveryPage['page']['status']
  readonly phase: 'LISTINGS' | 'COLLECTIONS'
  readonly listingStatus: ChainObjectDiscoveryPage['page']['status']
  readonly listingSource: ChainObjectDiscoveryPage['source']
  readonly collectionSource: ChainObjectDiscoveryPage['source'] | null
  readonly verifiedListingCandidates: number; readonly verifiedCollectionCandidates: number
  readonly readConsistency: 'NON_ATOMIC_CURRENT_READSET'
  readonly notTransactionAuthorization: true
}
const validId = (value: unknown): value is string => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value)
function freeze<T>(value: T): T { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }; return value }

/** Two explicit bounded scans, never a hidden per-Collection GraphQL scan.
 * Listing pages are raw-verified first; then Collection roots select creator OR
 * current holder, preserving created-but-sold Collections. No SQL member IDs,
 * inferred dates, latest-twelve truncation, or secondary-owner listing counts.
 * A failed raw page remains pending for retry; neither counts nor results commit
 * until all its workers succeed. Checkpoint candidate coverage is not proof of
 * global completeness or an atomic snapshot of subsequent current gRPC reads. */
export function createCollectionPortfolioDiscovery(options: CollectionPortfolioDiscoveryOptions) {
  const deployment = assertCollectionPublicDeployment(options.deployment), viewer = options.viewerAddress, client = options.client
  const heldRightIds = [...(options.heldRightIds ?? [])]
  if (!validId(viewer) || heldRightIds.length > 10000 || !heldRightIds.every(validId)
    || new Set(heldRightIds).size !== heldRightIds.length) throw new Error('COLLECTION_PORTFOLIO_INPUT_INVALID')
  const make = (type: string) => createChainObjectDiscovery({ ...options.discovery, expectedChainIdentifier: deployment.chainIdentifier,
    scope: { packageId: deployment.originalPackageId, type: `${deployment.originalPackageId}::${type}`, owner: { kind: 'SHARED' } } })
  const listings = make('market::CollectionListing'), roots = make('collection::SoulCollection')
  let pending: ChainObjectDiscoveryPage | null = null, busy = false, terminal = false, phase: 'LISTINGS' | 'COLLECTIONS' = 'LISTINGS'
  let listingPage: ChainObjectDiscoveryPage | null = null, collectionPage: ChainObjectDiscoveryPage | null = null
  let verifiedListingCandidates = 0, verifiedCollectionCandidates = 0, seedsCommitted = false
  const observations: CollectionListingObservation[] = [], collections = new Map<string, Readonly<CollectionPublicSnapshot>>()
  function result(): CollectionPortfolioDiscoveryResult {
    return freeze({ collections: structuredClone([...collections.values()].sort((a, b) => a.collectionId.localeCompare(b.collectionId))),
      candidateStatus: phase === 'LISTINGS' ? listingPage!.page.status === 'COMPLETE' ? 'PARTIAL' : listingPage!.page.status : collectionPage!.page.status,
      phase, listingStatus: listingPage!.page.status, listingSource: listingPage!.source, collectionSource: collectionPage?.source ?? null,
      verifiedListingCandidates, verifiedCollectionCandidates, readConsistency: 'NON_ATOMIC_CURRENT_READSET', notTransactionAuthorization: true })
  }
  return Object.freeze({
    async next({ signal }: { signal?: AbortSignal } = {}): Promise<CollectionPortfolioDiscoveryResult> {
      if (busy) throw new Error('COLLECTION_PORTFOLIO_BUSY')
      if (terminal) throw new Error('COLLECTION_PORTFOLIO_SCAN_ENDED')
      signal?.throwIfAborted(); busy = true
      const controller = new AbortController()
      const readSignal = AbortSignal.any([controller.signal, AbortSignal.timeout(40000), ...(signal ? [signal] : [])])
      async function parallel<T, R>(items: readonly T[], fn: (item: T) => Promise<R>): Promise<R[]> {
        const values: R[] = []; let position = 0
        await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
          while (position < items.length) { readSignal.throwIfAborted(); const i = position++; values[i] = await fn(items[i]) }
        }))
        readSignal.throwIfAborted(); return values
      }
      try {
        if (phase === 'LISTINGS') {
          if (!pending) pending = await listings.next({ signal: readSignal })
          const page = pending
          const accepted = await parallel(page.ids, listingId => readCollectionListingCandidate({ client, deployment, listingId, signal: readSignal }))
          observations.push(...accepted.filter((value): value is CollectionListingObservation => value !== null))
          verifiedListingCandidates += page.ids.length; listingPage = page; pending = null
          terminal = page.page.status === 'LIMIT_REACHED'
          const output = result()
          if (page.page.status === 'COMPLETE') phase = 'COLLECTIONS'
          return output
        }
        if (!pending) pending = await roots.next({ signal: readSignal })
        const page = pending
        const seedIds = seedsCommitted ? [] : await parallel(heldRightIds,
          rightId => readCollectionRightCandidate({ client, deployment, rightId, signal: readSignal }))
        const candidateIds = [...new Set([...page.ids, ...seedIds])]
        const snapshots = await parallel(candidateIds, async collectionId => {
          const root = await readCollectionPublicRoot({ client, deployment, collectionId, signal: readSignal })
          if (root.collection.creator !== viewer && root.collection.current_holder !== viewer) return null
          return readCollectionPublicSnapshot({ client, deployment, collectionId, viewerAddress: viewer,
            listingScan: { observations, status: listingPage!.page.status, source: listingPage!.source }, expectedRoot: root, signal: readSignal })
        })
        for (const snapshot of snapshots) if (snapshot) collections.set(snapshot.collectionId, snapshot)
        verifiedCollectionCandidates += page.ids.length; seedsCommitted = true; collectionPage = page; pending = null
        terminal = page.page.status !== 'PARTIAL'
        return result()
      } finally { controller.abort(); busy = false }
    },
  })
}
