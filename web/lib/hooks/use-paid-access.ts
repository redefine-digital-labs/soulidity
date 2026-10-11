'use client'

import { useSoulAccessMutations, type SoulAccessSubject } from './use-soul-access-mutations'

export interface PaidAccessSoul extends SoulAccessSubject { paidAccessListOnChainId: string | null }
export interface UsePaidAccessOptions { onSynced?: () => void }

export function usePaidAccess(soul: PaidAccessSoul | null, { onSynced }: UsePaidAccessOptions = {}) {
  const access = useSoulAccessMutations(soul, onSynced)
  return {
    ...access, pending: access.pendingAction,
    revokePaidAccess: (buyerAddress: string, kind: number) => access.mutate({ action: 'paid-revoke', granteeAddress: buyerAddress, kind }),
    configurePaidAccess: (kind: number, priceAtomic: string, durationMs: string | null, exists: boolean) =>
      access.mutate({ action: exists ? 'paid-update' : 'paid-configure', kind, priceAtomic, durationMs }),
    deletePaidAccess: (kind: number) => access.mutate({ action: 'paid-delete', kind }),
    preparePurchase: (kind: number, renew: boolean) => access.prepare({ action: 'paid-purchase', kind, renew }),
  }
}
