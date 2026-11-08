import {bcs} from '@mysten/sui/bcs'
import type {SuiGrpcClient} from '@mysten/sui/grpc'
import {fromBase58,normalizeStructTag,toBase58,toBase64,toHex} from '@mysten/sui/utils'
import {parseCanonicalNativeWorkbenchTarget} from '../canonical-native-workbench'
import {publicMutationCanonical} from '../../sui/public-mutation-journal'
import {readFinalizedMutation} from '../../sui/finalized-mutation'
import {readPinnedMovePackage} from '../../sui/pinned-move-package'
import {commerceCheck,commerceId} from './economics-read'
import {assertNativeSaleGraph,parseNativeSaleGraphPlan} from './native-sale-graph'
import type {prepareNativeSalePurchase} from './native-sale-preparation'
import type {NativePublicReadPaidPreparedOriginalV2} from './native-public-read-paid-preflight-v2'
import {assertNativePublicReadPaidPacketV2} from './native-public-read-paid-packet-v2'
import {readNativePublicReadPaidHistoryV2} from './native-public-read-paid-history-v2'
import {proveNativeSaleMoney} from './native-sale-money'
import {proveNativeSaleListingExit} from './native-sale-listing-exit'
import {proveNativeSaleCustody} from './native-sale-custody'
import {proveNativeSaleCleanupTree} from './native-sale-cleanup-tree'
import {reconcileNativeSaleEffects} from './native-sale-effects'
import {NativeSoldBcs} from './native-sale-receipt'
import {NativeSalePaidBcs} from './native-sale-history'
import {PaidContentOfferBcs} from './paid-content-policy'
import {MARKET_BUY_FUNDS_ORIGINAL,marketBuyFundsOriginalReadRecord,parseMarketBuyFundsOriginal,type MarketBuyFundsOriginal} from '../../animacraft/market-buy-funds-original'
import {queryMarketBuyPurchaseFunds} from '../../animacraft/market-buy-purchase-funds'

type V1=Awaited<ReturnType<typeof prepareNativeSalePurchase>>
export type PurchaseRecoveryOriginal={kind:'native-sale-preparation.v1';value:V1}|{kind:'native-public-read-v2';value:NativePublicReadPaidPreparedOriginalV2}
 | {kind:typeof MARKET_BUY_FUNDS_ORIGINAL;value:MarketBuyFundsOriginal}
export const PURCHASE_ORIGINAL_MAX_BYTES=500000
const Events=bcs.vector(bcs.struct('Event',{package_id:bcs.Address,transaction_module:bcs.string(),sender:bcs.Address,type_:bcs.StructTag,contents:bcs.byteVector()}))
function keys(v:unknown,names:string[]){commerceCheck(v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===names.slice().sort().join(),'PURCHASE_ORIGINAL_FIELDS')}
function pin(v:any){keys(v,['originalPackageId','callablePackageId','callableDigest']);commerceCheck(commerceId(v.originalPackageId)&&commerceId(v.callablePackageId)&&typeof v.callableDigest==='string','PURCHASE_ORIGINAL_PIN');const d=fromBase58(v.callableDigest);commerceCheck(d.length===32&&toBase58(d)===v.callableDigest,'PURCHASE_ORIGINAL_PIN_DIGEST')}
function packet(v:any){keys(v,['bytes','digest','expirationEpoch','phase','signature']);commerceCheck(['PREPARED','SIGNING','SIGNED','SUCCEEDED','FAILED','CANCELLED','RETIRED'].includes(v.phase)&&(v.signature===null||typeof v.signature==='string'&&v.signature.length>0&&v.signature.length<=32768),'PURCHASE_ORIGINAL_PACKET_METADATA')}
function economics(v:any){keys(v,['chainIdentifier','foundation','configId','coinType']);pin(v.foundation);commerceCheck(v.chainIdentifier==='35834a8a'&&commerceId(v.configId)&&typeof v.coinType==='string'&&v.coinType.length<=2048&&normalizeStructTag(v.coinType)===v.coinType,'PURCHASE_ORIGINAL_ECONOMICS')}
// JSON.stringify(Uint8Array) uses consecutive numeric keys. Decode only these
// existing byte fields; never add a schema/tag or reinterpret V1 as V2.
function originalBytes(v:any,length:number){commerceCheck(v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===length&&Object.keys(v).every((k,i)=>k===String(i))&&Object.values(v).every(x=>Number.isInteger(x)&&Number(x)>=0&&Number(x)<=255),'PURCHASE_ORIGINAL_BYTES');return Uint8Array.from(Object.values(v) as number[])}
/** Existing original formats only. Validation authenticates local consistency,
 * not file provenance, signature, phase, finality, source adoption or access. */
