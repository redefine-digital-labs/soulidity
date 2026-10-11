import { createChainEventDiscovery, profileReadStep, type ChainEventDiscoveryPage } from '@soulidity/sdk'
import { createNativeReceiveClient, receiveId } from '@/lib/animacraft/native-receive'
import type { BrowserSoulDetailConfig } from './browser-soul-detail'
import { readActivityCheckpointEvidence, readActivityTransactionEvidence,
  type ActivityCheckpointEvidence, type ActivityDeployment, type ActivityTransactionEvidence } from './activity-transaction-evidence'
import { SOUL_ACTIVITY_FAMILIES, composeSoulActivity, soulActivityEventType,
  type SoulActivityCoverage, type SoulActivityFamily } from './soul-activity-model'

export interface BrowserSoulActivityPage {
  readonly activity: ReturnType<typeof composeSoulActivity>
  readonly currentFamily: SoulActivityFamily
  readonly source: ChainEventDiscoveryPage['source']
  readonly verifiedTransactions: number
  readonly retainedEvidenceBytes: number
  readonly verifiedCandidateEvents: number
  readonly pages: number
  readonly limitReason: 'DISCOVERY_LIMIT' | 'TRANSACTION_LIMIT' | 'EVIDENCE_BYTES_LIMIT' | null
  readonly notAuthorization: true
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}

/** Each next explicitly advances ONE event-family page. Candidate discovery is
 * followed by complete canonical historical proof and actual payload reduction.
 * Received grants scan every sender. All families share the same checkpoint.
 * Failed pages remain retryable even after the underlying cursor is terminal;
 * accepted candidate pages are latched across cancellation at cursor handoff.
 * The caller must abort this lifetime on wallet/client/release replacement.
 * Historical evidence never signs, creates recovery records or authorizes writes.
 */
