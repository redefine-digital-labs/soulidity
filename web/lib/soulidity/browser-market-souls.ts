import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { createChainObjectDiscovery, profileReadStep, readSoulPublicSnapshot,
  type ChainObjectDiscoveryPage, type ChainObjectDiscoveryOptions, type SoulPublicSnapshot } from '@soulidity/sdk'
import { receiveId } from '@/lib/animacraft/native-receive'
import { readBrowserSoulDetail, type BrowserSoulDetailConfig } from './browser-soul-detail'
import { createBrowserSoulListingDiscovery, type BrowserSoulListingDiscoveryPage, type BrowserSoulListingScan } from './browser-soul-custody'
import type { ChainSoulDetail } from './soul-detail-model'

export type BrowserMarketSoulSelection = { kind: 'MARKET' } | { kind: 'COLLECTION'; collectionId: string }
  | { kind: 'AUTHOR'; creatorAddress: string }
export interface BrowserMarketSoulsPage {
  readonly souls: readonly ChainSoulDetail[]
  readonly candidateStatus: ChainObjectDiscoveryPage['page']['status']
  readonly phase: 'LISTINGS' | 'SOULS'
  readonly listingSource: ChainObjectDiscoveryPage['source']
  readonly source: ChainObjectDiscoveryPage['source'] | null
  readonly verifiedListingCandidates: number; readonly verifiedSoulCandidates: number
  readonly readConsistency: 'NON_ATOMIC_CURRENT_READSET'; readonly notAuthorization: true
}
function check(value: unknown, code: string): asserts value { if (!value) throw new Error(`BROWSER_MARKET_SOULS_${code}`) }
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}

/** Public type-scoped discovery, independent of wallet ownership. One complete
 * Listing scan is shared by all detail readers; then every SoulState candidate
 * is raw-verified before selecting current listings, Collection members or
 * authored Souls. Creator selection never means current wallet inventory.
 * Each failed page remains pending. Four workers commit together, including
 * terminal pages, and cancellation cannot silently skip an accepted cursor.
 * Discovery checkpoints and later current reads are deliberately non-atomic. */
