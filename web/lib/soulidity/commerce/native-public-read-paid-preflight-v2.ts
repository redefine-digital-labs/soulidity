import {commerceCheck} from './economics-read'
import {prepareNewNativePublicReadPaidPurchaseV2} from './native-public-read-paid-preparation-v2'
import {simulateNativePublicReadPaidPurchaseV2} from './native-public-read-paid-simulation-v2'

/** NEW operation only; main owns old-operation exclusion and durable lifecycle.
 * This composes preparation and exact-byte checked simulation without replacing
 * a prepared packet, reselecting Gas, signing, broadcasting. An optional host callback may retain the exact original;
 * this function neither creates a store nor attests persistence.
 * Returning this object does not clear source/authority/effects/wallet gates.
 */
export type NativePublicReadPaidPreparedOriginalV2=Pick<Awaited<ReturnType<typeof prepareNewNativePublicReadPaidPurchaseV2>>,'format'|'intent'|'packet'|'reviewedGas'|'context'>
export async function preflightNewNativePublicReadPaidPurchaseV2(input:Parameters<typeof prepareNewNativePublicReadPaidPurchaseV2>[0]&{onPreparedOriginal?:(original:NativePublicReadPaidPreparedOriginalV2)=>Promise<void>}){
 const source=input.qualification.client,ledger=source.ledgerService,execution=source.transactionExecutionService
 const client={core:{getChainIdentifier:source.core.getChainIdentifier.bind(source.core),getMoveFunction:source.core.getMoveFunction?.bind(source.core),
  simulateTransaction:source.core.simulateTransaction?.bind(source.core),resolveTransactionPlugin:source.core.resolveTransactionPlugin?.bind(source.core)},
  ledgerService:{getObject:ledger.getObject.bind(ledger),getEpoch:ledger.getEpoch.bind(ledger),getServiceInfo:ledger.getServiceInfo.bind(ledger)},
  transactionExecutionService:{simulateTransaction:execution.simulateTransaction.bind(execution)}} as unknown as typeof source
 const {onPreparedOriginal,...values}=input,getBuyerAddress=input.getBuyerAddress,signal=AbortSignal.any([input.qualification.signal,AbortSignal.timeout(90000)]),request={...values,qualification:{...input.qualification,client,signal}}
 const guard=()=>{signal.throwIfAborted();commerceCheck(getBuyerAddress()===request.qualification.buyer,'PUBLIC_PAID_V2_PREFLIGHT_WALLET_CHANGED')}
 guard()
 const prepared=await prepareNewNativePublicReadPaidPurchaseV2(request)
 guard()
 // Host retains its existing operation lock until an in-flight write settles.
 // Callback completion does not prove durability or unknown-operation exclusion.
 if(onPreparedOriginal){await onPreparedOriginal(structuredClone({format:prepared.format,intent:prepared.intent,packet:prepared.packet,reviewedGas:prepared.reviewedGas,context:prepared.context}));guard()}
 const context=prepared.context.originalReceiptContext
 const simulation=await simulateNativePublicReadPaidPurchaseV2({...context,client,intent:prepared.intent,packet:prepared.packet,gas:prepared.reviewedGas,
  signal:request.qualification.signal,getBuyerAddress})
 guard()
 return {format:'native-public-read-v2' as const,prepared,checkedSimulation:simulation,notSignedOrExecuted:true as const,
  requiresMainDurableJournalAndOldOperationExclusion:true as const,requiresQualifiedSourceAndCurrentAuthority:true as const,
  requiresCompleteEffectsAndFinalWallet:true as const,notFinalizedReceipt:true as const,notContentDelivered:true as const}
}
