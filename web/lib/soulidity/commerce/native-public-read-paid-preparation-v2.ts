import { TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromHex,toBase64 } from '@mysten/sui/utils'
import { publicMutationCanonical,type PublicMutationPacket } from '../../sui/public-mutation-journal'
import { readCommerceObject,commerceCheck,type EconomicsTarget } from './economics-read'
import { readNativePublicReadPaidV2 } from './native-public-read-paid-read-v2'
import { readContractCheckedNativePublicReadPaidPreviewV2 } from './native-public-read-paid-preview-v2'
import { readNativePublicReadPaidFundingV2,type NativePublicReadPaidFundingReferenceV2 } from './native-public-read-paid-funding-v2'
import { buildNativePublicReadPaidPurchaseV2,type NativePublicReadPaidPurchaseV2 } from './native-public-read-paid-transaction-v2'
import { verifyNativePaidContentApprovalV2Interface } from '../native-paid-content-approval-v2'
import { assertNativePublicReadPaidPacketV2 } from './native-public-read-paid-packet-v2'
import type { NativePaidReviewedGas } from './native-paid-content-packet'
type Qualification=Awaited<ReturnType<typeof readNativePublicReadPaidV2>>
/** NEW-intent single-payment-Coin V2 graph only, after the main journal excludes
 * any active old/unknown operation. Does not persist/create its own journal or
 * infer funds from wallet balances. No merges/implicit reselection are hidden.
 * Full checked simulation, qualified source and final wallet remain mandatory.
 */
