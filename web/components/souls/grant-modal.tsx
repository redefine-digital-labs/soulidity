'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { SoulArtworkImage } from './soul-artwork-image'
import { useQueryClient } from '@tanstack/react-query'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { useGrant } from '@/lib/hooks/use-grant'
import { SoulAccessRecoveryPanel } from './soul-access-recovery'
import type { PortfolioSoul } from '@/lib/soulidity/soul-portfolio-model'

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatAddress(value: string) {
  return `${value.slice(0, 6)}\u2026${value.slice(-4)}`
}

const fallbackSoulEmojis = ['\uD83E\uDD16', '\uD83E\uDD8A', '\uD83D\uDC7E', '\uD83D\uDEF0\uFE0F', '\uD83D\uDCE1', '\u2699\uFE0F', '\uD83C\uDF38', '\uD83E\uDDFF']

function getFallbackEmoji(name: string) {
  const n = name.toLowerCase()
  if (n.includes('akira') || n.includes('kaze') || n.includes('fox') || n.includes('kitsune')) return '\uD83E\uDD8A'
  if (n.includes('alpha') || n.includes('scout') || n.includes('agent') || n.includes('cyber')) return '\uD83E\uDD16'
  if (n.includes('beast') || n.includes('dragon')) return '\uD83D\uDC7E'
  const hash = Array.from(name).reduce((acc, c) => acc + c.charCodeAt(0), 0)
  return fallbackSoulEmojis[hash % fallbackSoulEmojis.length]
}

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface GrantModalProps {
  soul: Pick<PortfolioSoul, 'onChainId' | 'stateOnChainId' | 'originalPackageId' | 'contentOnChainId' | 'paidAccessListOnChainId'
    | 'name' | 'imageUrl' | 'effectiveGrantCount' | 'activeGrantDetails'>
  open: boolean
  onClose: () => void
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function GrantModal({ soul, open, onClose }: GrantModalProps) {
  const [agentAddress, setAgentAddress] = useState('')
  const [reassignmentNotice, setReassignmentNotice] = useState<string | null>(null)
  const [replaceSelected, setReplaceSelected] = useState(false)
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null)
  const { pending, error, identityKey, issueGrant, revokeGrant } = useGrant(soul)
  const identity = useRef(identityKey)
  useLayoutEffect(() => { identity.current = identityKey }, [identityKey])
  const formScope = identityKey
  const [previousFormScope, setPreviousFormScope] = useState(formScope)
  if (previousFormScope !== formScope) { setPreviousFormScope(formScope); setReassignmentNotice(null); setSelectedAddress(null); setReplaceSelected(false); setAgentAddress('') }
  const queryClient = useQueryClient()

  const hasActiveGrant = BigInt(soul.effectiveGrantCount) > 0n && soul.activeGrantDetails.length > 0
  const activeGrant = hasActiveGrant ? soul.activeGrantDetails.find(grant => grant.granteeAddress === selectedAddress) ?? soul.activeGrantDetails[0] : null
  const { showToast } = useToast()

  async function handleAuthorize() {
    const started = identity.current
    const addr = agentAddress.trim()
    if (!addr) return
    setReassignmentNotice(null)
    try {
      // Replacement is explicit. A Soul can have multiple concurrent grantees.
      if (replaceSelected && activeGrant && activeGrant.granteeAddress !== addr) {
        await revokeGrant(activeGrant.granteeAddress)
        if (identity.current !== started) return
        try {
          await issueGrant(addr)
        } catch (issueError) {
          if (identity.current !== started) return
          setReassignmentNotice('Current grant was revoked. Issue a new grant to complete reassignment.')
          showToast('Grant reassignment failed — previous grant revoked', 'danger')
          throw issueError
        }
      } else {
        await issueGrant(addr)
      }
      if (identity.current !== started) return
      setAgentAddress('')
      void queryClient.invalidateQueries({ queryKey: ['my-souls'] })
      showToast('Agent authorized successfully', 'success')
      onClose()
    } catch {
      // error state handled by useGrant
    }
  }

  async function handleRevoke() {
    const started = identity.current
    if (!activeGrant) return
    try {
      await revokeGrant(activeGrant.granteeAddress)
      if (identity.current !== started) return
      void queryClient.invalidateQueries({ queryKey: ['my-souls'] })
      showToast('Grant revoked', 'default')
      onClose()
    } catch {
      // error state handled by useGrant
    }
  }

  return (
    <Modal open={open} onClose={onClose} maxWidth="md">
      {/* Header with Soul avatar */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border bg-[linear-gradient(135deg,var(--card2),var(--purple-deep))] text-xl">
          {soul.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <SoulArtworkImage src={soul.imageUrl} alt="" className="h-full w-full rounded-lg object-cover" />
          ) : (
            <span aria-hidden="true">{getFallbackEmoji(soul.name)}</span>
          )}
        </div>
        <div>
          <h2 className="text-lg font-semibold text-foreground">{soul.name}</h2>
          <p className="text-sm text-muted">SoulGrant Management</p>
        </div>
      </div>

      {/* Scope display */}
      <div className="rounded-xl border border-border bg-card2/60 divide-y divide-border mb-4">
        <div className="flex items-center justify-between px-4 py-2.5">
          <div className="flex items-center gap-2 text-sm">
            <span>{'\uD83E\uDE84'}</span>
            <span className="font-semibold text-teal">Skills & Docs</span>
            <span className="text-muted">&middot; read + update</span>
          </div>
          <span className="rounded-full border border-teal bg-teal/10 px-2 py-0.5 text-[10px] font-semibold text-teal">
            git versioned
          </span>
        </div>
        <div className="flex items-center justify-between px-4 py-2.5">
          <div className="flex items-center gap-2 text-sm">
            <span>{'\uD83C\uDFDB\uFE0F'}</span>
            <span className="font-semibold text-action-label">Memory</span>
            <span className="text-muted">&middot; read + append</span>
          </div>
          <span className="rounded-full border border-purple bg-purple/10 px-2 py-0.5 text-[10px] font-semibold text-action-label">
            immutable
          </span>
        </div>
      </div>

      {/* Info text */}
      <p className="text-xs text-muted mb-5">
        {'\uD83D\uDD10'} Grants are scoped to each address. Adding a grantee preserves other grants and merges its existing live scopes. Owners retain access; public and paid read access are separate.
      </p>

      {/* Current Grant section */}
      <div className="mb-5">
        <p className="text-[10px] font-bold text-muted uppercase tracking-[0.1em] mb-2">
          Selected Grant ({soul.activeGrantDetails.length} shown)
        </p>
        {soul.activeGrantDetails.length > 1 && <select aria-label="Select active grant" value={activeGrant?.granteeAddress ?? ''}
          onChange={e => setSelectedAddress(e.target.value)} className="mb-2 w-full rounded border border-border bg-card2 p-2 text-xs">
          {soul.activeGrantDetails.map(grant => <option key={grant.granteeAddress} value={grant.granteeAddress}>{grant.granteeAddress}</option>)}
        </select>}
        {activeGrant ? (
          <div className="flex items-center justify-between rounded-xl border border-border bg-card2/60 px-4 py-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="h-2 w-2 shrink-0 rounded-full bg-success" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">Agent Authorized</p>
                <p className="truncate text-xs font-mono text-muted">{formatAddress(activeGrant.granteeAddress)}</p>
              </div>
            </div>
            <Button
              variant="danger"
              size="sm"
              disabled={pending !== null}
              onClick={handleRevoke}
            >
              {pending === 'revoke' ? 'Revoking\u2026' : 'Revoke'}
            </Button>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card2/60 px-4 py-3">
            <p className="text-sm font-semibold text-foreground">No agent authorized</p>
            <p className="text-xs text-muted">&mdash;</p>
          </div>
        )}
      </div>

      {/* Authorize section */}
      <div className="mb-5">
        <p className="text-[10px] font-bold text-muted uppercase tracking-[0.1em] mb-2">
          Authorize or Update an Agent
        </p>
        <label className="block text-[10px] font-bold text-muted uppercase tracking-[0.1em] mb-1.5">
          Grantee Sui Address
        </label>
        <input
          type="text"
          value={agentAddress}
          onChange={(e) => {
            setAgentAddress(e.target.value)
            setReassignmentNotice(null)
          }}
          disabled={!!pending}
          placeholder="0x…"
          className="w-full rounded-lg border border-border bg-card2 px-3 py-2.5 text-sm text-foreground placeholder:text-muted/50 outline-none focus:border-teal transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        />
        <p className="mt-1.5 text-[11px] text-muted">
          {replaceSelected && activeGrant
            ? 'Replacing revokes the selected grant first. If the next action fails, use the recovery record below; the previous grant is not automatically restored.'
            : 'The agent must have a valid Sui identity.'}
        </p>
        {activeGrant && <label className="mt-2 flex gap-2 text-xs text-muted"><input type="checkbox" checked={replaceSelected}
          disabled={pending !== null} onChange={e => setReplaceSelected(e.target.checked)} />Replace the selected grant first (two transactions)</label>}
      </div>

      {/* Authorize button */}
      <Button
        variant="teal"
        full
        disabled={!agentAddress.trim() || !!pending}
        onClick={handleAuthorize}
      >
        {pending === 'revoke' ? 'Revoking\u2026' : pending === 'issue' ? 'Authorizing\u2026' : 'Authorize Agent \u2192'}
      </Button>

      {/* Error */}
      {error && (
        <p className="mt-3 text-xs text-danger">{error}</p>
      )}

      {reassignmentNotice && (
        <p className="mt-3 text-xs text-gold/90">{reassignmentNotice}</p>
      )}

      <SoulAccessRecoveryPanel soul={soul} />

      {/* Warning */}
      <p className="mt-4 text-[11px] text-gold/80">
        {'\u26A0\uFE0F'} If you transfer or sell this Soul, the grant is automatically voided. The new owner starts with no active grant.
      </p>
    </Modal>
  )
}
