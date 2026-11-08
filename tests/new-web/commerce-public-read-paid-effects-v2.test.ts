import { expect,it } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { aid,adigest } from './fixtures/activity-transaction-evidence'
import { reconcileNativePublicReadPaidEffectsV2 } from '../../web/lib/soulidity/commerce/native-public-read-paid-effects-v2'
// Stubs exercise inventory invariants only. Real reader composition is tested
// separately with original SDK packets/full Objects/checkpoint fixtures.
function fixture(){
 const digest=adigest(1),proof={format:'native-public-read-v2',transactionDigest:digest},claim=(n:number)=>({...proof,claimedEffectIds:[aid(n)]})
 const effects=bcs.TransactionEffects.parse(bcs.TransactionEffects.serialize({V2:{transactionDigest:digest,status:{Success:true},executedEpoch:1,gasUsed:{computationCost:0,storageCost:0,storageRebate:0,nonRefundableStorageFee:0},lamportVersion:10,
 changedObjects:[1,2].map(n=>[aid(n),{inputState:{NotExist:true},outputState:{NotExist:true},idOperation:{Deleted:true}}]),unchangedConsensusObjects:[[aid(3),{ReadOnlyRoot:['9',adigest(3)]}]],gasObjectIndex:null,eventsDigest:null,dependencies:[],auxDataDigest:null}}).toBytes())
 return {transactionDigest:digest,effects,receipt:{...claim(1),observedReadOnlyIds:[aid(3)]},money:claim(2),paidPointer:proof,offerHistory:proof,kioskCustody:proof,authorizationHistory:proof,soulHistory:proof,modulePointerHistory:proof} as any
}
it('keeps source/Link/delivery incomplete even when all changed and readonly IDs are accounted for',()=>{
 expect(reconcileNativePublicReadPaidEffectsV2(fixture())).toMatchObject({status:'INCOMPLETE_SUBPROOFS',unclaimedEffectIds:[],unexplainedConsensusIds:[],missingSubproofs:expect.arrayContaining(['originalLinkObjectOwnership','qualifiedSharedAndOwnedParentCommitInvariants','originalSourceAndPhysicalEconomics','completeOriginalRecordAndProtectedDelivery']),notCompleteSubscriptionProof:true,notContentDeliveryProof:true})
})
it('reports omitted subproofs and unexplained effects instead of assuming they passed',()=>{
 const x=fixture();x.money=null;x.paidPointer=null
 expect(reconcileNativePublicReadPaidEffectsV2(x)).toMatchObject({status:'UNEXPLAINED_EFFECTS',unclaimedEffectIds:[aid(2)],missingSubproofs:expect.arrayContaining(['money','paidPointer'])})
})
it('does not classify extra readonly roots or PerEpochConfig projections as explained merely by their enum tag',()=>{
 const x=fixture();x.effects.V2.unchangedConsensusObjects.push([aid(4),{$kind:'ReadOnlyRoot',ReadOnlyRoot:['9',adigest(4)]}],[aid(5),{$kind:'PerEpochConfig',PerEpochConfig:true}])
 expect(reconcileNativePublicReadPaidEffectsV2(x)).toMatchObject({status:'UNEXPLAINED_EFFECTS',unexplainedConsensusIds:[aid(4),aid(5)]})
})
it('keeps accumulator writes explicit even if an ID was claimed',()=>{
 const x=fixture();x.effects.V2.changedObjects[1][1].outputState={$kind:'AccumulatorWriteV1'}
 expect(reconcileNativePublicReadPaidEffectsV2(x)).toMatchObject({status:'UNEXPLAINED_EFFECTS',accumulatorEffectIds:[aid(2)]})
})
it.each(['proof-digest','v1-format','unobserved','duplicate-claim','claim-alias','duplicate-effects','duplicate-readonly','readonly-overlap','unobserved-readonly','wrong-readonly-kind','failed-effects','missing-receipt'])('rejects contradictory V2 effects inventory: %s',variant=>{
 const x=fixture()
 if(variant==='proof-digest')x.offerHistory={...x.offerHistory,transactionDigest:adigest(99)}
 if(variant==='v1-format')x.receipt.format='native-v1'
 if(variant==='unobserved')x.money.claimedEffectIds.push(aid(99))
 if(variant==='duplicate-claim')x.money.claimedEffectIds.push(aid(2))
 if(variant==='claim-alias')x.money.claimedEffectIds.push(aid(1))
 if(variant==='duplicate-effects')x.effects.V2.changedObjects.push(x.effects.V2.changedObjects[0])
 if(variant==='duplicate-readonly')x.effects.V2.unchangedConsensusObjects.push(x.effects.V2.unchangedConsensusObjects[0])
 if(variant==='readonly-overlap')x.effects.V2.unchangedConsensusObjects.push([aid(1),{$kind:'ReadOnlyRoot',ReadOnlyRoot:['9',adigest(1)]}])
 if(variant==='unobserved-readonly')x.receipt.observedReadOnlyIds.push(aid(99))
 if(variant==='wrong-readonly-kind')x.effects.V2.unchangedConsensusObjects[0][1]={$kind:'PerEpochConfig',PerEpochConfig:true}
 if(variant==='failed-effects')x.effects.V2.status={$kind:'Failure'}
 if(variant==='missing-receipt')x.receipt=null
 expect(()=>reconcileNativePublicReadPaidEffectsV2(x)).toThrow()
})
