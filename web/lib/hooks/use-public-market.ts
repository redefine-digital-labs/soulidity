'use client'

import { useLayoutEffect, useId, useRef } from 'react'
import { useCommittedSession, type CommittedSession, type SessionLease } from './use-committed-session'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCurrentAccount, useCurrentWallet, useSuiClient } from '@mysten/dapp-kit'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import { createCollectionMarketDiscovery, createCollectionDetailDiscovery, profileReadStep,
  type CollectionMarketDiscoveryResult, type CollectionDetailDiscoveryResult } from '@soulidity/sdk'
import { createBrowserMarketSouls, type BrowserMarketSoulsPage } from '../soulidity/browser-market-souls'
import { getBrowserSoulDetailConfig, type BrowserSoulDetailConfig } from '../soulidity/browser-soul-detail'
import { getBrowserProfileConfig } from '../profile/profile-config'
import { createMarketCreatorReader } from '../soulidity/market-creators'
import {createBrowserEquipmentMarketDiscovery,type EquipmentMarketDiscoveryPage} from '../animacraft/browser-equipment-market-discovery'
import { selectCollectionMarket, selectSoulMarket, type CollectionsListParams, type MarketCreatorIdentity,
  type PublicMarketCoverage, type SoulsListParams } from '../soulidity/public-market-model'

type Page = BrowserMarketSoulsPage | CollectionMarketDiscoveryResult | CollectionDetailDiscoveryResult | EquipmentMarketDiscoveryPage
type Scope = CommittedSession
interface ReadState<T> { page: T | null; pages: number; busy: boolean; error: string | null; serial: number; lifetime: AbortSignal }
type Active<T> = { scope: Scope; lease: SessionLease; serial: number; abort: AbortController; lifetime: AbortSignal;
  reader: { next(options: { signal?: AbortSignal }): Promise<T> }; state: ReadState<T>;
  job: AbortController | null; flight: Promise<void> | null }

/** Both original mutation invalidation prefixes remain live. Filters never enter
 * this query key: they operate on the entire verified cumulative set, so typing
 * cannot start another global scan or reorder only the first twelve candidates. */