export async function parsePurchaseRecoveryOriginal(text:string,soulId:string):Promise<PurchaseRecoveryOriginal>{
 commerceCheck(commerceId(soulId),'PURCHASE_RECOVERY_SOUL')
 commerceCheck(typeof text==='string'&&text.length>0&&text.length<=PURCHASE_ORIGINAL_MAX_BYTES&&new TextEncoder().encode(text).length<=PURCHASE_ORIGINAL_MAX_BYTES,'PURCHASE_ORIGINAL_FILE_BOUND')
 const r=JSON.parse(text)
 if(r?.schema===MARKET_BUY_FUNDS_ORIGINAL)return {kind:MARKET_BUY_FUNDS_ORIGINAL,value:parseMarketBuyFundsOriginal(r,soulId)}
 if(r?.schema==='soulidity.native-sale-preparation.v1'){
  keys(r,['schema','plan','packet','context','notSignedOrExecuted','requiresDurableJournalBeforeSigning','remaining'])
  const plan=parseNativeSaleGraphPlan(r.plan);packet(r.packet);assertNativeSaleGraph(plan,r.packet)
  keys(r.context,['target','economics','collection','reviewedSoulId','reviewedTotal']);const c=r.context,t=parseCanonicalNativeWorkbenchTarget(c.target);economics(c.economics);if(c.collection!==null)pin(c.collection)
  commerceCheck(plan.soulId===soulId&&c.reviewedSoulId===soulId,'PURCHASE_ORIGINAL_SOUL_MISMATCH')
  commerceCheck(plan.callablePackageId===t.native.callablePackageId&&plan.registryId===t.registryId&&plan.configId===t.configId&&plan.configId===c.economics.configId&&plan.coinType===c.economics.coinType&&c.reviewedTotal===plan.reviewedTotal&&r.packet.expirationEpoch===plan.expirationEpoch,'PURCHASE_ORIGINAL_CONTEXT')
  commerceCheck(r.notSignedOrExecuted===true&&r.requiresDurableJournalBeforeSigning===true&&publicMutationCanonical(r.remaining)===publicMutationCanonical(['WALLET_FINAL_PREFLIGHT','EXECUTED_QUALIFICATION','COMPLETE_ORIGINAL_SALE_PROOF','ACTUAL_POST_SALE_USE']),'PURCHASE_ORIGINAL_PREPARATION')
  return {kind:'native-sale-preparation.v1',value:r}
 }
 if(r?.format==='native-public-read-v2'){
  keys(r,['format','intent','packet','reviewedGas','context']);keys(r.context,['target','economics','originalQuotedOffer','originalOfferReference','originalReceiptContext'])
  const c=r.context,t=parseCanonicalNativeWorkbenchTarget(c.target);economics(c.economics);packet(r.packet)
  keys(c.originalReceiptContext,['soulId','ledgerId','native','content','foundation','offer']);const h=c.originalReceiptContext
  commerceCheck(h.soulId===soulId,'PURCHASE_ORIGINAL_SOUL_MISMATCH');commerceCheck(commerceId(h.ledgerId)&&t.content,'PURCHASE_ORIGINAL_RECEIPT_CONTEXT')
  for(const p of [h.native,h.content,h.foundation])pin(p)
  commerceCheck(publicMutationCanonical(h.native)===publicMutationCanonical(t.native)&&publicMutationCanonical(h.content)===publicMutationCanonical(t.content)&&publicMutationCanonical(h.foundation)===publicMutationCanonical(c.economics.foundation)&&r.intent.config.objectId===t.configId&&r.intent.registry.objectId===t.registryId&&t.configId===c.economics.configId&&r.intent.coinType===c.economics.coinType,'PURCHASE_ORIGINAL_CONTEXT')
  keys(r.intent,['format','nativeCallablePackageId','coinType','buyer','registry','config','kiosk','host','kind','quote','entryHash','feeRevision','quoteExpiryMs','attempt','paymentCoin',...(Object.hasOwn(r.intent,'recordGuard')?['recordGuard']:[])])
  commerceCheck(r.intent.nativeCallablePackageId===h.native.callablePackageId,'PURCHASE_ORIGINAL_CALLABLE')
  // Actual preparation assigns the checked quote object, including ask/fee.
  // Earlier minimal originals contain only hash/total. Preserve both exact
  // producer shapes; this is not a migration or permission to add fields.
  const fullQuote=Object.hasOwn(r.intent.quote,'ask')||Object.hasOwn(r.intent.quote,'platformFee')
  keys(r.intent.quote,fullQuote?['hash','total','ask','platformFee']:['hash','total'])
  if(fullQuote){const u64=(v:unknown)=>typeof v==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(v)&&BigInt(v)<=(1n<<64n)-1n
   commerceCheck(u64(r.intent.quote.ask)&&u64(r.intent.quote.platformFee)&&u64(r.intent.quote.total)&&r.intent.quote.ask===c.originalQuotedOffer.price&&BigInt(r.intent.quote.ask)>0n&&BigInt(r.intent.quote.ask)+BigInt(r.intent.quote.platformFee)===BigInt(r.intent.quote.total),'PURCHASE_ORIGINAL_QUOTE_COMPONENTS')}
  r.intent.quote.hash=originalBytes(r.intent.quote.hash,32);r.intent.attempt=originalBytes(r.intent.attempt,32);if(r.intent.entryHash!==null)r.intent.entryHash=originalBytes(r.intent.entryHash,32)
  commerceCheck(publicMutationCanonical(h.offer)===publicMutationCanonical(c.originalQuotedOffer)&&publicMutationCanonical(PaidContentOfferBcs.parse(PaidContentOfferBcs.serialize(h.offer).toBytes()))===publicMutationCanonical(h.offer),'PURCHASE_ORIGINAL_OFFER')
  keys(c.originalOfferReference,['objectId','version','digest']);commerceCheck(commerceId(c.originalOfferReference.objectId)&&/^[1-9][0-9]{0,19}$/.test(c.originalOfferReference.version),'PURCHASE_ORIGINAL_OFFER_REFERENCE')
  const d=fromBase58(c.originalOfferReference.digest);commerceCheck(d.length===32&&toBase58(d)===c.originalOfferReference.digest,'PURCHASE_ORIGINAL_OFFER_REFERENCE')
  await assertNativePublicReadPaidPacketV2(r.intent,r.packet,r.reviewedGas)
  return {kind:'native-public-read-v2',value:r}
 }
 throw Error('PURCHASE_ORIGINAL_UNSUPPORTED_FORMAT')
}

