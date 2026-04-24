'use client'

import { useState } from 'react'
import { assertObjectInputsExist } from '@/lib/soulidity/object-inputs'
import { DEFAULT_ISSUE_SCOPE_MASK } from '@/lib/soulidity/grant-scopes'
import { buildIssueGrantTx, buildRevokeGrantScopeTx, buildRevokeGrantTx } from '@/lib/soulidity/tx/grant'
import { usePrivySuiSign } from '@/lib/hooks/use-privy-sui'
import { useAuth } from '@/components/providers/auth-provider'

/** Minimal soul shape required by the grant hook. */
export interface GrantableSoul {
  onChainId: string
  stateOnChainId: string
  activeGrants?: Array<{ granteeAddress: string }>
}

export function useGrant(soul: GrantableSoul | null) {
  const [pending, setPending] = useState<'issue' | 'revoke' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { suiWallet, signAndExecute, suiClient } = usePrivySuiSign()
  const { getAuthHeaders } = useAuth()

  async function issueGrant(granteeAddress: string, expiresAtMs?: number | null, scopeMask = DEFAULT_ISSUE_SCOPE_MASK) {
    if (!soul || !suiWallet) {
      throw new Error('Sign in and load the Soul before issuing a grant')
    }

    setPending('issue')
    setError(null)
    try {
      const authHeaders = await getAuthHeaders()
      await assertObjectInputsExist(suiClient, {
        'Soul state': soul.stateOnChainId,
      })
      const tx = buildIssueGrantTx({
        stateObjectId: soul.stateOnChainId,
        granteeAddress,
        scopeMask,
        expiresAtMs: expiresAtMs ?? null,
      })
      const result = await signAndExecute(tx)
      const res = await fetch(`/api/souls/${encodeURIComponent(soul.onChainId)}/grant`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'issue', txDigest: result.digest, granteeAddress, scopeMask, expiresAtMs: expiresAtMs ?? null }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to mirror Soulidity grant')
      }
      return res.json()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Grant failed')
      throw nextError
    } finally {
      setPending(null)
    }
  }

  async function revokeGrant(granteeAddress?: string) {
    if (!soul || !suiWallet) {
      throw new Error('Sign in and load the Soul before revoking a grant')
    }

    const resolvedGranteeAddress = granteeAddress
      ?? (soul.activeGrants?.length === 1 ? soul.activeGrants[0]?.granteeAddress ?? null : null)
    if (!resolvedGranteeAddress) {
      throw new Error('granteeAddress is required when a Soul has multiple active grants')
    }

    setPending('revoke')
    setError(null)
    try {
      const authHeaders = await getAuthHeaders()
      await assertObjectInputsExist(suiClient, {
        'Soul state': soul.stateOnChainId,
      })
      const tx = buildRevokeGrantTx({
        stateObjectId: soul.stateOnChainId,
        granteeAddress: resolvedGranteeAddress,
      })
      const result = await signAndExecute(tx)
      const res = await fetch(`/api/souls/${encodeURIComponent(soul.onChainId)}/grant`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'revoke', txDigest: result.digest, granteeAddress: resolvedGranteeAddress }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to mirror Soulidity grant revoke')
      }
      return res.json()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Grant revoke failed')
      throw nextError
    } finally {
      setPending(null)
    }
  }

  async function revokeGrantScope(granteeAddress: string, revokedScopeMask: number) {
    if (!soul || !suiWallet) {
      throw new Error('Sign in and load the Soul before revoking grant scopes')
    }

    setPending('revoke')
    setError(null)
    try {
      const authHeaders = await getAuthHeaders()
      await assertObjectInputsExist(suiClient, {
        'Soul state': soul.stateOnChainId,
      })
      const tx = buildRevokeGrantScopeTx({
        stateObjectId: soul.stateOnChainId,
        granteeAddress,
        revokedScopeMask,
      })
      const result = await signAndExecute(tx)
      const res = await fetch(`/api/souls/${encodeURIComponent(soul.onChainId)}/grant`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'revoke-scope', txDigest: result.digest, granteeAddress, revokedScopeMask }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to mirror Soulidity grant scope revoke')
      }
      return res.json()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Grant scope revoke failed')
      throw nextError
    } finally {
      setPending(null)
    }
  }

  return { pending, error, issueGrant, revokeGrant, revokeGrantScope }
}
