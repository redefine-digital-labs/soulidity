import type { bcs } from '@mysten/sui/bcs'
import { commerceCheck, commerceId } from './economics-read'
import type {proveNativePublicReadPaidRegistryIdentityV2} from './native-public-read-paid-registry-identity-v2'
import type { proveNativePublicReadPaidLinkHistoryV2 } from './native-public-read-paid-link-history-v2'
import type { proveNativePublicReadPaidReceiptV2 } from './native-public-read-paid-receipt-v2'
import type { proveNativePublicReadPaidMoneyV2 } from './native-public-read-paid-money-v2'
import type { proveNativePublicReadPaidPointerHistoryV2 } from './native-public-read-paid-pointer-history-v2'
import type { proveNativePublicReadPaidOfferHistoryV2 } from './native-public-read-paid-offer-history-v2'
import type { proveNativePublicReadPaidCustodyHistoryV2 } from './native-public-read-paid-custody-history-v2'
import type { proveNativePublicReadPaidAuthorizationHistoryV2 } from './native-public-read-paid-authorization-history-v2'
import type { proveNativePublicReadPaidSoulHistoryV2 } from './native-public-read-paid-soul-history-v2'
import type { proveNativePublicReadPaidModulePointerHistoryV2 } from './native-public-read-paid-module-pointer-history-v2'

/** Inventory only: typed business proofs are produced by their real readers.
 * An ID claim is not itself a receipt, authority or source qualification. No
 * V1 Service/Account/State mutation assumptions or no-listing rule apply here.
 * Even full observed ID coverage cannot establish complete paid delivery.
 */
export function reconcileNativePublicReadPaidEffectsV2(input: {
  transactionDigest: string; effects: ReturnType<typeof bcs.TransactionEffects.parse>
  registryIdentity?: Awaited<ReturnType<typeof proveNativePublicReadPaidRegistryIdentityV2>> | null
  linkHistory: Awaited<ReturnType<typeof proveNativePublicReadPaidLinkHistoryV2>> | null
  receipt: Awaited<ReturnType<typeof proveNativePublicReadPaidReceiptV2>>
  money: Awaited<ReturnType<typeof proveNativePublicReadPaidMoneyV2>> | null
  paidPointer: Awaited<ReturnType<typeof proveNativePublicReadPaidPointerHistoryV2>> | null
  offerHistory: Awaited<ReturnType<typeof proveNativePublicReadPaidOfferHistoryV2>> | null
  kioskCustody: Awaited<ReturnType<typeof proveNativePublicReadPaidCustodyHistoryV2>> | null
  authorizationHistory: Awaited<ReturnType<typeof proveNativePublicReadPaidAuthorizationHistoryV2>> | null
  soulHistory: Awaited<ReturnType<typeof proveNativePublicReadPaidSoulHistoryV2>> | null
  modulePointerHistory: Awaited<ReturnType<typeof proveNativePublicReadPaidModulePointerHistoryV2>> | null
}) {
  const saved = structuredClone(input), e = saved.effects.V2
  commerceCheck(e?.status.$kind === 'Success' && e.transactionDigest === saved.transactionDigest
    && e.changedObjects.length <= 4096 && e.unchangedConsensusObjects.length <= 4096
    && new Set(e.changedObjects.map(([id])=>id)).size === e.changedObjects.length
    && new Set(e.unchangedConsensusObjects.map(([id])=>id)).size === e.unchangedConsensusObjects.length
    && e.unchangedConsensusObjects.every(([id])=>!e.changedObjects.some(([other])=>other===id)), 'PUBLIC_PAID_V2_EFFECTS_CONTEXT')
  const groups = [['receipt',saved.receipt],['money',saved.money],['paidPointer',saved.paidPointer],['offerHistory',saved.offerHistory],
    ['kioskCustody',saved.kioskCustody],['authorizationHistory',saved.authorizationHistory],['soulHistory',saved.soulHistory],['modulePointerHistory',saved.modulePointerHistory],['linkHistory',saved.linkHistory],['registryIdentity',saved.registryIdentity??null]] as const
  commerceCheck(saved.receipt, 'PUBLIC_PAID_V2_EFFECTS_RECEIPT')
  for (const [,proof] of groups) if (proof) commerceCheck(proof.format==='native-public-read-v2' && proof.transactionDigest===saved.transactionDigest, 'PUBLIC_PAID_V2_EFFECTS_PROOF_CONTEXT')
  const observed = new Set(e.changedObjects.map(([id])=>id)), claims = new Map<string,string>()
  for (const [name,proof] of [['receipt',saved.receipt],['money',saved.money]] as const) {
    if (!proof) continue
    commerceCheck(proof.claimedEffectIds.length>0 && proof.claimedEffectIds.length<=4096
      && new Set(proof.claimedEffectIds).size===proof.claimedEffectIds.length, 'PUBLIC_PAID_V2_EFFECTS_CLAIMS')
    for (const id of proof.claimedEffectIds) {
      commerceCheck(commerceId(id) && observed.has(id), 'PUBLIC_PAID_V2_EFFECTS_UNOBSERVED_CLAIM')
      commerceCheck(!claims.has(id), 'PUBLIC_PAID_V2_EFFECTS_CLAIM_ALIAS'); claims.set(id,name)
    }
  }
  const readOnlyIds = [...saved.receipt.observedReadOnlyIds,...(saved.registryIdentity?.observedReadOnlyIds??[])]
  commerceCheck(readOnlyIds.length<=4096 && new Set(readOnlyIds).size===readOnlyIds.length
    && readOnlyIds.every(id=>commerceId(id) && e.unchangedConsensusObjects.some(([other,value])=>id===other && value.$kind==='ReadOnlyRoot')), 'PUBLIC_PAID_V2_EFFECTS_READONLY_CLAIM')
  const unclaimedEffectIds=e.changedObjects.filter(([id])=>!claims.has(id)).map(([id])=>id)
  // A ReadOnlyRoot/PerEpochConfig tag alone does not prove its business role.
  const unexplainedConsensusIds=e.unchangedConsensusObjects.filter(([id])=>!readOnlyIds.includes(id)).map(([id])=>id)
  const accumulatorEffectIds=e.changedObjects.filter(([,value])=>value.outputState.$kind==='AccumulatorWriteV1').map(([id])=>id)
  const missingSubproofs=[...groups.filter(([,proof])=>!proof).map(([name])=>name),
    ...(!saved.linkHistory?['originalLinkObjectOwnership']:[]),'qualifiedSharedAndOwnedParentCommitInvariants','originalSourceAndPhysicalEconomics','originalRegistrySourceAuthorityAndEconomicFields','completeOriginalRecordAndProtectedDelivery']
  return {format:'native-public-read-v2' as const,proof:'original-v2-object-effect-inventory-only' as const,transactionDigest:saved.transactionDigest,
    status:unclaimedEffectIds.length || unexplainedConsensusIds.length || accumulatorEffectIds.length ? 'UNEXPLAINED_EFFECTS' as const:'INCOMPLETE_SUBPROOFS' as const,
    unclaimedEffectIds,unexplainedConsensusIds,accumulatorEffectIds,missingSubproofs,
    claimedEffects:[...claims].map(([objectId,verifiedBy])=>({objectId,verifiedBy})),observedReadOnlyIds:readOnlyIds,
    notCompleteSubscriptionProof:true as const,notContentDeliveryProof:true as const,notCurrentAuthority:true as const}
}
