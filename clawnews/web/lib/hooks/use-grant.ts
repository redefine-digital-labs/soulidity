'use client'

import { useState } from 'react'
import { Transaction } from '@mysten/sui/transactions'
import {
  DEFAULT_ISSUE_SCOPE_MASK,
  addIssueGrantCalls,
  addSetGrantCapacityCalls,
  assertObjectInputsExist,
  buildRevokeGrantScopeTx,
  buildRevokeGrantTx,
} from '@soulidity/sdk'
import { useWalletSign } from '@/lib/hooks/use-wallet-sign'
import { useAuth } from '@/components/providers/auth-provider'

export interface IssueGrantOptions {
  /**
   * When set, splice `grant::set_grant_capacity(state, setCapacityTo)`
   * into the PTB immediately before `issue_to_grantee`. Required when
   * `/api/souls/grant-merge-masks` returned `requiredCapacity > currentCapacity`
   * AND the grantee is new — without it `grant::issue` aborts with
   * `EGrantCapacityExceeded`. Must be ≤ `MAX_GRANT_CAPACITY` (10_000).
   * Pass `null` / `undefined` to skip the bump.
   */
  setCapacityTo?: number | null
}

/** Minimal soul shape required by the grant hook. */
export interface GrantableSoul {
  onChainId: string
  stateOnChainId: string
  activeGrants?: Array<{ granteeAddress: string }>
}

export function useGrant(soul: GrantableSoul | null) {
  const [pending, setPending] = useState<'issue' | 'revoke' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { suiWallet, signAndExecute, suiClient } = useWalletSign()
  const { getAuthHeaders } = useAuth()

  async function issueGrant(
    granteeAddress: string,
    expiresAtMs?: number | null,
    scopeMask = DEFAULT_ISSUE_SCOPE_MASK,
    options?: IssueGrantOptions,
  ) {
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
      // Compose the PTB inline so an optional capacity bump can be spliced
      // BEFORE the issue call in the same transaction — the chain executes
      // commands in order, so `grant::issue` sees the raised capacity.
      // Skipping the bump is the common case (`setCapacityTo == null`),
      // which produces the same single-call PTB as `buildIssueGrantTx`.
      const tx = new Transaction()
      if (options?.setCapacityTo != null) {
        addSetGrantCapacityCalls(tx, {
          stateObjectId: soul.stateOnChainId,
          capacity: options.setCapacityTo,
        })
      }
      addIssueGrantCalls(tx, {
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
