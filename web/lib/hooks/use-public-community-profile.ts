'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { readWalletProfile, profileReadStep, type WalletProfileSnapshot } from '@soulidity/sdk'
import { useAuth } from '@/components/providers/auth-provider'
import { readPublicCommunityIdentity } from '@/lib/community/public-profile-read'
import { getBrowserProfileReadConfig } from '@/lib/profile/profile-config'
import { getBrowserSoulDetailConfig } from '@/lib/soulidity/browser-soul-detail'
import { createBrowserMarketSouls, type BrowserMarketSoulsPage } from '@/lib/soulidity/browser-market-souls'
import { useWalletSign } from './use-wallet-sign'
import { useCommunityFeed } from './use-community-feed'

export function usePublicCommunityProfile(spaceId: string) {
  const { suiGrpcClient } = useWalletSign()
  let config: ReturnType<typeof getBrowserProfileReadConfig> | null = null, configError: unknown
  try { config = structuredClone(getBrowserProfileReadConfig()) } catch (error) { configError = error }
  return useQuery({ queryKey: ['community-chain-profile', config, spaceId], enabled: !!spaceId,
    queryFn: async ({ signal }) => {
      if (!config) throw configError
      return readPublicCommunityIdentity({ client: suiGrpcClient.core, config, spaceId, signal })
    } })
}
export function useCommunityProfilePosts(profileId: string | null) {
  const feed = useCommunityFeed({ sort: 'latest', authorId: profileId ?? undefined }, !!profileId)
  return { ...feed, items: feed.items.slice(0, 10) }
}

type Session = { scope: string; controller: AbortController; reader: ReturnType<typeof createBrowserMarketSouls>; busy: boolean; pending: BrowserMarketSoulsPage | null }
/** Public original-creator discovery, including sold Souls and excluding items
 * merely purchased by this wallet. Identity changes invalidate the readset. */
export function useCommunityAuthoredSouls(profile: WalletProfileSnapshot | null) {
  const { walletAddress } = useAuth(), { suiGrpcClient } = useWalletSign()
  let config: ReturnType<typeof getBrowserSoulDetailConfig> | null = null
  let identityConfig: ReturnType<typeof getBrowserProfileReadConfig> | null = null, configError: unknown
  try { config = structuredClone(getBrowserSoulDetailConfig()); identityConfig = structuredClone(getBrowserProfileReadConfig()) }
  catch (error) { configError = error }
  const capturedProfile = profile ? structuredClone(profile) : null
  const scope = JSON.stringify([capturedProfile, walletAddress, config, identityConfig])
  const identity = useRef({ scope, client: suiGrpcClient })
  if (identity.current.scope !== scope || identity.current.client !== suiGrpcClient) identity.current = { scope, client: suiGrpcClient }
  const token = identity.current, mounted = useRef(false), active = useRef<Session | null>(null)
  const [view, setView] = useState<{ scope: string; page: BrowserMarketSoulsPage | null; loading: boolean; busy: boolean; error: string | null }>(
    { scope, page: null, loading: !!profile, busy: false, error: null })
  const current = (session?: Session) => mounted.current && identity.current === token
    && (!session || active.current === session && !session.controller.signal.aborted)
  async function checkIdentity(signal: AbortSignal) {
    if (!capturedProfile || !identityConfig) throw new Error('COMMUNITY_AUTHOR_IDENTITY_REQUIRED')
    const fresh = await profileReadStep(signal, () => readWalletProfile({ client: suiGrpcClient.core, deployment: identityConfig.deployment,
      profileId: capturedProfile.id, signal }))
    if (JSON.stringify(fresh) !== JSON.stringify(capturedProfile)) throw new Error('COMMUNITY_AUTHOR_CHANGED_RELOAD_PROFILE')
  }
  async function next(session: Session) {
    if (!current(session) || session.busy) return
    session.busy = true; setView(previous => ({ ...previous, busy: true, error: null }))
    const signal = AbortSignal.any([session.controller.signal, AbortSignal.timeout(120000)])
    try {
      await checkIdentity(signal)
      session.pending ??= await profileReadStep(signal, () => session.reader.next({ signal }))
      const page = session.pending
      await checkIdentity(signal)
      if (current(session)) { setView({ scope, page, loading: false, busy: false, error: null }); session.pending = null }
    } catch (error) {
      if (current(session)) setView(previous => ({ ...previous, loading: false, busy: false,
        error: error instanceof Error ? error.message : 'Authored Souls unavailable' }))
    } finally { session.busy = false }
  }
  async function refresh() {
    if (!current() || !capturedProfile) return
    active.current?.controller.abort(); active.current = null
    setView({ scope, page: null, loading: true, busy: false, error: null })
    try {
      if (!config || !identityConfig) throw configError
      if (config.chainIdentifier !== identityConfig.deployment.chainIdentifier
        || config.native.soulidityOriginalPackageId !== identityConfig.deployment.originalPackageId
        || capturedProfile.registryId !== identityConfig.deployment.registryId) throw new Error('COMMUNITY_AUTHOR_RELEASE_MISMATCH')
      const controller = new AbortController()
      const session: Session = { scope, controller, busy: false, pending: null, reader: createBrowserMarketSouls({ client: suiGrpcClient,
        config, viewerAddress: walletAddress, selection: { kind: 'AUTHOR', creatorAddress: capturedProfile.owner }, signal: controller.signal }) }
      active.current = session; await next(session)
    } catch (error) {
      if (current()) setView(previous => ({ ...previous, loading: false, busy: false,
        error: error instanceof Error ? error.message : 'Authored Soul configuration unavailable' }))
    }
  }
  useEffect(() => {
    mounted.current = true; void refresh()
    return () => { mounted.current = false; active.current?.controller.abort(); active.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, suiGrpcClient])
  const visible = profile && view.scope === scope ? view : { page: null, loading: !!profile, busy: false, error: null }
  const status = visible.page?.candidateStatus ?? 'PARTIAL'
  const items = [...(visible.page?.souls ?? [])].sort((a, b) => BigInt(a.createdAtMs) > BigInt(b.createdAtMs) ? -1
    : BigInt(a.createdAtMs) < BigInt(b.createdAtMs) ? 1 : a.onChainId.localeCompare(b.onChainId)).slice(0, 12)
  return { items, loading: visible.loading, busy: visible.busy, error: visible.error,
    status: status === 'COMPLETE' ? 'COMPLETE' as const : status === 'LIMIT_REACHED' ? 'LIMIT_REACHED' as const : 'PARTIAL' as const,
    refresh, loadMore: async () => { if (current() && active.current && !['COMPLETE', 'LIMIT_REACHED'].includes(status)) await next(active.current) } }
}
