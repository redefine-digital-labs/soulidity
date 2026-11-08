import type { bcs } from '@mysten/sui/bcs'
import { commerceCheck, commerceId } from './economics-read'
import type { proveNativeSaleMoney } from './native-sale-money'
import type { proveNativeSaleListingExit } from './native-sale-listing-exit'
import type { proveNativeSaleCustody } from './native-sale-custody'
import type { proveNativeSaleCleanupTree } from './native-sale-cleanup-tree'

type Claims = { transactionDigest: string; claimedEffectIds: string[] }
/** Compose claims only after each domain verifier has returned. This inventories
 * original object effects; it cannot qualify code, rights, events, current
 * ownership or delivery. Missing subproofs stay missing even when all observed
 * IDs happen to be accounted for by a narrower fixture/transaction.
 */
export function reconcileNativeSaleEffects(input: {
  transactionDigest: string; soulId: string; effects: ReturnType<typeof bcs.TransactionEffects.parse>;
  money: Awaited<ReturnType<typeof proveNativeSaleMoney>> | null;
  listingExit: Awaited<ReturnType<typeof proveNativeSaleListingExit>> | null;
  custody: Awaited<ReturnType<typeof proveNativeSaleCustody>> | null;
  cleanup: Awaited<ReturnType<typeof proveNativeSaleCleanupTree>> | null;
}) {
  const effects = structuredClone(input.effects), e = effects.V2
  commerceCheck(e?.status.$kind === 'Success' && e.transactionDigest === input.transactionDigest
    && e.changedObjects.length <= 4096 && new Set(e.changedObjects.map(([id]) => id)).size === e.changedObjects.length
    && new Set(e.unchangedConsensusObjects.map(([id]) => id)).size === e.unchangedConsensusObjects.length
    && e.unchangedConsensusObjects.every(([id]) => !e.changedObjects.some(([other]) => other === id)), 'SALE_EFFECTS_CONTEXT')
  const groups: Array<[string, Claims | null]> = [['money', input.money], ['listingExit', input.listingExit], ['custody', input.custody], ['cleanup', input.cleanup]]
  const observed = new Set(e.changedObjects.map(([id]) => id)), owners = new Map<string, string[]>()
  for (const [name, proof] of groups) {
    if (!proof) continue
    commerceCheck(proof.transactionDigest === input.transactionDigest && proof.claimedEffectIds.length > 0
      && proof.claimedEffectIds.length <= 4096 && new Set(proof.claimedEffectIds).size === proof.claimedEffectIds.length, 'SALE_EFFECTS_CLAIM_CONTEXT')
    for (const id of proof.claimedEffectIds) {
      commerceCheck(commerceId(id) && observed.has(id), 'SALE_EFFECTS_UNOBSERVED_CLAIM')
      const previous = owners.get(id) ?? []
      // Root Soul bytes are independently checked by custody and cleanup.
      // Every other role must have its own ID and one responsible verifier.
      commerceCheck(previous.length === 0 || id === input.soulId && previous.length === 1
        && ['custody', 'cleanup'].includes(previous[0]) && ['custody', 'cleanup'].includes(name), 'SALE_EFFECTS_CLAIM_ALIAS')
      owners.set(id, [...previous, name])
    }
  }
  const missingSubproofs = groups.filter(([, proof]) => !proof).map(([name]) => name)
  const unclaimedEffectIds = e.changedObjects.filter(([id]) => !owners.has(id)).map(([id]) => id)
  const unexplainedConsensusIds = e.unchangedConsensusObjects.filter(([, value]) => !['ReadOnlyRoot', 'PerEpochConfig'].includes(value.$kind)).map(([id]) => id)
  const accumulatorEffectIds = e.changedObjects.filter(([, value]) => value.outputState.$kind === 'AccumulatorWriteV1').map(([id]) => id)
  const unexplained = unclaimedEffectIds.length > 0 || unexplainedConsensusIds.length > 0 || accumulatorEffectIds.length > 0
  return { proof: 'native-sale-original-object-effect-inventory-only' as const, transactionDigest: input.transactionDigest,
    status: unexplained ? 'UNEXPLAINED_EFFECTS' as const : missingSubproofs.length ? 'INCOMPLETE_SUBPROOFS' as const : 'OBJECT_EFFECTS_ACCOUNTED' as const,
    missingSubproofs, unclaimedEffectIds, unexplainedConsensusIds, accumulatorEffectIds,
    claimedEffects: [...owners].map(([objectId, verifiedBy]) => ({ objectId, verifiedBy })),
    notCompleteSaleProof: true as const, notCurrentAuthority: true as const }
}
