import { publicMutationCanonical } from '../../sui/public-mutation-journal'
import { toHex } from '@mysten/sui/utils'
import { readNativePublicReadPaidV2 } from './native-public-read-paid-read-v2'
import { checkNativePublicReadPaidQuoteV2 } from './native-public-read-paid-quote-check-v2'
import { commerceCheck } from './economics-read'

/** Current actual Record/Entry qualification plus contract-checked quote.
 * Reuse never invokes new-sale quote/fees. Neither result is signing approval.
 * Signed/paid/unknown records use original history, never this current adapter.
 */
export async function readContractCheckedNativePublicReadPaidPreviewV2(input:Parameters<typeof readNativePublicReadPaidV2>[0]){
 const source=input.client,signal=AbortSignal.any([input.signal,AbortSignal.timeout(60000)])
 const client={core:{getChainIdentifier:source.core.getChainIdentifier.bind(source.core),getMoveFunction:source.core.getMoveFunction?.bind(source.core),
  simulateTransaction:source.core.simulateTransaction?.bind(source.core),resolveTransactionPlugin:source.core.resolveTransactionPlugin?.bind(source.core)},ledgerService:{getObject:source.ledgerService.getObject.bind(source.ledgerService)}} as unknown as typeof source
 const saved={...input,client,signal,target:structuredClone(input.target),economics:structuredClone(input.economics)}
 const before=await readNativePublicReadPaidV2(saved)
 if(before.decision.action!=='PURCHASE_REQUIRED')return {format:'native-public-read-v2' as const,status:'NO_NEW_PURCHASE_QUOTE' as const,qualification:before,contractQuote:null,
  notSigningQualification:true as const,notDeliveryProof:true as const}
 if(!saved.economics)return {format:'native-public-read-v2' as const,status:'QUOTE_UNAVAILABLE' as const,qualification:before,contractQuote:null,
  notSigningQualification:true as const,notDeliveryProof:true as const}
 commerceCheck(before.quote&&before.coinType&&before.configSharedReference&&before.configReference,'PUBLIC_PAID_V2_PREVIEW_QUOTE_CONTEXT')
 commerceCheck(typeof client.core.getMoveFunction==='function'&&typeof client.core.simulateTransaction==='function','PUBLIC_PAID_V2_PREVIEW_QUERY_CAPABILITY')
 const checked=await checkNativePublicReadPaidQuoteV2({client,native:saved.target.native,foundation:saved.economics.foundation,sender:saved.buyer,
  intent:{format:'native-public-read-v2',nativeCallablePackageId:saved.target.native.callablePackageId,coinType:before.coinType,config:before.configSharedReference,host:before.shared.host,kind:before.kind},
  expected:before.quote,hostReference:before.hostReference,configReference:before.configReference,signal})
 const after=await readNativePublicReadPaidV2(saved)
 // Clock/preview expiry advance naturally; compare the exact quote-bearing
 // identities and permission/content snapshots instead of local timestamps.
 const identity=(v:typeof before)=>publicMutationCanonical({buyer:v.buyer,soul:v.soulId,host:v.hostId,state:v.stateId,ledger:v.ledgerId,kind:v.kind,index:v.recordIndex,
  scope:v.contentScope,namespace:v.namespace,version:v.contentVersion,owner:v.owner,generation:v.generation,entryHash:v.entryHash,action:v.decision.action,
  quote:v.quote?{hash:toHex(v.quote.hash),total:v.quote.total,ask:v.quote.ask,platformFee:v.quote.platformFee}:null,coinType:v.coinType,feeRevision:v.feeRevision,
  hostReference:v.hostReference,recordReference:v.recordReference,configReference:v.configReference,blockers:v.purchaseBlockers})
 commerceCheck(identity(before)===identity(after),'PUBLIC_PAID_V2_PREVIEW_CHANGED')
 signal.throwIfAborted()
 return {format:'native-public-read-v2' as const,status:'CONTRACT_QUOTE_CHECKED' as const,qualification:after,contractQuote:checked,
  requiresQualifiedSourceAndFormatAdoption:true as const,requiresFullPurchaseFundingAndCheckedSimulation:true as const,notSigningQualification:true as const,notDeliveryProof:true as const}
}
