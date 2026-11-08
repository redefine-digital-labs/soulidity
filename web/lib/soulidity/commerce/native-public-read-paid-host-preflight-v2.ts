import type {preflightNewNativePublicReadPaidPurchaseV2} from './native-public-read-paid-preflight-v2'
import {parsePurchaseRecoveryOriginal} from './purchase-recovery-original'
import {publicMutationCanonical} from '../../sui/public-mutation-journal'
import {commerceCheck} from './economics-read'
import {nativePublicReadPaidReviewIdentityV2} from './native-public-read-paid-read-v2'

export type NativePublicReadPaidHostRequestV2=Omit<Parameters<typeof preflightNewNativePublicReadPaidPurchaseV2>[0],'onPreparedOriginal'>
export type NativePublicReadPaidHostResultV2={preflight:Awaited<ReturnType<typeof preflightNewNativePublicReadPaidPurchaseV2>>;retainedText:string}
/** Main supplies this implementation. It must own actual old/unknown-operation
 * exclusion and durable original write/readback under its existing operation
 * lock. No default adapter/store/key is provided by commerce. No sign/submit. */
export type NativePublicReadPaidHostPreflightV2=(request:NativePublicReadPaidHostRequestV2)=>Promise<NativePublicReadPaidHostResultV2>

/** Validate the host/UI return boundary, not persistence or chain execution.
 * Exact retained text remains unmodified for original-format recovery. */
export async function validateNativePublicReadPaidHostResultV2(request:NativePublicReadPaidHostRequestV2,result:NativePublicReadPaidHostResultV2){
 const p=result.preflight?.prepared,q=request.qualification
 commerceCheck(result.preflight?.notSignedOrExecuted===true&&p?.format==='native-public-read-v2'&&p.packet.phase==='PREPARED'&&p.packet.signature===null,'PUBLIC_PAID_V2_HOST_UNSIGNED_RESULT')
 const original=await parsePurchaseRecoveryOriginal(result.retainedText,q.soulId)
 commerceCheck(original.kind==='native-public-read-v2','PUBLIC_PAID_V2_HOST_ORIGINAL_FORMAT')
 const canonical=publicMutationCanonical
 commerceCheck(canonical(original.value)===canonical({format:p.format,intent:p.intent,packet:p.packet,reviewedGas:p.reviewedGas,context:p.context}),'PUBLIC_PAID_V2_HOST_ORIGINAL_MISMATCH')
 commerceCheck(p.intent.buyer===q.buyer&&p.context.originalReceiptContext.soulId===q.soulId&&p.intent.kind===q.kind
  &&p.qualification.recordIndex===q.recordIndex&&p.intent.recordGuard?.index===q.recordIndex
  &&p.intent.recordGuard.namespace===p.qualification.namespace&&BigInt(p.qualification.contentScope)===q.requiredScope
  &&nativePublicReadPaidReviewIdentityV2(p.qualification)===nativePublicReadPaidReviewIdentityV2(request.reviewed)
  &&canonical(p.context.target)===canonical(q.target)&&canonical(p.context.economics)===canonical(q.economics)
  &&canonical(p.reviewedGas)===canonical(request.gas)&&p.packet.expirationEpoch===request.expirationEpoch
  &&p.intent.quoteExpiryMs===request.quoteExpiryMs&&canonical(p.intent.attempt)===canonical(request.attempt)
  &&p.intent.paymentCoin.objectId===request.paymentCoin.objectId&&p.intent.paymentCoin.version===request.paymentCoin.version&&p.intent.paymentCoin.digest===request.paymentCoin.digest,
  'PUBLIC_PAID_V2_HOST_SELECTION_MISMATCH')
 commerceCheck(result.preflight.checkedSimulation?.checksRequested==='ENABLED'&&result.preflight.checkedSimulation.transactionDigest===p.packet.digest,'PUBLIC_PAID_V2_HOST_SIMULATION_MISMATCH')
 return {text:result.retainedText,digest:p.packet.digest,total:p.intent.quote.total,coinType:p.intent.coinType,
  notSignedOrExecuted:true as const,notDeliveryProof:true as const,notPersistenceProof:true as const}
}
