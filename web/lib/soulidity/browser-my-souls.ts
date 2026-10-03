import { createCollectionPortfolioDiscovery, profileReadStep, type CollectionPortfolioDiscoveryResult } from '@soulidity/sdk'
import { createNativeReceiveClient, receiveId } from '@/lib/animacraft/native-receive'
import { createBrowserOwnedSouls, type BrowserOwnedSoulsPage } from './browser-owned-souls'
import { createBrowserSoulActivity, type BrowserSoulActivityPage } from './browser-soul-activity'
import type { BrowserSoulDetailConfig } from './browser-soul-detail'
import { composeMySoulsPortfolio, type MySoulsPortfolio } from './soul-portfolio-model'

export const MY_SOULS_SECTIONS = ['owned', 'collections', 'activity'] as const
export type MySoulsSection = typeof MY_SOULS_SECTIONS[number]
export interface MySoulsProgress {
  readonly status: MySoulsPortfolio['coverage'][MySoulsSection]
  readonly pages: number
  readonly busy: boolean
  readonly error: string | null
  readonly stage: string | null
  readonly checkpoint: string | null
  readonly limitReason: string | null
}
export interface BrowserMySoulsSnapshot {
  readonly portfolio: MySoulsPortfolio
  readonly progress: Readonly<Record<MySoulsSection, MySoulsProgress>>
  readonly consistency: 'INDEPENDENT_NON_ATOMIC_READSETS'
  readonly notAuthorization: true
}
type Sources = { owned: BrowserOwnedSoulsPage | null; collections: CollectionPortfolioDiscoveryResult | null; activity: BrowserSoulActivityPage | null }
type Dependencies = {
  client?: typeof createNativeReceiveClient
  owned?: typeof createBrowserOwnedSouls
  collections?: typeof createCollectionPortfolioDiscovery
  activity?: typeof createBrowserSoulActivity
}

/** Three independent cumulative readers. A wallet without a Kiosk still scans
 * created/sold Collections and received grants/purchases. The UI may pause or
 * retry one source without throwing away already verified data in the others.
 * This coordinator does not certify a shared checkpoint or authorize a write.
 */