export function createBrowserMarketSouls(params: {
  client: SuiGrpcClient; config: BrowserSoulDetailConfig; viewerAddress: string | null
  selection?: BrowserMarketSoulSelection; signal: AbortSignal
}, dependencies: {
  fetch?: typeof globalThis.fetch; asset?: typeof readSoulPublicSnapshot; detail?: typeof readBrowserSoulDetail
  /** Explicit resource bounds for controlled callers; never a latest-N filter. */
  limits?: Pick<ChainObjectDiscoveryOptions, 'pageSize' | 'maxPages' | 'maxObjects'>
} = {}) {
  const config = structuredClone(params.config), client = params.client, lifetime = params.signal
  const selection: BrowserMarketSoulSelection = structuredClone(params.selection ?? { kind: 'MARKET' })
  check(selection.kind === 'MARKET' && Object.keys(selection).length === 1
    || selection.kind === 'COLLECTION' && Object.keys(selection).sort().join() === 'collectionId,kind'
    || selection.kind === 'AUTHOR' && Object.keys(selection).sort().join() === 'creatorAddress,kind', 'SELECTION_INVALID')
  if (selection.kind === 'COLLECTION') receiveId(selection.collectionId)
  if (selection.kind === 'AUTHOR') receiveId(selection.creatorAddress)
  const viewerAddress = params.viewerAddress === null ? null : receiveId(params.viewerAddress)
  const deployment = { originalPackageId: receiveId(config.native.soulidityOriginalPackageId), chainIdentifier: config.chainIdentifier }
  check(config.discoveryEndpoint !== null, 'DISCOVERY_UNAVAILABLE'); lifetime.throwIfAborted()
  const settings = { endpoint: config.discoveryEndpoint, pageSize: 50, maxPages: 200, maxObjects: 10000,
    ...structuredClone(dependencies.limits ?? {}), timeoutMs: 25000 }
  const listingReader = createBrowserSoulListingDiscovery({ client, deployment, discovery: settings, signal: lifetime }, { fetch: dependencies.fetch })
  const states = createChainObjectDiscovery({ ...settings, expectedChainIdentifier: deployment.chainIdentifier,
    scope: { packageId: deployment.originalPackageId, type: `${deployment.originalPackageId}::soul::SoulState`, owner: { kind: 'SHARED' } }, fetch: dependencies.fetch })
  let phase: BrowserMarketSoulsPage['phase'] = 'LISTINGS', busy = false, terminal = false
  let listingPage: BrowserSoulListingDiscoveryPage | null = null, listingScan: BrowserSoulListingScan | null = null
  let pendingListings: BrowserSoulListingDiscoveryPage | null = null, listingFlight: Promise<BrowserSoulListingDiscoveryPage> | null = null
  let pending: ChainObjectDiscoveryPage | null = null, page: ChainObjectDiscoveryPage | null = null, flight: Promise<ChainObjectDiscoveryPage> | null = null
  const candidates = new Set<string>(), soulIds = new Set<string>(), souls = new Map<string, ChainSoulDetail>()
  function result(currentPhase: BrowserMarketSoulsPage['phase']): BrowserMarketSoulsPage {
    check(listingPage, 'LISTINGS_UNAVAILABLE')
    return freeze({ souls: structuredClone([...souls.values()].sort((a, b) => a.onChainId.localeCompare(b.onChainId))),
      candidateStatus: currentPhase === 'LISTINGS' ? listingPage.candidateStatus === 'COMPLETE' ? 'PARTIAL' : listingPage.candidateStatus : page!.page.status,
      phase: currentPhase, listingSource: structuredClone(listingPage.source), source: page ? structuredClone(page.source) : null,
      verifiedListingCandidates: listingPage.verifiedListingCandidates, verifiedSoulCandidates: candidates.size,
      readConsistency: 'NON_ATOMIC_CURRENT_READSET', notAuthorization: true })
  }
  return Object.freeze({ async next({ signal: caller }: { signal?: AbortSignal } = {}): Promise<BrowserMarketSoulsPage> {
    lifetime.throwIfAborted(); caller?.throwIfAborted()
    check(!busy, 'BUSY'); check(!terminal, 'SCAN_ENDED'); busy = true
    const controller = new AbortController(), signal = AbortSignal.any([lifetime, controller.signal, AbortSignal.timeout(120000), ...(caller ? [caller] : [])])
    try {
      if (phase === 'LISTINGS') {
        if (!pendingListings) await profileReadStep(signal, () => {
          listingFlight ??= listingReader.next({ signal }).then(value => { if (!lifetime.aborted) pendingListings = value; return value })
            .finally(() => { listingFlight = null })
          return listingFlight
        })
        signal.throwIfAborted(); check(pendingListings, 'LISTINGS_UNAVAILABLE')
        listingPage = pendingListings; pendingListings = null
        terminal = listingPage.candidateStatus === 'LIMIT_REACHED'
        if (listingPage.candidateStatus === 'COMPLETE') {
          listingScan = listingPage.scan; check(listingScan, 'LISTINGS_UNAVAILABLE'); phase = 'SOULS'
        }
        return result('LISTINGS')
      }
      check(listingScan, 'LISTINGS_UNAVAILABLE')
      if (!pending) await profileReadStep(signal, () => {
        flight ??= states.next({ signal }).then(value => { if (!lifetime.aborted) pending = value; return value }).finally(() => { flight = null })
        return flight
      })
      const next = pending; check(next, 'PAGE_UNAVAILABLE')
      const source = next.source
      check(source.chainIdentifier === deployment.chainIdentifier && source.endpoint === settings.endpoint
        && source.authority === 'CANDIDATE_IDS_ONLY' && source.scope.packageId === deployment.originalPackageId
        && source.scope.type === `${deployment.originalPackageId}::soul::SoulState` && source.scope.owner?.kind === 'SHARED'
        && Object.keys(source.scope.owner).length === 1 && Number.isSafeInteger(source.checkpoint) && source.checkpoint >= 0
        && (!page || JSON.stringify(source) === JSON.stringify(page.source)), 'SOURCE_SCOPE_MISMATCH')
      check(next.page.pagesRead === (page?.page.pagesRead ?? 0) + 1 && next.page.objectsRead === candidates.size + next.ids.length
        && next.page.objectsRead <= settings.maxObjects && next.ids.length <= settings.pageSize
        && ['PARTIAL', 'COMPLETE', 'LIMIT_REACHED'].includes(next.page.status), 'CANDIDATE_COUNT')
      const stagedCandidates = new Set(candidates)
      for (const candidate of next.ids) { receiveId(candidate); check(!stagedCandidates.has(candidate), 'DUPLICATE_CANDIDATE'); stagedCandidates.add(candidate) }
      const selected: Array<ChainSoulDetail | null> = [], assets: SoulPublicSnapshot[] = []; let position = 0
      await Promise.all(Array.from({ length: Math.min(4, next.ids.length) }, async () => {
        while (position < next.ids.length) {
          signal.throwIfAborted(); const index = position++, stateId = next.ids[index]
          const asset = await profileReadStep(signal, () => (dependencies.asset ?? readSoulPublicSnapshot)({ client, deployment, stateId, signal }))
          check(asset.stateId === stateId, 'STATE_MISMATCH'); receiveId(asset.soulId); assets[index] = asset
          const matches = selection.kind === 'MARKET' ? asset.listedIndividually
            : selection.kind === 'COLLECTION' ? asset.collectionId === selection.collectionId : asset.creator === selection.creatorAddress
          if (!matches) { selected[index] = null; continue }
          const detail = await profileReadStep(signal, () => (dependencies.detail ?? readBrowserSoulDetail)({ soulId: asset.soulId,
            viewerAddress, config, listingScan: listingScan!, signal }, { client: () => client }))
          check(detail.originalPackageId === deployment.originalPackageId && detail.viewerAddress === viewerAddress
            && detail.onChainId === asset.soulId && detail.stateOnChainId === asset.stateId && detail.stateVersion === asset.stateVersion
            && detail.stateDigest === asset.stateDigest && detail.creatorAddress === asset.creator
            && detail.currentOwnerAddress === asset.currentOwner && detail.currentKioskId === asset.kioskId
            && detail.collectionOnChainId === asset.collectionId && detail.chainListingStatus === (asset.listedIndividually ? 'LISTED' : 'HELD')
            && detail.isOwner === (viewerAddress === asset.currentOwner) && detail.isCreator === (viewerAddress === asset.creator), 'CHANGED_RESTART')
          selected[index] = detail
        }
      }))
      signal.throwIfAborted()
      const stagedSouls = new Set(soulIds)
      for (const asset of assets) { check(!stagedSouls.has(asset.soulId), 'DUPLICATE_SOUL'); stagedSouls.add(asset.soulId) }
      for (const row of selected) if (row) souls.set(row.onChainId, row)
      for (const candidate of next.ids) candidates.add(candidate)
      for (const asset of assets) soulIds.add(asset.soulId)
      page = next; pending = null; terminal = next.page.status !== 'PARTIAL'
      return result('SOULS')
    } finally { controller.abort(); busy = false }
  } })
}
