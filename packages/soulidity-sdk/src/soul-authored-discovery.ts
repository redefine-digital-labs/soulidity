import { createChainObjectDiscovery, type ChainObjectDiscoveryOptions, type ChainObjectDiscoveryPage } from './chain-object-discovery'
import { assertSoulPublicDeployment, readSoulPublicSnapshot, type SoulPublicDeployment, type SoulPublicReadClient, type SoulPublicSnapshot } from './soul-public-read'

export interface SoulAuthoredDiscoveryOptions {
  client: SoulPublicReadClient
  deployment: SoulPublicDeployment
  creator: string
  discovery: Omit<ChainObjectDiscoveryOptions, 'scope' | 'expectedChainIdentifier'>
}
export interface SoulAuthoredDiscoveryResult {
  /** Latest twelve among verified candidates so far, not a global latest claim
   * until candidateStatus is COMPLETE. No listing/purchase authority. */
  readonly souls: readonly Readonly<SoulPublicSnapshot>[]
  readonly authoredCount: number
  readonly verifiedCandidates: number
  readonly candidateStatus: ChainObjectDiscoveryPage['page']['status']
  readonly source: ChainObjectDiscoveryPage['source']
  readonly readConsistency: 'PER_ASSET_CURRENT_READ_SET'
}

/** Explicit next-page progression. Failed raw reads retain the same candidate
 * page for retry, including a terminal discovery page. Never advance past an
 * unread candidate or silently restart a checkpoint. Owner is not creator. */
export function createSoulAuthoredDiscovery(options: SoulAuthoredDiscoveryOptions) {
  const deployment = assertSoulPublicDeployment(options.deployment), creator = options.creator, client = options.client
  if (typeof creator !== 'string' || !/^0x[0-9a-f]{64}$/.test(creator) || /^0x0+$/.test(creator)) {
    throw new Error('SOUL_AUTHORED_CREATOR_INVALID')
  }
  const discovery = createChainObjectDiscovery({ ...options.discovery, expectedChainIdentifier: deployment.chainIdentifier,
    scope: { packageId: deployment.originalPackageId, type: `${deployment.originalPackageId}::soul::SoulState`, owner: { kind: 'SHARED' } } })
  let pending: ChainObjectDiscoveryPage | null = null, busy = false, terminal = false, verifiedCandidates = 0
  const authored = new Map<string, SoulPublicSnapshot>()
  return Object.freeze({
    async next({ signal }: { signal?: AbortSignal } = {}): Promise<SoulAuthoredDiscoveryResult> {
      if (busy) throw new Error('SOUL_AUTHORED_BUSY')
      if (terminal) throw new Error('SOUL_AUTHORED_SCAN_ENDED')
      signal?.throwIfAborted()
      busy = true
      const controller = new AbortController()
      const readSignal = signal ? AbortSignal.any([signal, controller.signal, AbortSignal.timeout(40000)])
        : AbortSignal.any([controller.signal, AbortSignal.timeout(40000)])
      try {
        if (!pending) pending = await discovery.next({ signal: readSignal })
        const page = pending, snapshots: SoulPublicSnapshot[] = []
        // At most four live raw read sets; a page is committed only after every
        // candidate succeeds. Late aborted workers cannot mutate committed state.
        let position = 0
        await Promise.all(Array.from({ length: Math.min(4, page.ids.length) }, async () => {
          while (position < page.ids.length) {
            readSignal.throwIfAborted()
            const stateId = page.ids[position++]
            const snapshot = await readSoulPublicSnapshot({ client, deployment, stateId, signal: readSignal })
            snapshots.push(snapshot)
          }
        }))
        readSignal.throwIfAborted()
        for (const snapshot of snapshots) if (snapshot.creator === creator) authored.set(snapshot.soulId, snapshot)
        verifiedCandidates += page.ids.length
        pending = null; terminal = page.page.status !== 'PARTIAL'
        const souls = [...authored.values()].sort((a, b) => {
          const left = BigInt(a.createdAtMs), right = BigInt(b.createdAtMs)
          return left === right ? a.soulId.localeCompare(b.soulId) : left > right ? -1 : 1
        }).slice(0, 12).map(snapshot => {
          const copy = structuredClone(snapshot)
          Object.freeze(copy.publicPreview.tags); Object.freeze(copy.publicPreview.previewImages); Object.freeze(copy.publicPreview)
          return Object.freeze(copy)
        })
        return Object.freeze({ souls: Object.freeze(souls), authoredCount: authored.size, verifiedCandidates,
          candidateStatus: page.page.status, source: page.source, readConsistency: 'PER_ASSET_CURRENT_READ_SET' as const })
      } finally { controller.abort(); busy = false }
    },
  })
}