export function createBrowserMySouls(params: {
  owner: string; config: BrowserSoulDetailConfig; signal: AbortSignal
}, dependencies: Dependencies = {}) {
  const owner = receiveId(params.owner), config = structuredClone(params.config), lifetime = params.signal
  const originalPackageId = receiveId(config.native.soulidityOriginalPackageId)
  lifetime.throwIfAborted()
  const client = (dependencies.client ?? createNativeReceiveClient)(lifetime)
  const sources: Sources = { owned: null, collections: null, activity: null }
  const state = Object.fromEntries(MY_SOULS_SECTIONS.map(section => [section, { pages: 0, busy: false, error: null as string | null }])) as
    Record<MySoulsSection, { pages: number; busy: boolean; error: string | null }>
  let owned: ReturnType<typeof createBrowserOwnedSouls> | null = null
  let collections: ReturnType<typeof createCollectionPortfolioDiscovery> | null = null
  let activity: ReturnType<typeof createBrowserSoulActivity> | null = null
  const flights: Record<MySoulsSection, Promise<void> | null> = { owned: null, collections: null, activity: null }

  function portfolio(candidate: Sources = sources) {
    return composeMySoulsPortfolio({ owner, originalPackageId, ...candidate })
  }
  function snapshot(): BrowserMySoulsSnapshot {
    lifetime.throwIfAborted()
    const data = portfolio()
    const progress = Object.fromEntries(MY_SOULS_SECTIONS.map(section => [section, Object.freeze({
      ...state[section], status: data.coverage[section],
      stage: section === 'collections' ? sources.collections?.phase ?? null
        : section === 'activity' ? sources.activity?.currentFamily ?? null : null,
      checkpoint: section === 'collections' ? sources.collections?.collectionSource
        ? String(sources.collections.collectionSource.checkpoint) : sources.collections?.listingSource
          ? String(sources.collections.listingSource.checkpoint) : null
        : section === 'activity' ? sources.activity?.activity.checkpoint ?? null : null,
      limitReason: section === 'activity' ? sources.activity?.limitReason ?? null
        : data.coverage[section] === 'LIMIT_REACHED' ? 'DISCOVERY_LIMIT' : null,
    })])) as unknown as Record<MySoulsSection, MySoulsProgress>
    return Object.freeze({ portfolio: data, progress: Object.freeze(progress), consistency: 'INDEPENDENT_NON_ATOMIC_READSETS', notAuthorization: true })
  }
  async function read(section: MySoulsSection, signal: AbortSignal) {
    lifetime.throwIfAborted(); signal.throwIfAborted()
    if (section === 'owned') {
      owned ??= (dependencies.owned ?? createBrowserOwnedSouls)({ owner, config, signal: lifetime }, { client: () => client })
      return { ...sources, owned: await owned.next({ signal }) }
    }
    if (config.discoveryEndpoint === null) throw new Error('MY_SOULS_DISCOVERY_UNAVAILABLE')
    if (section === 'activity') {
      activity ??= (dependencies.activity ?? createBrowserSoulActivity)({ viewerAddress: owner, config, signal: lifetime }, { client: () => client })
      return { ...sources, activity: await activity.next({ signal }) }
    }
    collections ??= (dependencies.collections ?? createCollectionPortfolioDiscovery)({ client,
      viewerAddress: owner,
      deployment: { originalPackageId, chainIdentifier: config.chainIdentifier, marketConfigId: config.marketConfigId,
        paymentCoinType: config.paymentCoinType, kioskRegistryId: config.kioskRegistryId, personalKioskTypePackageId: config.personalKioskTypePackageId },
      // The complete root scan includes current holders and original creators;
      // it must not wait for Kiosk discovery or mutable held-right seed arrays.
      discovery: { endpoint: config.discoveryEndpoint, pageSize: 50, maxPages: 200, maxObjects: 10000, timeoutMs: 25000 },
    })
    return { ...sources, collections: await collections.next({ signal }) }
  }
  return Object.freeze({ snapshot,
    async next(section: MySoulsSection, options: { signal?: AbortSignal } = {}): Promise<BrowserMySoulsSnapshot> {
      lifetime.throwIfAborted(); options.signal?.throwIfAborted()
      if (!(MY_SOULS_SECTIONS as readonly string[]).includes(section)) throw new Error('MY_SOULS_SECTION_INVALID')
      const ownedState = state[section]
      if (ownedState.busy) throw new Error('MY_SOULS_SECTION_BUSY')
      const status = portfolio().coverage[section]
      if (status === 'COMPLETE' || status === 'LIMIT_REACHED') return snapshot()
      ownedState.busy = true; ownedState.error = null
      const deadline = AbortSignal.timeout(120000), controller = new AbortController()
      const signal = AbortSignal.any([lifetime, controller.signal, deadline, ...(options.signal ? [options.signal] : [])])
      try {
        await profileReadStep(signal, () => {
          // A transport that ignores cancellation may still complete its page.
          // Join that flight on retry; never advance the same cursor twice or
          // let a late page overwrite a newer page in this channel.
          flights[section] ??= read(section, signal).then(candidate => {
            lifetime.throwIfAborted()
            // Merge only this channel. Concurrent reads may have accepted newer
            // snapshots in other channels while this page was in flight.
            const next = { ...sources, [section]: candidate[section] }
            portfolio(next)
            Object.assign(sources, next); ownedState.pages++
          }).finally(() => { flights[section] = null })
          return flights[section]!
        })
      } catch (error) {
        lifetime.throwIfAborted()
        // A pause is not a failed scan or empty result. Accepted pages are
        // latched above even if caller cancellation wins the outer handoff.
        if (!options.signal?.aborted)
          ownedState.error = deadline.aborted ? 'MY_SOULS_READ_TIMEOUT' : error instanceof Error ? error.message : 'Portfolio source unavailable. Retry this scan.'
      } finally { controller.abort(); ownedState.busy = false }
      return snapshot()
    },
  })
}