export function createBrowserSoulActivity(params: {
  viewerAddress: string; config: BrowserSoulDetailConfig; signal: AbortSignal
  limits?: { pageSize?: number; maxPages?: number; maxEvents?: number; maxTransactions?: number; maxEvidenceBytes?: number }
}, dependencies: {
  client?: typeof createNativeReceiveClient
  discovery?: typeof createChainEventDiscovery
  checkpoint?: typeof readActivityCheckpointEvidence
  transaction?: typeof readActivityTransactionEvidence
} = {}) {
  const viewerAddress = receiveId(params.viewerAddress), config = structuredClone(params.config), lifetime = params.signal
  lifetime.throwIfAborted()
  const deployment: ActivityDeployment = Object.freeze({ originalPackageId: receiveId(config.native.soulidityOriginalPackageId),
    callablePackageId: receiveId(config.native.soulidityCallablePackageId), callableDigest: config.native.soulidityCallableDigest,
    chainIdentifier: config.chainIdentifier })
  if (config.discoveryEndpoint === null) throw new Error('SOUL_ACTIVITY_DISCOVERY_UNAVAILABLE')
  const bounded = (value: number, maximum: number) => {
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error('SOUL_ACTIVITY_LIMIT_INVALID')
    return value
  }
  const limits = structuredClone(params.limits ?? {})
  const pageSize = bounded(limits.pageSize ?? 10, 50), maxPages = bounded(limits.maxPages ?? 200, 200)
  const maxEvents = bounded(limits.maxEvents ?? 2000, 10000), maxTransactions = bounded(limits.maxTransactions ?? 10000, 10000)
  const maxEvidenceBytes = bounded(limits.maxEvidenceBytes ?? 32 * 1024 * 1024, 64 * 1024 * 1024)
  const client = (dependencies.client ?? createNativeReceiveClient)(lifetime)
  const discovery = dependencies.discovery ?? createChainEventDiscovery
  let familyIndex = 0, scanner: ReturnType<typeof createChainEventDiscovery> | null = null
  let pending: ChainEventDiscoveryPage | null = null, candidateRead: Promise<ChainEventDiscoveryPage> | null = null
  let checkpoint: ActivityCheckpointEvidence | null = null, busy = false, ended = false
  let pages = 0, verifiedCandidateEvents = 0, retainedEvidenceBytes = 0
  const transactions = new Map<string, ActivityTransactionEvidence>()
  const coverage = Object.fromEntries(SOUL_ACTIVITY_FAMILIES.map(f => [f, 'UNSCANNED'])) as Record<SoulActivityFamily, SoulActivityCoverage[SoulActivityFamily]>
  const output = (page: ChainEventDiscoveryPage, all: ReadonlyMap<string, ActivityTransactionEvidence>, nextCoverage: SoulActivityCoverage,
    nextPages: number, nextCount: number, nextBytes: number, limitReason: BrowserSoulActivityPage['limitReason']): BrowserSoulActivityPage => {
    if (!checkpoint) throw new Error('SOUL_ACTIVITY_CHECKPOINT_UNAVAILABLE')
    return freeze({ activity: composeSoulActivity({ viewerAddress, deployment, asOf: checkpoint,
      transactions: [...all.values()], coverage: nextCoverage }), currentFamily: SOUL_ACTIVITY_FAMILIES[familyIndex],
      source: page.source, verifiedTransactions: all.size, retainedEvidenceBytes: nextBytes, verifiedCandidateEvents: nextCount,
      pages: nextPages, limitReason, notAuthorization: true })
  }
  return Object.freeze({ async next({ signal: callerSignal }: { signal?: AbortSignal } = {}): Promise<BrowserSoulActivityPage> {
    lifetime.throwIfAborted(); callerSignal?.throwIfAborted()
    if (busy) throw new Error('SOUL_ACTIVITY_BUSY')
    if (ended) throw new Error('SOUL_ACTIVITY_SCAN_ENDED')
    busy = true
    const controller = new AbortController()
    const signal = AbortSignal.any([lifetime, controller.signal, AbortSignal.timeout(120000), ...(callerSignal ? [callerSignal] : [])])
    try {
      const family = SOUL_ACTIVITY_FAMILIES[familyIndex]
      scanner ??= discovery({ endpoint: config.discoveryEndpoint!, expectedChainIdentifier: deployment.chainIdentifier,
        scope: { packageId: deployment.originalPackageId, type: soulActivityEventType(deployment.originalPackageId, family) },
        ...(checkpoint ? { checkpoint: Number(checkpoint.checkpoint) } : {}), pageSize, maxPages, maxEvents, timeoutMs: 25000 })
      if (!pending) {
        await profileReadStep(signal, () => {
          candidateRead ??= scanner!.next({ signal }).then(page => { pending = page; return page })
            .finally(() => { candidateRead = null })
          return candidateRead
        })
      }
      const page = pending
      if (!page) throw new Error('SOUL_ACTIVITY_CANDIDATES_UNAVAILABLE')
      if (page.source.chainIdentifier !== deployment.chainIdentifier || page.source.scope.packageId !== deployment.originalPackageId
        || page.source.scope.type !== soulActivityEventType(deployment.originalPackageId, family)
        || page.source.authority !== 'CANDIDATE_EVENTS_ONLY' || !Number.isSafeInteger(page.source.checkpoint) || page.source.checkpoint < 0)
        throw new Error('SOUL_ACTIVITY_CANDIDATE_SCOPE_MISMATCH')
      if (!checkpoint) checkpoint = await profileReadStep(signal, () => (dependencies.checkpoint ?? readActivityCheckpointEvidence)({
        client, chainIdentifier: deployment.chainIdentifier, checkpoint: String(page.source.checkpoint), signal }))
      if (checkpoint.checkpoint !== String(page.source.checkpoint) || checkpoint.chainIdentifier !== deployment.chainIdentifier)
        throw new Error('SOUL_ACTIVITY_CHECKPOINT_CHANGED')
      const requested = [...new Set(page.events.map(event => event.transactionDigest))].filter(digest => !transactions.has(digest))
      const stopAtLimit = (reason: NonNullable<BrowserSoulActivityPage['limitReason']>) => {
        const nextCoverage = { ...coverage, [family]: 'LIMIT_REACHED' as const }
        const result = output(page, transactions, nextCoverage, pages, verifiedCandidateEvents, retainedEvidenceBytes, reason)
        signal.throwIfAborted(); coverage[family] = 'LIMIT_REACHED'; ended = true; return result
      }
      if (transactions.size + requested.length > maxTransactions) return stopAtLimit('TRANSACTION_LIMIT')
      const verified: ActivityTransactionEvidence[] = []; let position = 0
      await Promise.all(Array.from({ length: Math.min(4, requested.length) }, async () => {
        while (position < requested.length) {
          signal.throwIfAborted(); const index = position++
          verified[index] = await profileReadStep(signal, () => (dependencies.transaction ?? readActivityTransactionEvidence)({
            client, deployment, transactionDigest: requested[index], signal }))
          signal.throwIfAborted()
          if (verified[index].transactionDigest !== requested[index]) throw new Error('SOUL_ACTIVITY_TRANSACTION_MISMATCH')
        }
      }))
      signal.throwIfAborted()
      const prospective = new Map(transactions)
      for (const evidence of verified) prospective.set(evidence.transactionDigest, evidence)
      // Every candidate must match the exact event position/type in the proved
      // transaction, including when a previous family already cached that PTB.
      for (const candidate of page.events) {
        const tx = prospective.get(candidate.transactionDigest), event = tx?.events[candidate.eventSequence]
        if (!tx || !event || event.eventSequence !== candidate.eventSequence || event.type !== candidate.type
          || candidate.type !== soulActivityEventType(deployment.originalPackageId, family))
          throw new Error('SOUL_ACTIVITY_CANDIDATE_NOT_PROVEN')
      }
      const bytes = retainedEvidenceBytes + verified.reduce((sum, value) => sum + new TextEncoder().encode(JSON.stringify(value)).length, 0)
      if (bytes > maxEvidenceBytes) return stopAtLimit('EVIDENCE_BYTES_LIMIT')
      const nextCoverage = { ...coverage, [family]: page.page.status }
      // Reduction is part of validation. A contradictory page cannot advance
      // the public cache, family, cursor ownership or confirmed progress counts.
      const result = output(page, prospective, nextCoverage, pages + 1, verifiedCandidateEvents + page.events.length, bytes,
        page.page.status === 'LIMIT_REACHED' ? 'DISCOVERY_LIMIT' : null)
      signal.throwIfAborted()
      for (const evidence of verified) transactions.set(evidence.transactionDigest, evidence)
      coverage[family] = page.page.status; retainedEvidenceBytes = bytes
      pages++; verifiedCandidateEvents += page.events.length; pending = null
      if (page.page.status === 'COMPLETE') { familyIndex++; scanner = null; ended = familyIndex === SOUL_ACTIVITY_FAMILIES.length }
      else ended = page.page.status === 'LIMIT_REACHED'
      return result
    } finally { controller.abort(); busy = false }
  } })
}
