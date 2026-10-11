'use client'

import { useQuery } from '@tanstack/react-query'
import { useCommittedSession } from './use-committed-session'
import { useCurrentAccount } from '@mysten/dapp-kit'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import { getBrowserSoulDetailConfig, readBrowserSoulDetail } from '@/lib/soulidity/browser-soul-detail'

export { usePublicSoulsMarket as useSoulsList } from './use-public-market'
export type { SoulsSortOption, SoulsListParams } from '../soulidity/public-market-model'

export function useSoulDetail(id: string) {
  const account = useCurrentAccount()
  const viewerAddress = account?.address ? normalizeSuiAddress(account.address) : null
  const release = (() => {
    try { return { config: getBrowserSoulDetailConfig(), error: null } }
    catch (error) { return { config: null, error: error instanceof Error ? error : new Error('Soul release configuration unavailable') } }
  })()
  const session = useCommittedSession(JSON.stringify([id, viewerAddress, release.config, release.error?.message]), viewerAddress, null, null)
  return useQuery({
    // Preserve the ['soul', id] invalidation prefix; cache scope is the actual
    // connected wallet and complete public release, not a retired SQL member ID.
    queryKey: ['soul', id, viewerAddress, 'chain-detail-v1', release.config ?? release.error?.message, session.generation],
    queryFn: ({ signal }) => {
      if (!release.config) throw release.error
      const lease = session.capture()
      if (!lease?.matches()) throw new Error('Soul detail identity changed.')
      const abort = new AbortController(); lease.requests.add(abort)
      return readBrowserSoulDetail({ soulId: id, viewerAddress, config: release.config, signal: AbortSignal.any([signal, abort.signal]),
        getViewerAddress: () => lease.matches() ? viewerAddress : null }).finally(() => lease.requests.delete(abort))
    },
    enabled: !!id,
  })
}

export { useMySouls } from './use-my-souls'