function useMarketSource<T extends Page>(kind: 'souls' | 'collections' | 'collection-detail' | 'collection-members' | 'equipment', collectionId?: string) {
  const account = useCurrentAccount(), { currentWallet: wallet } = useCurrentWallet(), client = useSuiClient()
  const queryClient = useQueryClient(), mountId = useId()
  const viewerAddress = account?.address ? normalizeSuiAddress(account.address) : null
  let config: BrowserSoulDetailConfig | null = null, configError: Error | null = null
  try { config = getBrowserSoulDetailConfig() } catch (error) { configError = error instanceof Error ? error : new Error('Market release configuration unavailable.') }
  const key = JSON.stringify([viewerAddress, config, configError?.message, collectionId])
  const scope = useCommittedSession(key, account, client, wallet)
  const active = useRef<Active<T> | null>(null), serial = useRef(0)
  const prefix = kind.startsWith('collection-') ? 'collection' : kind==='equipment'?'souls':kind
  const queryKey = kind.startsWith('collection-')
    ? [prefix, collectionId, kind, key, mountId, scope.generation] as const
    : [prefix, 'public-market-v1', kind, key, mountId, scope.generation] as const
  const matches = (run: Active<T>) => run.lease.matches() && active.current === run && !run.lifetime.aborted
  const publish = (run: Active<T>) => { if (matches(run)) queryClient.setQueryData<ReadState<T>>(queryKey, { ...run.state }) }
  async function scan(run: Active<T>) {
    if (!matches(run) || run.job) return
    const job = new AbortController(); run.job = job
    const signal = AbortSignal.any([run.lifetime, job.signal])
    run.state.error = null; run.state.busy = true; publish(run)
    try {
      while (matches(run) && !job.signal.aborted) {
        if (run.state.page && ['COMPLETE', 'LIMIT_REACHED'].includes(run.state.page.candidateStatus)) break
        const deadline = AbortSignal.timeout(120000), stepSignal = AbortSignal.any([signal, deadline])
        try {
          await profileReadStep(stepSignal, () => {
            run.flight ??= run.reader.next({ signal: stepSignal }).then(page => {
              run.lifetime.throwIfAborted()
              if (!matches(run)) throw new Error('PUBLIC_MARKET_READ_REPLACED')
              run.state.page = page; run.state.pages++
            }).finally(() => { run.flight = null })
            return run.flight
          })
        } catch (error) {
          run.lifetime.throwIfAborted()
          if (!job.signal.aborted) run.state.error = deadline.aborted ? 'Market page timed out. Retry the retained page.'
            : error instanceof Error ? error.message : 'Market scan unavailable. Retry the retained page.'
          break
        }
        publish(run)
      }
    } finally { if (run.job === job) run.job = null; run.state.busy = false; publish(run) }
  }
  // Setup precedes the query observer, including StrictMode effect replay.
  useLayoutEffect(() => {
    return () => {
      if (active.current?.scope === scope) { active.current.abort.abort(); active.current = null } }
  }, [scope])
  const query = useQuery<ReadState<T>>({ queryKey, retry: false, gcTime: 0, refetchOnWindowFocus: false, refetchOnReconnect: false,
    queryFn: async ({ signal }) => {
      signal.throwIfAborted()
      const lease = scope.capture()
      if (!lease?.matches()) throw new Error('PUBLIC_MARKET_IDENTITY_REPLACED')
      if (!config) throw configError
      const grpc = (client as unknown as { grpc?: SuiGrpcClient }).grpc
      if (!grpc) throw new Error('Verified public chain reader unavailable.')
      if (!config.discoveryEndpoint) throw new Error('Public chain discovery configuration unavailable.')
      active.current?.abort.abort()
      const abort = new AbortController(), lifetime = AbortSignal.any([signal, abort.signal])
      lease.requests.add(abort)
      const collectionOptions = { client: grpc, viewerAddress, signal: lifetime,
          deployment: { originalPackageId: config.native.soulidityOriginalPackageId, chainIdentifier: config.chainIdentifier,
            marketConfigId: config.marketConfigId, paymentCoinType: config.paymentCoinType,
            kioskRegistryId: config.kioskRegistryId, personalKioskTypePackageId: config.personalKioskTypePackageId },
          discovery: { endpoint: config.discoveryEndpoint, pageSize: 50, maxPages: 200, maxObjects: 10000, timeoutMs: 25000 } }
      if(kind==='equipment'&&(!config.native.equipmentMarket||!config.native.runtime))throw new Error('Equipment Market release configuration unavailable.')
      const reader = kind==='equipment'
        ?createBrowserEquipmentMarketDiscovery({client:grpc,config:{target:{...config.native,equipmentMarket:config.native.equipmentMarket!}},
          endpoint:config.discoveryEndpoint,chainIdentifier:config.chainIdentifier,paymentCoinType:config.paymentCoinType,actor:viewerAddress,signal:lifetime})
        :kind === 'souls' || kind === 'collection-members'
        ? createBrowserMarketSouls({ client: grpc, config, viewerAddress, signal: lifetime,
          ...(kind === 'collection-members' ? { selection: { kind: 'COLLECTION' as const, collectionId: collectionId! } } : {}) })
        : kind === 'collection-detail' ? createCollectionDetailDiscovery({ ...collectionOptions, collectionId: collectionId! })
          : createCollectionMarketDiscovery(collectionOptions)
      const runSerial = ++serial.current
      const run: Active<T> = { scope, lease, serial: runSerial, abort, lifetime, reader: reader as Active<T>['reader'],
        state: { page: null, pages: 0, busy: false, error: null, serial: runSerial, lifetime }, job: null, flight: null }
      active.current = run; publish(run)
      await scan(run); lifetime.throwIfAborted()
      if (!matches(run)) throw new Error('PUBLIC_MARKET_READ_REPLACED')
      return { ...run.state }
    } })
  const displayedSerial = query.data?.serial ?? 0
  const displayed = () => active.current?.scope === scope && active.current.serial === displayedSerial ? active.current : null
  const actionCurrent = () => scope.matches() && (active.current?.serial ?? 0) === displayedSerial
  const value = query.data, observed = value?.page ?? null
  const coverage: PublicMarketCoverage = observed?.candidateStatus ?? 'UNSCANNED'
  return { value, page: observed, coverage, viewerAddress, config, client,
    identityKey: `${mountId}:${scope.generation}:${displayedSerial}`, lifetime: query.data?.lifetime ?? null,
    progress: { coverage, pages: value?.pages ?? 0, busy: value?.busy ?? query.isFetching, phase: observed&&'phase' in observed?observed.phase:null,
      checkpoint: observed ? String(('source' in observed ? observed.source : 'collectionSource' in observed ? observed.collectionSource : null)?.checkpoint
        ?? ('listingSource' in observed?observed.listingSource.checkpoint:null)) : null },
    isLoading: query.isPending, error: query.error ?? (value?.error ? new Error(value.error) : null),
    pause: () => { const run = displayed(); if (run && actionCurrent()) run.job?.abort() },
    resume: () => { const run = displayed(); return run && actionCurrent() && matches(run) ? scan(run) : Promise.resolve() },
    refresh: () => actionCurrent() ? queryClient.invalidateQueries({ queryKey, exact: true }) : Promise.resolve(),
  }
}

export function usePublicEquipmentMarketSource(){return useMarketSource<EquipmentMarketDiscoveryPage>('equipment')}

export function usePublicCollectionDetailSource(collectionId: string) {
  return useMarketSource<CollectionDetailDiscoveryResult>('collection-detail', collectionId)
}
export function usePublicCollectionMembersSource(collectionId: string) {
  return useMarketSource<BrowserMarketSoulsPage>('collection-members', collectionId)
}

