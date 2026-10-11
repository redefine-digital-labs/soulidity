'use client'

import { DEFAULT_ISSUE_SCOPE_MASK } from '@soulidity/sdk'
import { useSoulAccessMutations, type SoulAccessSubject } from './use-soul-access-mutations'

export interface GrantableSoul extends SoulAccessSubject {
  activeGrants?: Array<{ granteeAddress: string }>
}

export function useGrant(soul: GrantableSoul | null) {
  const access = useSoulAccessMutations(soul)
  function issueGrant(granteeAddress: string, expiresAtMs?: number | string | null, scopeMask = DEFAULT_ISSUE_SCOPE_MASK) {
    if (typeof expiresAtMs === 'number' && (!Number.isSafeInteger(expiresAtMs) || expiresAtMs < 0))
      throw new Error('Grant expiry must be an exact non-negative millisecond value')
    return access.mutate({ action: 'grant-issue', granteeAddress,
      expiresAtMs: expiresAtMs == null ? null : String(expiresAtMs), scopeMask })
  }
  function revokeGrant(granteeAddress?: string) {
    const address = granteeAddress ?? (soul?.activeGrants?.length === 1 ? soul.activeGrants[0].granteeAddress : null)
    if (!address) throw new Error('Choose the grantee address to revoke')
    return access.mutate({ action: 'grant-revoke', granteeAddress: address })
  }
  const revokeGrantScope = (granteeAddress: string, scopeMask: number) =>
    access.mutate({ action: 'grant-revoke-scope', granteeAddress, scopeMask })
  return { pending: access.pendingAction === null ? null : access.pendingAction === 'grant-issue' ? 'issue' as const : 'revoke' as const,
    error: access.error, identityKey: access.identityKey, issueGrant, revokeGrant, revokeGrantScope }
}
