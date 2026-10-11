import { createWalletKioskInventory, profileReadStep, type WalletKioskInventoryPage } from '@soulidity/sdk'
import { createNativeReceiveClient, receiveId } from '@/lib/animacraft/native-receive'
import { readBrowserSoulDetail, type BrowserSoulDetailConfig } from './browser-soul-detail'
import type { ChainSoulDetail } from './soul-detail-model'

export interface BrowserOwnedSoulsPage {
  readonly owner: string
  readonly souls: readonly ChainSoulDetail[]
  readonly heldCollectionRightIds: readonly string[]
  readonly inventory: WalletKioskInventoryPage
  readonly status: WalletKioskInventoryPage['status']
  readonly consistency: 'NON_ATOMIC_CURRENT_READSETS'
  readonly notAuthorization: true
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}

/** One explicit inventory page per call, followed by bounded detail hydration.
 * Detail failure retains even the final inventory page for retry. No partial
 * page, fabricated grant history or SQL identity is committed. Membership and
 * each Soul detail have their own read sets, not a global atomic snapshot.
 * The owning hook must abort its lifetime on any wallet/client/release change,
 * including away-and-back transitions; a matching address alone is insufficient.
 */
export function createBrowserOwnedSouls(params: {
  owner: string; config: BrowserSoulDetailConfig; signal: AbortSignal
}, dependencies: {
  client?: typeof createNativeReceiveClient
  inventory?: typeof createWalletKioskInventory
  detail?: typeof readBrowserSoulDetail
} = {}) {
  const owner = receiveId(params.owner), config = structuredClone(params.config), lifetime = params.signal
  lifetime.throwIfAborted()
  const pkg = receiveId(config.native.soulidityOriginalPackageId)
  const clientFactory = dependencies.client ?? createNativeReceiveClient
  const client = clientFactory(lifetime)
  const scanner = (dependencies.inventory ?? createWalletKioskInventory)({ client, owner,
    deployment: { originalPackageId: pkg, chainIdentifier: config.chainIdentifier, kioskRegistryId: config.kioskRegistryId },
    pageSize: 20, maxPages: 500, maxFields: 10000, maxItems: 2000 })
  const details = new Map<string, ChainSoulDetail>()
  const rights = new Set<string>()
  let pending: WalletKioskInventoryPage | null = null, busy = false, ended = false
  let inventoryRead: Promise<WalletKioskInventoryPage> | null = null
  return Object.freeze({ async next({ signal: callerSignal }: { signal?: AbortSignal } = {}): Promise<BrowserOwnedSoulsPage> {
    lifetime.throwIfAborted(); callerSignal?.throwIfAborted()
    if (busy) throw new Error('OWNED_SOULS_BUSY')
    if (ended) throw new Error('OWNED_SOULS_SCAN_ENDED')
    busy = true
    const controller = new AbortController()
    const signal = AbortSignal.any([lifetime, controller.signal, AbortSignal.timeout(120000), ...(callerSignal ? [callerSignal] : [])])
    try {
      if (!pending) {
        // Latch every accepted inventory page even when caller cancellation wins
        // the outer wait immediately after the underlying scan commits a cursor.
        // Retry joins that read instead of starting a second scan or skipping it.
        await profileReadStep(signal, () => {
          inventoryRead ??= scanner.next({ signal }).then(page => { pending = page; return page })
            .finally(() => { inventoryRead = null })
          return inventoryRead
        })
      }
      const page = pending
      if (!page) throw new Error('OWNED_SOULS_INVENTORY_UNAVAILABLE')
      if (page.owner !== owner) throw new Error('OWNED_SOULS_INVENTORY_SCOPE_MISMATCH')
      const candidates = page.items.filter(row => row.type === `${pkg}::soul::Soul` && !details.has(row.itemId))
      const hydrated: ChainSoulDetail[] = []; let position = 0
      await Promise.all(Array.from({ length: Math.min(4, candidates.length) }, async () => {
        while (position < candidates.length) {
          signal.throwIfAborted(); const index = position++, candidate = candidates[index]
          const detail = await profileReadStep(signal, () => (dependencies.detail ?? readBrowserSoulDetail)({
            soulId: candidate.itemId, viewerAddress: owner, config, signal,
          }, { client: () => client }))
          signal.throwIfAborted()
          if (detail.originalPackageId !== pkg || detail.onChainId !== candidate.itemId || detail.viewerAddress !== owner
            || detail.currentOwnerAddress !== owner || detail.currentKioskId !== page.kioskId || !detail.isOwner)
            throw new Error('OWNED_SOULS_CHANGED_RESTART')
          hydrated[index] = detail
        }
      }))
      signal.throwIfAborted()
      // Commit all view data only after every worker has completed successfully.
      for (const detail of hydrated) details.set(detail.onChainId, detail)
      for (const item of page.items) if (item.type === `${pkg}::collection::SoulCollectionRight`) rights.add(item.itemId)
      pending = null; ended = page.status !== 'PARTIAL'
      return freeze({ owner, souls: structuredClone([...details.values()]), heldCollectionRightIds: [...rights],
        inventory: page, status: page.status, consistency: 'NON_ATOMIC_CURRENT_READSETS', notAuthorization: true })
    } finally { controller.abort(); busy = false }
  } })
}
