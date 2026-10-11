import { profileReadStep, readMyWalletProfile, readPublicProfileMetadata, type WalletProfileReadClient } from '@soulidity/sdk'
import type { BrowserProfileConfig } from '@/lib/profile/profile-config'
import type { MarketCreatorIdentity } from './public-market-model'

const validOwner = (value: unknown): value is string => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value)
type Dependencies = { profile?: typeof readMyWalletProfile; metadata?: typeof readPublicProfileMetadata }

/** Only the publicly declared Profile of an observed asset creator is read.
 * No private membership directory, bookmark data or signed session is involved.
 * A transport/storage failure is an unavailable identity, never no Profile.
 * Cache lifetime is one captured market scan; a refresh creates a new reader. */
export function createMarketCreatorReader(params: { client: WalletProfileReadClient; config: BrowserProfileConfig;
  signal: AbortSignal }, dependencies: Dependencies = {}) {
  const client = params.client, config = structuredClone(params.config), lifetime = params.signal
  const cache = new Map<string, MarketCreatorIdentity>()
  let flight: Promise<void> | null = null
  const profileReader = dependencies.profile ?? readMyWalletProfile, metadataReader = dependencies.metadata ?? readPublicProfileMetadata
  async function readOwner(address: string, signal: AbortSignal, parent: AbortSignal) {
    try {
      const args = { client, deployment: config.deployment, owner: address, signal }
      const profile = await profileReadStep(signal, () => profileReader(args))
      const metadata = profile ? (await profileReadStep(signal, () => metadataReader({ client,
        reference: profile.metadata, storage: config.storage, signal }))).metadata : null
      const final = await profileReadStep(signal, () => profileReader(args))
      if (JSON.stringify(final) !== JSON.stringify(profile)) throw new Error('MARKET_CREATOR_CHANGED_RETRY')
      if (profile && profile.owner !== address) throw new Error('MARKET_CREATOR_OWNER_MISMATCH')
      signal.throwIfAborted()
      cache.set(address, Object.freeze({ address, status: profile ? 'VERIFIED' : 'ABSENT', profileId: profile?.id ?? null,
        displayName: metadata?.displayName ?? null, handle: profile?.handle ?? null, error: null }))
    } catch (failure) {
      parent.throwIfAborted()
      cache.set(address, Object.freeze({ address, status: 'UNAVAILABLE', profileId: null, displayName: null, handle: null,
        error: failure instanceof Error ? failure.message : 'Public creator identity unavailable.' }))
    }
  }
  return Object.freeze({
    snapshot(): Readonly<Record<string, MarketCreatorIdentity>> { lifetime.throwIfAborted(); return Object.freeze(Object.fromEntries(cache)) },
    async read(owners: readonly string[], options: { signal?: AbortSignal; retryFailed?: boolean } = {}) {
      lifetime.throwIfAborted(); options.signal?.throwIfAborted()
      const captured = [...owners]
      if (captured.length > 10000 || !captured.every(validOwner) || new Set(captured).size !== captured.length) throw new Error('MARKET_CREATORS_INPUT_INVALID')
      if (flight) throw new Error('MARKET_CREATORS_BUSY')
      const wanted = captured.filter(address => !cache.has(address) || options.retryFailed && cache.get(address)?.status === 'UNAVAILABLE')
      const controller = new AbortController(), signal = AbortSignal.any([lifetime, controller.signal, ...(options.signal ? [options.signal] : [])])
      let position = 0
      const work = Promise.all(Array.from({ length: Math.min(wanted.length, 4) }, async () => {
        while (position < wanted.length) {
          signal.throwIfAborted(); const address = wanted[position++]
          await readOwner(address, AbortSignal.any([signal, AbortSignal.timeout(40000)]), signal)
        }
      })).then(() => {})
      flight = work
      try { await profileReadStep(signal, () => work) }
      finally {
        controller.abort()
        // Keep a transport which ignores cancellation attached until it settles;
        // no new read may overlap it or write older data over a newer attempt.
        void work.finally(() => { if (flight === work) flight = null }).catch(() => {})
      }
      lifetime.throwIfAborted()
      return Object.freeze(Object.fromEntries(cache))
    },
  })
}