export async function prepareNewNativePublicReadPaidPurchaseV2(input:{qualification:Parameters<typeof readNativePublicReadPaidV2>[0]&{economics:EconomicsTarget};reviewed:Qualification;
 paymentCoin:NativePublicReadPaidFundingReferenceV2;gas:NativePaidReviewedGas;expirationEpoch:string;quoteExpiryMs:string;attempt:Uint8Array;getBuyerAddress:()=>string|null}){
 const request=input.qualification,source=request.client,getBuyerAddress=input.getBuyerAddress,signal=AbortSignal.any([request.signal,AbortSignal.timeout(90000)])
 const saved=structuredClone({reviewed:input.reviewed,paymentCoin:input.paymentCoin,gas:input.gas,expirationEpoch:input.expirationEpoch,quoteExpiryMs:input.quoteExpiryMs,attempt:input.attempt,target:request.target,economics:request.economics})
 const client={core:{getChainIdentifier:source.core.getChainIdentifier.bind(source.core),getMoveFunction:source.core.getMoveFunction?.bind(source.core),simulateTransaction:source.core.simulateTransaction?.bind(source.core),resolveTransactionPlugin:source.core.resolveTransactionPlugin?.bind(source.core)},
 ledgerService:{getObject:source.ledgerService.getObject.bind(source.ledgerService),getEpoch:source.ledgerService.getEpoch.bind(source.ledgerService)}} as unknown as typeof source
 const q={...request,client,signal,target:saved.target,economics:saved.economics},guard=()=>{signal.throwIfAborted();commerceCheck(getBuyerAddress()===q.buyer,'PUBLIC_PAID_V2_PREPARE_WALLET_CHANGED')}
 const u64=(v:string,positive=false)=>typeof v==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(v)&&BigInt(v)<=(1n<<64n)-1n&&(!positive||BigInt(v)>0n)
 commerceCheck(u64(saved.expirationEpoch)&&u64(saved.quoteExpiryMs,true)&&u64(saved.gas.budget,true)&&u64(saved.gas.price,true),'PUBLIC_PAID_V2_PREPARE_LIMITS')
 const stable=(v:Qualification)=>{const {observedAtMs:_,...rest}=v;return publicMutationCanonical({...rest,decision:v.decision.action==='PURCHASE_REQUIRED'?{action:v.decision.action}:v.decision})}
 const epochCheck=async()=>{guard();const epoch=(await client.ledgerService.getEpoch({readMask:{paths:['epoch','reference_gas_price']}},{abort:signal})).response.epoch
  commerceCheck(typeof epoch?.epoch==='bigint'&&typeof epoch.referenceGasPrice==='bigint'&&epoch.referenceGasPrice>0n&&BigInt(saved.expirationEpoch)>=epoch.epoch&&BigInt(saved.expirationEpoch)<=epoch.epoch+1n&&BigInt(saved.gas.price)>=epoch.referenceGasPrice,'PUBLIC_PAID_V2_PREPARE_EPOCH_GAS')}
 guard();await epochCheck();const preview=await readContractCheckedNativePublicReadPaidPreviewV2(q);guard()
 commerceCheck(preview.status==='CONTRACT_QUOTE_CHECKED'&&stable(preview.qualification)===stable(saved.reviewed),'PUBLIC_PAID_V2_PREPARE_REVIEW_CHANGED')
 const before=preview.qualification
 commerceCheck(before.offer&&before.offerReference&&before.quote&&before.coinType&&before.configSharedReference&&before.feeRevision!==null&&before.namespace&&before.purchaseBlockers.length===0&&BigInt(before.observedAtMs)<=BigInt(saved.quoteExpiryMs),'PUBLIC_PAID_V2_PREPARE_BLOCKED_OR_EXPIRED')
 await verifyNativePaidContentApprovalV2Interface({client,native:saved.target.native,signal});guard()
 const registryId=q.target.registryId,registryType=preview.contractQuote.interfaces.registryType
 const registry=await readCommerceObject(client,registryId,registryType,signal)
 commerceCheck(registry.owner.Shared&&BigInt(registry.owner.Shared.initialSharedVersion)>0n&&BigInt(registry.owner.Shared.initialSharedVersion)<=BigInt(registry.version),'PUBLIC_PAID_V2_PREPARE_REGISTRY')
 const businessIds=[q.soulId,before.hostId,before.stateId,before.ledgerId,q.target.configId,registryId,before.shared.kiosk.objectId,before.shared.clock.objectId]
 const fund=(gas=false)=>readNativePublicReadPaidFundingV2({client,buyer:q.buyer,coinType:gas?'0x2::sui::SUI':before.coinType!,required:gas?saved.gas.budget:before.quote!.total,
  coins:gas?saved.gas.coins:[saved.paymentCoin],excludedIds:[...businessIds,...(gas?[saved.paymentCoin.objectId]:saved.gas.coins.map(c=>c.objectId))],getBuyerAddress,signal})
 const funding=await fund(),gasFunding=await fund(true);guard()
 const intent:NativePublicReadPaidPurchaseV2={format:'native-public-read-v2',nativeCallablePackageId:q.target.native.callablePackageId,coinType:before.coinType,buyer:q.buyer,
  registry:{objectId:registryId,initialSharedVersion:registry.owner.Shared.initialSharedVersion},config:before.configSharedReference,kiosk:before.shared.kiosk,host:before.shared.host,kind:before.kind,
  recordGuard:{index:before.recordIndex,namespace:before.namespace},quote:before.quote,entryHash:before.entryHash===null?null:fromHex(before.entryHash),feeRevision:before.feeRevision,quoteExpiryMs:saved.quoteExpiryMs,attempt:saved.attempt,paymentCoin:funding.coins[0]}
 const tx=buildNativePublicReadPaidPurchaseV2(intent);tx.setGasOwner(q.buyer);tx.setGasBudget(saved.gas.budget);tx.setGasPrice(saved.gas.price);tx.setGasPayment(saved.gas.coins);tx.setExpiration({Epoch:saved.expirationEpoch})
 const bytes=await tx.build(),packet:PublicMutationPacket={bytes:toBase64(bytes),digest:TransactionDataBuilder.getDigestFromBytes(bytes),expirationEpoch:saved.expirationEpoch,phase:'PREPARED',signature:null}
 await assertNativePublicReadPaidPacketV2(intent,packet,saved.gas)
 const final=await readContractCheckedNativePublicReadPaidPreviewV2(q);guard()
 commerceCheck(final.status==='CONTRACT_QUOTE_CHECKED'&&stable(final.qualification)===stable(before)&&BigInt(final.qualification.observedAtMs)<=BigInt(saved.quoteExpiryMs),'PUBLIC_PAID_V2_PREPARE_CHANGED')
 const finalFunding=await fund(),finalGas=await fund(true),finalRegistry=await readCommerceObject(client,registryId,registryType,signal)
 commerceCheck(publicMutationCanonical(finalFunding.coins)===publicMutationCanonical(funding.coins)&&publicMutationCanonical(finalGas.coins)===publicMutationCanonical(gasFunding.coins)&&finalRegistry.version===registry.version&&finalRegistry.digest===registry.digest,'PUBLIC_PAID_V2_PREPARE_FUNDING_REGISTRY_CHANGED')
 await epochCheck();guard()
 return {format:'native-public-read-v2' as const,intent,packet,reviewedGas:saved.gas,funding,gasFunding,qualification:final.qualification,
  context:{target:saved.target,economics:saved.economics,originalQuotedOffer:before.offer,originalOfferReference:before.offerReference,originalReceiptContext:{soulId:q.soulId,ledgerId:before.ledgerId,native:saved.target.native,content:saved.target.content!,foundation:saved.economics.foundation,offer:before.offer}},notSignedOrExecuted:true as const,requiresMainDurableJournalAndOldOperationExclusion:true as const,
  requiresQualifiedSourceAndFormatAdoption:true as const,requiresCurrentRegistrySourceAndPhysicalEconomicsQualification:true as const,requiresFullPacketCheckedSimulationAndFinalWallet:true as const,notDeliveryProof:true as const}
}
