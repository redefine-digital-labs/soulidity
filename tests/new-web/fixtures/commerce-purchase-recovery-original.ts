import {normalizeStructTag} from '@mysten/sui/utils'
import {publicReadPurchaseFixture} from './commerce-purchase-recovery-v2'
import {salePurchaseHistoryFixture} from './commerce-purchase-recovery-v1'
import {aid,adigest} from './activity-transaction-evidence'

const pin=(p:any)=>({originalPackageId:p.originalPackageId,callablePackageId:p.callablePackageId,callableDigest:p.callableDigest})
export async function purchaseRecoveryFixture(kind:'v1'|'v2',variant=''){
 if(kind==='v2'){
  const x=await publicReadPurchaseFixture(variant||'money'),p=x.params
  const target={chainIdentifier:'35834a8a',standard:pin(x.standard),native:pin(p.native),content:pin(p.content),configId:p.intent.config.objectId,registryId:p.intent.registry.objectId}
  const original={format:'native-public-read-v2',intent:p.intent,packet:{...p.packet,phase:'PREPARED',signature:null},reviewedGas:p.gas,
   context:{target,economics:{chainIdentifier:'35834a8a',foundation:pin(p.foundation),configId:target.configId,coinType:normalizeStructTag(p.intent.coinType)},originalQuotedOffer:p.offer,originalOfferReference:{objectId:aid(888),version:'9',digest:adigest(888)},originalReceiptContext:{soulId:p.soulId,ledgerId:p.ledgerId,native:pin(p.native),content:pin(p.content),foundation:pin(p.foundation),offer:p.offer}}}
  // Actual preparation stores the normalized coin type captured by its reader.
  original.intent.coinType=normalizeStructTag(original.intent.coinType)
  return {text:JSON.stringify(original),original,soulId:p.soulId,client:p.client,finality:x.finality}
 }
 const x=await salePurchaseHistoryFixture(variant),p=x.params,plan=p.moneySettlement.plan
 const target={chainIdentifier:'35834a8a',standard:pin(p.native),native:pin(p.native),registryId:plan.registryId,configId:plan.configId}
 const original={schema:'soulidity.native-sale-preparation.v1',plan,packet:p.packet,context:{target,economics:{chainIdentifier:'35834a8a',foundation:pin(p.foundation),configId:plan.configId,coinType:plan.coinType},collection:p.moneySettlement.collection?pin(p.moneySettlement.collection):null,reviewedSoulId:plan.soulId,reviewedTotal:plan.reviewedTotal},notSignedOrExecuted:true,requiresDurableJournalBeforeSigning:true,remaining:['WALLET_FINAL_PREFLIGHT','EXECUTED_QUALIFICATION','COMPLETE_ORIGINAL_SALE_PROOF','ACTUAL_POST_SALE_USE']}
 return {text:JSON.stringify(original),original,soulId:plan.soulId,client:p.client,finality:x.f}
}
