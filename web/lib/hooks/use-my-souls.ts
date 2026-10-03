'use client'

import { useLayoutEffect, useId, useRef } from 'react'
import { useCommittedSession, type CommittedSession, type SessionLease } from './use-committed-session'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCurrentAccount, useCurrentWallet, useSuiClient } from '@mysten/dapp-kit'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { createBrowserMySouls, MY_SOULS_SECTIONS, type BrowserMySoulsSnapshot, type MySoulsSection } from '../soulidity/browser-my-souls'
import { getBrowserSoulDetailConfig } from '../soulidity/browser-soul-detail'

type Scope = CommittedSession
type PortfolioRead = BrowserMySoulsSnapshot & { runSerial: number }
type Active = { scope: Scope; lease: SessionLease; serial: number; abort: AbortController; reader: ReturnType<typeof createBrowserMySouls>;
  jobs: Record<MySoulsSection, AbortController | null> }

/** Public chain portfolio, not a private account membership index. The existing
 * ['my-souls'] invalidation prefix restarts all three readers after mutations.
 * Each source publishes independent bounded progress and offers pause/retry;
 * wallet/client/release replacement masks old rows synchronously, including ABA.
 */
export function useMySouls() {
  const account = useCurrentAccount(), { currentWallet: wallet } = useCurrentWallet(), client = useSuiClient()
  const queryClient = useQueryClient(), mountId = useId()
  const owner = account?.address ? normalizeSuiAddress(account.address) : null, connected = Boolean(owner && wallet)
  let config: ReturnType<typeof getBrowserSoulDetailConfig> | null = null, configError: Error | null = null
  try { config = getBrowserSoulDetailConfig() } catch (error) { configError = error instanceof Error ? error : new Error('Portfolio release unavailable.') }
  const key = JSON.stringify([owner, config, configError?.message])
  const scope = useCommittedSession(key, account, client, wallet)
  const active = useRef<Active | null>(null), serial = useRef(0)
  const queryKey = ['my-souls', 'chain-portfolio-v1', owner, key, mountId, scope.generation] as const
  const matches = (run: Active) => run.lease.matches()
    && active.current === run && !run.abort.signal.aborted
  const publish = (run: Active) => { if (matches(run)) queryClient.setQueryData<PortfolioRead>(queryKey, { ...run.reader.snapshot(), runSerial: run.serial }) }
  async function scan(run: Active, section: MySoulsSection) {
    if (!matches(run) || run.jobs[section]) return
    const cancellation = new AbortController(); run.jobs[section] = cancellation
    try {
      while (matches(run) && !cancellation.signal.aborted) {
        const before = run.reader.snapshot().progress[section]
        if (before.status === 'COMPLETE' || before.status === 'LIMIT_REACHED') break
        const next = run.reader.next(section, { signal: cancellation.signal })
        publish(run)
        await next
        if (!matches(run)) return
        publish(run)
        if (run.reader.snapshot().progress[section].error) break
      }
    } finally {
      if (run.jobs[section] === cancellation) run.jobs[section] = null
      publish(run)
    }
  }
  // Register lifetime setup before the query observer can start its first read,
  // including React StrictMode's effect cleanup/setup replay.
  useLayoutEffect(() => {
    return () => {
      if (active.current?.scope === scope) { active.current.abort.abort(); active.current = null }
    }
  }, [scope])
  const query = useQuery<PortfolioRead>({
    queryKey, enabled: connected, retry: false, gcTime: 0,
    // A focus/reconnect event is not an instruction to discard scan progress.
    // Explicit refresh and existing mutation invalidation start a fresh read.
    refetchOnWindowFocus: false, refetchOnReconnect: false,
    queryFn: async ({ signal }) => {
      signal.throwIfAborted()
      const lease = scope.capture()
      if (!lease?.matches()) throw new Error('MY_SOULS_IDENTITY_REPLACED')
      if (!owner || !wallet) throw new Error('Connect your wallet to read your portfolio.')
      if (!config) throw configError
      const grpc = (client as unknown as { grpc?: SuiGrpcClient }).grpc
      if (!grpc) throw new Error('Reconnect a wallet with the verified chain reader.')
      active.current?.abort.abort()
      const abort = new AbortController(), lifetime = AbortSignal.any([abort.signal, signal])
      lease.requests.add(abort)
      const run: Active = { scope, lease, serial: ++serial.current, abort,
        reader: createBrowserMySouls({ owner, config, signal: lifetime }, { client: () => grpc }),
        jobs: { owned: null, collections: null, activity: null } }
      active.current = run; publish(run)
      await Promise.all(MY_SOULS_SECTIONS.map(section => scan(run, section)))
      lifetime.throwIfAborted()
      if (!matches(run)) throw new Error('MY_SOULS_READ_REPLACED')
      return { ...run.reader.snapshot(), runSerial: run.serial }
    },
  })
  const displayedSerial = query.data?.runSerial ?? 0
  const displayed = () => active.current?.scope === scope && active.current.serial === displayedSerial ? active.current : null
  const actionCurrent = () => scope.matches() && (active.current?.serial ?? 0) === displayedSerial
  const snapshot = connected ? query.data : undefined
  return {
    owner, connected, snapshot, data: snapshot?.portfolio, progress: snapshot?.progress,
    identityKey: `${mountId}:${scope.generation}:${displayedSerial}`,
    isLoading: connected && query.isPending, isFetching: connected && query.isFetching,
    error: connected ? query.error : null,
    refresh: () => {
      if (!actionCurrent()) return Promise.resolve()
      return queryClient.invalidateQueries({ queryKey, exact: true })
    },
    pause: (section: MySoulsSection) => { const run = displayed(); if (run && actionCurrent() && matches(run)) run.jobs[section]?.abort() },
    resume: (section: MySoulsSection) => {
      const run = displayed()
      if (!run || !actionCurrent() || !matches(run)) return Promise.resolve()
      return scan(run, section)
    },
  }
}
