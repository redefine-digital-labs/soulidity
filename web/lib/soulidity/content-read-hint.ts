import { READ_GRANT, READ_OWNER, READ_PAID, READ_PUBLIC } from '@soulidity/sdk'
import type { ChainSoulContentVersion, ChainSoulDetail } from './soul-detail-model'

/** Presentation hint only. Open re-reads actual authority before any signature;
 * cached roles and these booleans cannot grant access or prove an expiry. */
export function canAttemptContentRead(soul: ChainSoulDetail, slot: ChainSoulContentVersion, viewer: string | null) {
  if (slot.deleted || slot.purged || slot.soulOnChainId !== soul.onChainId || slot.contentOnChainId !== soul.contentOnChainId) return false
  if ((slot.readModeMask & READ_PUBLIC) !== 0) return true
  if (!viewer) return false
  if ((slot.readModeMask & READ_OWNER) !== 0 && viewer === soul.currentOwnerAddress) return true
  const scope = slot.grantScopeMask
  if (scope === 0) return false
  if ((slot.readModeMask & READ_GRANT) !== 0 && soul.activeGrants.some(g => g.granteeAddress === viewer
    && g.status === 'active' && g.ownershipEpochSnapshot === soul.currentOwnershipEpoch && (g.scopeMask & scope) === scope)) return true
  return (slot.readModeMask & READ_PAID) !== 0 && soul.paidAccessEntries.some(e => e.buyerAddress === viewer && e.kind === slot.kind
    && e.currentEpoch && e.unexpiredAtObservation && e.ownershipEpochSnapshot === soul.currentOwnershipEpoch && (e.scopeMask & scope) === scope)
}
