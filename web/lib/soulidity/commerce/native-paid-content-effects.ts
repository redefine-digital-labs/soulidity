import type { bcs } from '@mysten/sui/bcs'
import { commerceCheck, commerceId } from './economics-read'
import type { proveNativePaidContentReceipt } from './native-paid-content-receipt'
import type { proveNativePaidContentMoney } from './native-paid-content-money'
import type { proveNativePaidContentServiceHistory } from './native-paid-content-service-history'
import type { proveNativePaidContentTreeHistory } from './native-paid-content-tree-history'

/** Inventory authenticated subproof claims, never substitute ID coverage for
 * business or delivery completion. Kiosk/remaining module fields and source,
 * semantic, opening-delegation qualification are explicit unresolved domains.
 */
export function reconcileNativePaidContentEffects(input: {
  transactionDigest: string; effects: ReturnType<typeof bcs.TransactionEffects.parse>;
  receipt: Awaited<ReturnType<typeof proveNativePaidContentReceipt>>;
  money: Awaited<ReturnType<typeof proveNativePaidContentMoney>> | null;
  service: Awaited<ReturnType<typeof proveNativePaidContentServiceHistory>> | null;
  tree: Awaited<ReturnType<typeof proveNativePaidContentTreeHistory>> | null;
}) {
  const effects = structuredClone(input.effects), e = effects.V2
  commerceCheck(e?.status.$kind === 'Success' && e.transactionDigest === input.transactionDigest
    && e.changedObjects.length <= 4096 && e.unchangedConsensusObjects.length <= 4096
    && new Set(e.changedObjects.map(([id]) => id)).size === e.changedObjects.length
    && new Set(e.unchangedConsensusObjects.map(([id]) => id)).size === e.unchangedConsensusObjects.length
    && e.unchangedConsensusObjects.every(([id]) => !e.changedObjects.some(([other]) => other === id)), 'PAID_EFFECTS_CONTEXT')
  const groups = [['receipt', input.receipt], ['money', input.money], ['service', input.service], ['tree', input.tree]] as const
  const observed = new Set(e.changedObjects.map(([id]) => id)), owners = new Map<string, string>()
  for (const [name, proof] of groups) {
    if (!proof) continue
    commerceCheck(proof.transactionDigest === input.transactionDigest && proof.claimedEffectIds.length > 0
      && proof.claimedEffectIds.length <= 4096 && new Set(proof.claimedEffectIds).size === proof.claimedEffectIds.length, 'PAID_EFFECTS_CLAIM_CONTEXT')
    for (const id of proof.claimedEffectIds) {
      commerceCheck(commerceId(id) && observed.has(id), 'PAID_EFFECTS_UNOBSERVED_CLAIM')
      commerceCheck(!owners.has(id), 'PAID_EFFECTS_CLAIM_ALIAS')
      owners.set(id, name)
    }
  }
  const missingSubproofs = [...groups.filter(([, proof]) => !proof).map(([name]) => name),
    ...(input.tree?.kioskCustody ? ['remainingModuleFields', 'originalNoListing'] : ['remainingModuleFieldsAndKioskCustody']), 'semanticAndSourceQualification', 'serviceOpeningDelegation']
  const unclaimedEffectIds = e.changedObjects.filter(([id]) => !owners.has(id)).map(([id]) => id)
  const unexplainedConsensusIds = e.unchangedConsensusObjects.filter(([, value]) => !['ReadOnlyRoot', 'PerEpochConfig'].includes(value.$kind)).map(([id]) => id)
  const accumulatorEffectIds = e.changedObjects.filter(([, value]) => value.outputState.$kind === 'AccumulatorWriteV1').map(([id]) => id)
  return { proof: 'native-paid-original-object-effect-inventory-only' as const, transactionDigest: input.transactionDigest,
    status: unclaimedEffectIds.length || unexplainedConsensusIds.length || accumulatorEffectIds.length
      ? 'UNEXPLAINED_EFFECTS' as const : 'INCOMPLETE_SUBPROOFS' as const,
    missingSubproofs, unclaimedEffectIds, unexplainedConsensusIds, accumulatorEffectIds,
    claimedEffects: [...owners].map(([objectId, verifiedBy]) => ({ objectId, verifiedBy })),
    notCompleteSubscriptionProof: true as const, notContentDeliveryProof: true as const, notCurrentAuthority: true as const }
}
