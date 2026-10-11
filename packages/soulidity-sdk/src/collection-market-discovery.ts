import { createChainObjectDiscovery, type ChainObjectDiscoveryOptions, type ChainObjectDiscoveryPage } from './chain-object-discovery'
import { assertCollectionPublicDeployment, readCollectionListingCandidate, readCollectionPublicRoot,
  readCollectionPublicSnapshot, type CollectionListingObservation, type CollectionPublicDeployment,
  type CollectionPublicReadClient, type CollectionPublicSnapshot } from './collection-public-read'
import { profileReadStep } from './profile-read-step'

export interface CollectionMarketDiscoveryOptions {
  client: CollectionPublicReadClient; deployment: CollectionPublicDeployment; viewerAddress: string | null
  discovery: Omit<ChainObjectDiscoveryOptions, 'scope' | 'expectedChainIdentifier'>
  /** Lifetime cancellation permanently ends this captured viewer/client/release session. */
  signal?: AbortSignal
}
export interface CollectionMarketDiscoveryResult {
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

/** Public discovery includes ALL verified roots, not merely listings or a viewer's
 * holdings/creations. One Listing scan is shared across all root snapshots; there
 * is no per-item global scan. Four bounded workers commit each complete raw page
 * together. Failed raw pages retain their accepted candidates for explicit retry.
 * COMPLETE means candidate coverage at each source checkpoint, NOT an atomic
 * snapshot of subsequent current gRPC reads or transaction authorization. The
 * two source checkpoints can differ. Dates and global ordering are not inferred. */
export function createCollectionMarketDiscovery(options: CollectionMarketDiscoveryOptions) {
  const deployment = assertCollectionPublicDeployment(options.deployment), viewer = options.viewerAddress,
    client = options.client, lifetime = options.signal
  if (viewer !== null && !validId(viewer)) throw new Error('COLLECTION_MARKET_INPUT_INVALID')
  const discovery = { ...options.discovery }
  const make = (type: string) => createChainObjectDiscovery({ ...discovery, expectedChainIdentifier: deployment.chainIdentifier,
    scope: { packageId: deployment.originalPackageId, type: `${deployment.originalPackageId}::${type}`, owner: { kind: 'SHARED' } } })
  const listings = make('market::CollectionListing'), roots = make('collection::SoulCollection')
  let pending: ChainObjectDiscoveryPage | null = null, busy = false, terminal = false, phase: 'LISTINGS' | 'COLLECTIONS' = 'LISTINGS'
  let listingPage: ChainObjectDiscoveryPage | null = null, collectionPage: ChainObjectDiscoveryPage | null = null
  let verifiedListingCandidates = 0, verifiedCollectionCandidates = 0
  const observations: CollectionListingObservation[] = [], collections = new Map<string, Readonly<CollectionPublicSnapshot>>()
  function result(): CollectionMarketDiscoveryResult {
    return freeze({ collections: structuredClone([...collections.values()].sort((a, b) => a.collectionId.localeCompare(b.collectionId))),
      candidateStatus: phase === 'LISTINGS' ? listingPage!.page.status === 'COMPLETE' ? 'PARTIAL' : listingPage!.page.status : collectionPage!.page.status,
      phase, listingStatus: listingPage!.page.status, listingSource: listingPage!.source, collectionSource: collectionPage?.source ?? null,
      verifiedListingCandidates, verifiedCollectionCandidates, readConsistency: 'NON_ATOMIC_CURRENT_READSET', notTransactionAuthorization: true })
  }
  return Object.freeze({
    async next({ signal }: { signal?: AbortSignal } = {}): Promise<CollectionMarketDiscoveryResult> {
      if (busy) throw new Error('COLLECTION_MARKET_BUSY')
      lifetime?.throwIfAborted(); signal?.throwIfAborted()
      if (terminal) throw new Error('COLLECTION_MARKET_SCAN_ENDED')
      busy = true
      const controller = new AbortController()
      const readSignal = AbortSignal.any([controller.signal, AbortSignal.timeout(40000),
        ...(lifetime ? [lifetime] : []), ...(signal ? [signal] : [])])
      async function parallel<T, R>(items: readonly T[], fn: (item: T) => Promise<R>): Promise<R[]> {
        const values: R[] = []; let position = 0
        await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
          while (position < items.length) {
            readSignal.throwIfAborted(); const i = position++
            values[i] = await profileReadStep(readSignal, () => fn(items[i]))
          }
        }))
        readSignal.throwIfAborted(); return values
      }
      try {
        if (phase === 'LISTINGS') {
          // Do not race this await externally: latch an accepted scanner page even
          // if cancellation arrives between its cursor commit and this continuation.
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
        const snapshots = await parallel(page.ids, async collectionId => {
          const root = await readCollectionPublicRoot({ client, deployment, collectionId, signal: readSignal })
          readSignal.throwIfAborted()
          return readCollectionPublicSnapshot({ client, deployment, collectionId, viewerAddress: viewer,
            listingScan: { observations, status: listingPage!.page.status, source: listingPage!.source }, expectedRoot: root, signal: readSignal })
        })
        for (const snapshot of snapshots) collections.set(snapshot.collectionId, snapshot)
        verifiedCollectionCandidates += page.ids.length; collectionPage = page; pending = null
        terminal = page.page.status !== 'PARTIAL'
        return result()
      } finally { controller.abort(); busy = false }
    },
  })
}