/** Actual original readers, read-only. No current environment pins, store,
 * signer, broadcast or automatic old-operation adoption are involved. */
export async function queryPurchaseRecoveryOriginal(input:{text:string;soulId:string;client:SuiGrpcClient;signal:AbortSignal;proveSaleSource?:true;proveSaleCustody?:true;proveSaleCleanup?:true}){
 const proveSaleSource=input.proveSaleSource===true,proveSaleCustody=input.proveSaleCustody===true,proveSaleCleanup=input.proveSaleCleanup===true
 const original=await parsePurchaseRecoveryOriginal(input.text,input.soulId),signal=AbortSignal.any([input.signal,AbortSignal.timeout(60000)]);signal.throwIfAborted()
 commerceCheck(!proveSaleSource||original.kind==='native-sale-preparation.v1','PURCHASE_ORIGINAL_SOURCE_V1_ONLY')
 commerceCheck(!proveSaleCustody||original.kind==='native-sale-preparation.v1','PURCHASE_ORIGINAL_CUSTODY_V1_ONLY')
 if(proveSaleCustody&&original.kind==='native-sale-preparation.v1')commerceCheck(original.value.context.target.custody,'PURCHASE_ORIGINAL_CUSTODY_PIN_REQUIRED')
 commerceCheck(!proveSaleCleanup||original.kind==='native-sale-preparation.v1','PURCHASE_ORIGINAL_CLEANUP_V1_ONLY')
 if(proveSaleCleanup&&original.kind==='native-sale-preparation.v1')commerceCheck(original.value.context.target.content,'PURCHASE_ORIGINAL_CLEANUP_PIN_REQUIRED')
 if(original.kind===MARKET_BUY_FUNDS_ORIGINAL)return {kind:original.kind,history:await queryMarketBuyPurchaseFunds(marketBuyFundsOriginalReadRecord(original.value),input.client,signal)}
 const source=input.client.ledgerService,client={ledgerService:{getServiceInfo:source.getServiceInfo.bind(source),getTransaction:source.getTransaction.bind(source),getCheckpoint:source.getCheckpoint.bind(source),getObject:source.getObject.bind(source)}} as unknown as SuiGrpcClient
 if(original.kind==='native-public-read-v2'){
  const v=original.value;return {kind:original.kind,history:await readNativePublicReadPaidHistoryV2({...v.context.originalReceiptContext,intent:v.intent,packet:v.packet,gas:v.reviewedGas,client,signal,proveMoney:true})}
 }
 const v=original.value,p=v.plan,native=v.context.target.native,foundation=v.context.economics.foundation
 const result=await readFinalizedMutation({client,packet:v.packet,signal,chainIdentifier:'35834a8a',genesisDigest:'4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S',errorPrefix:'PURCHASE_ORIGINAL_SALE',proveSuccess:async ctx=>{
  const money=await proveNativeSaleMoney({client,plan:p,packet:v.packet,effects:ctx.effects,native,foundation,collection:v.context.collection??undefined,checkpoint:ctx.checkpoint,standard:proveSaleSource?v.context.target.standard:undefined,sourceBinding:proveSaleSource,signal})
  const np=await readPinnedMovePackage(client,native,signal),fp=await readPinnedMovePackage(client,foundation,signal),events=Events.parse(ctx.events)
  commerceCheck(events.length<=16384&&toBase64(Events.serialize(events).toBytes())===toBase64(ctx.events),'PURCHASE_ORIGINAL_EVENTS')
  const typed=(address:string|undefined,module:string,name:string)=>events.filter(e=>e.type_.address===address&&e.type_.module===module&&e.type_.name===name)
  const sold=typed(np.origins.get('market::Sold'),'market','Sold'),paid=typed(fp.origins.get('economics::Paid'),'economics','Paid')
  commerceCheck(sold.length===1&&paid.length===1,'PURCHASE_ORIGINAL_EVENT_COUNT')
  for(const [event,pin,module] of [[sold[0],native,'market'],[paid[0],foundation,'economics']] as const)commerceCheck(event.package_id===pin.callablePackageId&&event.transaction_module===module&&event.sender===p.buyer&&event.type_.typeParams.length===0,'PURCHASE_ORIGINAL_EVENT_AUTHORITY')
  const sale=NativeSoldBcs.parse(sold[0].contents),payment=NativeSalePaidBcs.parse(paid[0].contents),q=money.quote
  commerceCheck(toBase64(NativeSoldBcs.serialize(sale).toBytes())===toBase64(sold[0].contents)&&toBase64(NativeSalePaidBcs.serialize(payment).toBytes())===toBase64(paid[0].contents)&&sale.offer===p.offerId&&sale.root===p.soulId&&sale.buyer===p.buyer&&sale.seller===money.seller&&sale.seller_kiosk===p.sellerKioskId&&sale.buyer_kiosk===p.buyerKioskId&&sale.old_generation===p.generation&&toHex(Uint8Array.from(sale.attempt))===p.attemptHex&&sale.collection===p.collectionId&&sale.collection_holder===money.collectionHolder&&(sale.collection_snapshot===null?money.collectionSnapshot===null:money.collectionSnapshot!==null&&toHex(Uint8Array.from(sale.collection_snapshot))===toHex(money.collectionSnapshot))&&sale.ask===String(q.ask)&&sale.platform===String(q.platform)&&sale.creator===String(q.creator)&&sale.collection_amount===String(q.collection)&&sale.total===String(q.total),'PURCHASE_ORIGINAL_MONEY_EVENT_BINDING')
  commerceCheck(payment.subject===p.soulId&&payment.payer===p.buyer&&payment.beneficiary===money.seller&&payment.gross===sale.total&&payment.fee===sale.platform&&toHex(payment.attempt)===p.attemptHex,'PURCHASE_ORIGINAL_PAYMENT_EVENT')
  const listingExit=await proveNativeSaleListingExit({client,plan:p,effects:ctx.effects,transactionDigest:v.packet.digest,native,signal})
  const custody=proveSaleCustody?await proveNativeSaleCustody({client,effects:ctx.effects,transactionDigest:v.packet.digest,
   expected:{root:p.soulId,seller:money.seller,buyer:p.buyer,sellerKiosk:p.sellerKioskId,buyerKiosk:p.buyerKioskId},buyerAccountId:p.buyerAccount.objectId,
   native,standard:v.context.target.standard,custody:v.context.target.custody!,signal}):null
  if(custody){commerceCheck(publicMutationCanonical(custody.buyerAccountInput)===publicMutationCanonical(p.buyerAccount),'PURCHASE_ORIGINAL_CUSTODY_ACCOUNT_REFERENCE')
   commerceCheck(custody.kioskInputs.every(k=>p.shared.some(ref=>ref.objectId===k.objectId&&ref.mutable&&ref.initialSharedVersion===k.initialSharedVersion)),'PURCHASE_ORIGINAL_CUSTODY_KIOSK_REFERENCE')}
  const cleanup=proveSaleCleanup?await proveNativeSaleCleanupTree({client,plan:p,effects:ctx.effects,events:ctx.events,transactionDigest:v.packet.digest,checkpoint:ctx.checkpoint,
   native,standard:v.context.target.standard,content:v.context.target.content!,signal}):null
  const effectsReconciliation=reconcileNativeSaleEffects({transactionDigest:v.packet.digest,soulId:p.soulId,effects:ctx.effects,money,listingExit,custody,cleanup})
  return {money,listingExit,custody,cleanup,effectsReconciliation,notCompleteSaleProof:true as const,notDeliveryProof:true as const,notCurrentAuthority:true as const}
 }})
 return {kind:original.kind,history:result.status==='SUCCEEDED'?{...result,status:'SETTLEMENT_CONFIRMED' as const}:result}
}
export type PurchaseRecoveryQuery=Awaited<ReturnType<typeof queryPurchaseRecoveryOriginal>>