function useMarketCreators(source: ReturnType<typeof useMarketSource<BrowserMarketSoulsPage>>) {
  const client = (source.client as unknown as { grpc?: SuiGrpcClient }).grpc
  let profileConfig: ReturnType<typeof getBrowserProfileConfig> | null = null, configurationError: Error | null = null
  try {
    profileConfig = getBrowserProfileConfig()
    if (source.config && (profileConfig.deployment.originalPackageId !== source.config.native.soulidityOriginalPackageId
      || profileConfig.deployment.callablePackageId !== source.config.native.soulidityCallablePackageId
      || profileConfig.deployment.chainIdentifier !== source.config.chainIdentifier)) throw new Error('Creator profile belongs to a different release.')
  } catch (error) { profileConfig = null; configurationError = error instanceof Error ? error : new Error('Creator identity configuration unavailable.') }
  const profileKey = JSON.stringify([source.identityKey, profileConfig, configurationError?.message])
  const committed = useCommittedSession(profileKey, null, client, source.lifetime)
  // Profile/storage configuration has its own lifetime: A -> B -> A must not
  // make a callback from the first A current again while the asset scan stays put.
  const scope = JSON.stringify([profileKey, committed.generation])
  const lifetime = useRef<{ scope: string; abort: AbortController; reader: ReturnType<typeof createMarketCreatorReader> | null } | null>(null)
  useLayoutEffect(() => {
    return () => {
      if (lifetime.current?.scope === scope) { lifetime.current.abort.abort(); lifetime.current = null }
    }
  }, [scope])
  const owners = [...new Set((source.page?.souls ?? []).filter(s => s.listingStatus === 'listed').map(s => s.creatorAddress))].sort()
  // Enrichment starts after the current scan stops (complete, partial failure or
  // pause), not by restarting an all-creator download after every raw asset page.
  const enabled = !source.progress.busy && !!source.page && owners.length > 0
  const query = useQuery<Readonly<Record<string, MarketCreatorIdentity>>>({
    queryKey: ['public-market-creators', scope, owners], enabled, retry: false, gcTime: 0,
    refetchOnWindowFocus: false, refetchOnReconnect: false,
    queryFn: async ({ signal }) => {
      const lease = committed.capture()
      if (!lease?.matches()) throw new Error('Creator identity replaced.')
      if (!profileConfig) throw configurationError
      if (!client || !source.lifetime) throw new Error('Creator chain reader unavailable.')
      if (lifetime.current?.scope !== scope) {
        lifetime.current?.abort.abort()
        const abort = new AbortController()
        lease.requests.add(abort)
        lifetime.current = { scope, abort, reader: createMarketCreatorReader({ client: client.core, config: profileConfig,
          signal: AbortSignal.any([abort.signal, source.lifetime]) }) }
      }
      const session = lifetime.current
      const result = await session.reader!.read(owners, { signal, retryFailed: true })
      signal.throwIfAborted()
      if (lifetime.current !== session || !lease.matches()) throw new Error('Creator read replaced.')
      return result
    } })
  const unavailable = Object.values(query.data ?? {}).filter(row => row.status === 'UNAVAILABLE').length
  return { identities: query.data ?? {}, loading: enabled && query.isFetching, unavailable,
    error: query.error ?? (enabled ? configurationError : null),
    retry: () => committed.matches() ? query.refetch() : Promise.resolve() }
}

export function usePublicSoulsMarket(params: SoulsListParams = {}) {
  const source = useMarketSource<BrowserMarketSoulsPage>('souls'), creators = useMarketCreators(source)
  let data: ReturnType<typeof selectSoulMarket> | undefined, filterError: Error | null = null
  if (source.config) {
    try { data = selectSoulMarket({ souls: source.page?.souls ?? [], coverage: source.coverage,
      originalPackageId: source.config.native.soulidityOriginalPackageId, viewerAddress: source.viewerAddress, identities: creators.identities }, params) }
    catch (error) { filterError = error instanceof Error ? error : new Error('Market filter unavailable.') }
  }
  return { ...source, data, creators, error: filterError ?? source.error }
}
export function usePublicCollectionsMarket(params: CollectionsListParams = {}) {
  const source = useMarketSource<CollectionMarketDiscoveryResult>('collections')
  let data: ReturnType<typeof selectCollectionMarket> | undefined, filterError: Error | null = null
  if (source.config) {
    try { data = selectCollectionMarket({ collections: source.page?.collections ?? [], coverage: source.coverage,
      originalPackageId: source.config.native.soulidityOriginalPackageId, viewerAddress: source.viewerAddress }, params) }
    catch (error) { filterError = error instanceof Error ? error : new Error('Market filter unavailable.') }
  }
  return { ...source, data, error: filterError ?? source.error }
}
