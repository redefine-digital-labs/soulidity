'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useCurrentAccount, useCurrentWallet, useSuiClient } from '@mysten/dapp-kit'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/components/providers/auth-provider'
import { useGrant } from '@/lib/hooks/use-grant'
import { getBrowserContentWriteConfig, readBrowserContentWriteState } from '@/lib/soulidity/browser-content-write-state'
import type { ChainSoulDetail } from '@/lib/soulidity/soul-detail-model'

interface AgentGrantTarget { memberId: string; address: string; displayName: string | null }
export interface AgentGrantRecommendationsProps {
  soul: ChainSoulDetail; kindScopeMask: number; kindLabel: string
  role: 'owner' | 'grantee' | 'visitor'; pendingAction: string | null; onAuthorized?: () => void
}
function truncateAddress(addr: string) { return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr }

/** Private account discovery remains a separate unfinished dependency. It only
 * suggests addresses: neither its masks nor capacity are transaction authority.
 * A missing service is visible, never silently interpreted as no account agents. */
export function AgentGrantRecommendations({ soul, kindScopeMask, kindLabel, role, pendingAction, onAuthorized }: AgentGrantRecommendationsProps) {
  const [targets, setTargets] = useState<AgentGrantTarget[]>([]), [error, setError] = useState<string | null>(null)
  const [grantingAddress, setGrantingAddress] = useState<string | null>(null)
  const { getAuthHeaders, user } = useAuth(), account = useCurrentAccount(), { currentWallet: wallet } = useCurrentWallet()
  const client = useSuiClient(), queryClient = useQueryClient(), grant = useGrant(soul)
  let configuration: string
  try { configuration = JSON.stringify(getBrowserContentWriteConfig()) } catch { configuration = 'unavailable' }
  const scope = JSON.stringify([soul.onChainId, soul.stateOnChainId, soul.contentOnChainId, role, kindScopeMask, configuration])
  const [session, setSession] = useState({ scope, user, account, wallet, client, generation: 1 })
  if (session.scope !== scope || session.user !== user || session.account !== account || session.wallet !== wallet || session.client !== client) {
    setSession({ scope, user, account, wallet, client, generation: session.generation + 1 })
    setTargets([]); setError(null); setGrantingAddress(null)
  }
  const identity = useRef(session)
  useLayoutEffect(() => { identity.current = session }, [session])
  const generation = session.generation, request = useRef(0), pendingRead = useRef<AbortController | null>(null)
  const authorizing = useRef(false)
  const matches = () => generation === identity.current.generation
  const refresh = useCallback(async () => {
    if (!matches()) return
    pendingRead.current?.abort()
    const controller = new AbortController(), sequence = ++request.current
    pendingRead.current = controller
    const valid = () => matches() && sequence === request.current && !controller.signal.aborted
    if (role !== 'owner') return
    await (async () => {
      const headers = await getAuthHeaders()
      if (!valid()) return
      const res = await fetch(`/api/souls/${encodeURIComponent(soul.onChainId)}/auto-grant-targets?scopeMask=${kindScopeMask}`,
        { cache: 'no-store', headers, signal: controller.signal })
      if (!valid()) return
      const body = await res.json()
      if (!valid()) return
      if (!res.ok) throw new Error(body.error ?? `Private agent discovery unavailable (HTTP ${res.status})`)
      if (!Array.isArray(body.targets) || body.targets.length > 10000) throw new Error('Invalid private agent suggestions')
      const candidates: AgentGrantTarget[] = body.targets.map((target: any) => {
        if (typeof target?.memberId !== 'string' || typeof target.address !== 'string' || !/^0x[0-9a-f]{64}$/.test(target.address)
          || target.displayName !== null && typeof target.displayName !== 'string') throw new Error('Invalid private agent address')
        return { memberId: target.memberId, address: target.address, displayName: target.displayName }
      })
      if (new Set(candidates.map(target => target.address)).size !== candidates.length) throw new Error('Duplicate private agent address')
      if (!account?.address || !wallet) throw new Error('Connect the owner wallet to check current scopes')
      const proof = await readBrowserContentWriteState({ config: getBrowserContentWriteConfig(), soulId: soul.onChainId,
        stateId: soul.stateOnChainId, contentId: soul.contentOnChainId, viewerAddress: account.address, signal: controller.signal },
        { client: () => (client as unknown as { grpc: SuiGrpcClient }).grpc })
      if (!valid()) return
      if (proof.snapshot.currentOwner !== account.address) throw new Error('Only the current owner can authorize account agents')
      return candidates.filter(target => !proof.snapshot.grants.some(row => row.slot.grantee === target.address
        && row.currentEpoch && row.unexpiredAtObservation && (Number(row.slot.scope_mask) & kindScopeMask) === kindScopeMask))
    })().then(targets => {
      if (valid() && targets) { setTargets(targets); setError(null) }
    }).catch(err => {
      if (valid()) { setError(err instanceof Error ? err.message : 'Could not check private agent grants'); setTargets([]) }
    }).finally(() => { if (pendingRead.current === controller) pendingRead.current = null })
  }, [generation, scope, getAuthHeaders])
  useEffect(() => {
    authorizing.current = false
    void refresh()
    return () => { pendingRead.current?.abort(); request.current++ }
  }, [refresh])
  const wasAppendingRef = useRef(false)
  useEffect(() => {
    const isAppending = pendingAction === 'append'
    if (wasAppendingRef.current && !isAppending) void refresh()
    wasAppendingRef.current = isAppending
  }, [pendingAction, refresh])
  async function handleAuthorize(target: AgentGrantTarget) {
    if (!matches() || authorizing.current) return
    authorizing.current = true; setGrantingAddress(target.address); setError(null)
    try {
      await grant.issueGrant(target.address, null, kindScopeMask)
      if (!matches()) return
      setTargets(previous => previous.filter(row => row.address !== target.address))
      void queryClient.invalidateQueries({ queryKey: ['soul'] })
      onAuthorized?.()
      void refresh()
    } catch (err) { if (matches()) setError(err instanceof Error ? err.message : 'Failed to authorize agent') }
    finally { if (matches()) { authorizing.current = false; setGrantingAddress(null) } }
  }
  if (role !== 'owner' || targets.length === 0 && !error) return null

  return (
    <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3.5 py-3 text-[12px]">
      {targets.length > 0 && (
        <>
          <div className="mb-2 font-semibold text-amber-200">
            {targets.length} agent{targets.length === 1 ? '' : 's'} need {kindLabel} access on this Soul
          </div>
          <ul className="space-y-1.5">
            {targets.map((target) => (
              <li key={target.address} className="flex items-center justify-between gap-3">
                <span className="text-muted">
                  {target.displayName ?? truncateAddress(target.address)}
                  {target.displayName && (
                    <span className="ml-1 opacity-60">({truncateAddress(target.address)})</span>
                  )}
                </span>
                <button
                  type="button"
                  className="rounded border border-amber-500/40 px-2 py-1 text-amber-200 hover:bg-amber-500/10 disabled:opacity-50"
                  disabled={grantingAddress !== null}
                  onClick={() => void handleAuthorize(target)}
                >
                  {grantingAddress === target.address ? 'Authorizing…' : 'Authorize'}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {error && (
        <div className={targets.length > 0 ? 'mt-2 text-red-400' : 'text-red-400'}>
          {error}
        </div>
      )}
    </div>
  )
}
