'use client'

import { useEffect, useRef, useState } from 'react'
import { useAuth } from '@/components/providers/auth-provider'
import { getBrowserCommunityVoteConfig } from '@/lib/community/public-post-vote-read'
import { createCommunityFeedDiscovery, selectCommunityFeed, countCommunityChannels, type CommunityFeedFilters } from '@/lib/community/feed-discovery'
import { useWalletSign } from './use-wallet-sign'

type Snapshot = ReturnType<ReturnType<typeof createCommunityFeedDiscovery>['snapshot']>
type Session = { scope: string; controller: AbortController; scan: ReturnType<typeof createCommunityFeedDiscovery>; busy: boolean }
const empty: Snapshot = { items: [], scanned: 0, nextIndex: '0', upperBound: null, observedCount: '0', status: 'PARTIAL', hasNewerEntries: false, atomic: false }
/** Sorting/filter changes reuse the same verified scan; refresh explicitly starts
 * a fresh bounded window. Retry after a failed page retains its exact cursor. */
export function useCommunityFeed(filters: CommunityFeedFilters, enabled = true) {
  const { walletAddress } = useAuth(), { suiGrpcClient } = useWalletSign()
  let config: ReturnType<typeof getBrowserCommunityVoteConfig> | null = null, configurationError: unknown
  try { config = structuredClone(getBrowserCommunityVoteConfig()) } catch (error) { configurationError = error }
  const scope = JSON.stringify([config, walletAddress, enabled])
  const latest = useRef({ scope, client: suiGrpcClient })
  if (latest.current.scope !== scope || latest.current.client !== suiGrpcClient) latest.current = { scope, client: suiGrpcClient }
  const token = latest.current, mounted = useRef(false)
  const session = useRef<Session | null>(null)
  const [view, setView] = useState({ scope, snapshot: empty, loading: true, busy: false, error: null as string | null, now: Date.now() })
  const current = (value: Session) => mounted.current && session.current === value && latest.current === token && !value.controller.signal.aborted
  async function next(value: Session) {
    if (!current(value) || value.busy) return
    value.busy = true
    setView(previous => ({ ...previous, busy: true, error: null }))
    try {
      const snapshot = await value.scan.next()
      if (current(value)) setView({ scope, snapshot, loading: false, busy: false, error: null, now: Date.now() })
    } catch (error) {
      if (current(value)) setView(previous => ({ ...previous, loading: false, busy: false,
        error: error instanceof Error ? error.message : 'Community feed unavailable' }))
    } finally { value.busy = false }
  }
  async function refresh() {
    if (!enabled || !mounted.current || latest.current !== token) return
    session.current?.controller.abort(); session.current = null
    setView({ scope, snapshot: empty, loading: true, busy: false, error: null, now: Date.now() })
    try {
      if (!config) throw configurationError
      const controller = new AbortController()
      const value: Session = { scope, controller, busy: false, scan: createCommunityFeedDiscovery({
        client: suiGrpcClient, config, viewerAddress: walletAddress, signal: controller.signal, maxPosts: 3000 }) }
      session.current = value
      await next(value)
    } catch (error) {
      if (mounted.current && latest.current === token) setView(previous => ({ ...previous, loading: false, busy: false,
        error: error instanceof Error ? error.message : 'Community feed configuration unavailable' }))
    }
  }
  useEffect(() => {
    mounted.current = true
    void refresh()
    return () => { mounted.current = false; session.current?.controller.abort(); session.current = null }
    // Sorting/filtering doesn't refetch immutable bodies or create transactions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, suiGrpcClient])
  const visible = !enabled ? { ...view, snapshot: empty, loading: false, busy: false, error: null }
    : view.scope === scope ? view : { ...view, snapshot: empty, loading: true, busy: false, error: null }
  let items: Snapshot['items'] = [], selectionError: string | null = null
  let channels: ReturnType<typeof countCommunityChannels> | null = null
  if (visible.snapshot.scanned > 0 || visible.snapshot.status === 'COMPLETE_WINDOW') channels = countCommunityChannels(visible.snapshot.items)
  try { items = selectCommunityFeed(visible.snapshot.items, filters, visible.now) }
  catch (error) { selectionError = error instanceof Error ? error.message : 'Community feed filters invalid' }
  return { items, channels, loading: visible.loading, busy: visible.busy, error: visible.error ?? selectionError,
    status: visible.snapshot.status, scanned: visible.snapshot.scanned, observedCount: visible.snapshot.observedCount,
    hasNewerEntries: visible.snapshot.hasNewerEntries, refresh,
    loadMore: async () => { const value = session.current; if (value?.scope === scope && value.scan.snapshot().status === 'PARTIAL') await next(value) } }
}
