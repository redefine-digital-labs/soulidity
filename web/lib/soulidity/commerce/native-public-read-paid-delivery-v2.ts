import { publicMutationCanonical } from '../../sui/public-mutation-journal'
import { openNativePublicPaidContentV2 } from '../native-public-paid-content-open-v2'
import { openNativePublicOwnerContentV2 } from '../native-public-owner-content-open-v2'
import { readNativePublicReadPaidV2 } from './native-public-read-paid-read-v2'
import { commerceCheck } from './economics-read'

type QualificationInput=Parameters<typeof readNativePublicReadPaidV2>[0]
type ProtectedInput=Parameters<typeof openNativePublicPaidContentV2>[0]
/** Current reusable qualification -> actual protected open only. No quote or
 * historical receipt can authorize this call. Owner reuse uses the owner
 * policy (actual Account/read-owner bit), not the paid policy's Entry check.
 * Release/source adoption must precede product enablement. No payment builder,
 * durable success, key/plaintext storage, fallback policy or automatic retry.
 */
export async function openReusableNativePublicReadContentV2(input:{qualification:QualificationInput;
 protected:Omit<ProtectedInput,'client'|'target'|'soulId'|'recordIndex'|'viewerAddress'|'signal'>},dependencies:{
 read?:typeof readNativePublicReadPaidV2;openPaid?:typeof openNativePublicPaidContentV2;openOwner?:typeof openNativePublicOwnerContentV2
}={}){
 const source=input.qualification.client
 const client={cache:source.cache,core:{getChainIdentifier:source.core.getChainIdentifier.bind(source.core),getMoveFunction:source.core.getMoveFunction?.bind(source.core),
  listOwnedObjects:source.core.listOwnedObjects?.bind(source.core),resolveTransactionPlugin:source.core.resolveTransactionPlugin?.bind(source.core)},ledgerService:{getObject:source.ledgerService.getObject.bind(source.ledgerService)}} as unknown as typeof source
 const q={...input.qualification,client,target:structuredClone(input.qualification.target),economics:structuredClone(input.qualification.economics)},p=input.protected
 const protectedInput={client:q.client,sealClient:p.sealClient,target:q.target,soulId:q.soulId,recordIndex:q.recordIndex,viewerAddress:q.buyer,expectedSourceKey:q.expectedSourceKey,
  blobBaseUrl:p.blobBaseUrl,sealConfig:structuredClone(p.sealConfig),signal:q.signal,getAddress:p.getAddress,signPersonalMessage:p.signPersonalMessage}
 const read=dependencies.read??readNativePublicReadPaidV2,openPaid=dependencies.openPaid??openNativePublicPaidContentV2,openOwner=dependencies.openOwner??openNativePublicOwnerContentV2
 const guard=()=>{q.signal.throwIfAborted();commerceCheck(protectedInput.getAddress()===q.buyer,'PUBLIC_PAID_V2_DELIVERY_WALLET_CHANGED')}
 guard();const before=await read(q);guard()
 commerceCheck(before.format==='native-public-read-v2'&&before.buyer===q.buyer&&before.soulId===q.soulId&&before.recordIndex===q.recordIndex
  &&before.kind===q.kind&&BigInt(before.contentScope)===q.requiredScope,'PUBLIC_PAID_V2_DELIVERY_SELECTION')
 const action=before.decision.action
 if(action!=='REUSE_OWNER'&&action!=='REUSE_ENTRY')return {format:'native-public-read-v2' as const,status:'CURRENT_ACCESS_NOT_REUSABLE' as const,
  qualification:before,notAuthorization:true as const,notContentDelivered:true as const}
 // Bind the permission-bearing identity and selected content, not advancing
 // Clock or unrelated Ledger revision. The actual Seal policy remains authority.
 const identity=(v:typeof before)=>publicMutationCanonical({format:v.format,buyer:v.buyer,soulId:v.soulId,hostId:v.hostId,stateId:v.stateId,ledgerId:v.ledgerId,
  kind:v.kind,index:v.recordIndex,scope:v.contentScope,namespace:v.namespace,version:v.contentVersion,owner:v.owner,generation:v.generation,
  entryHash:action==='REUSE_ENTRY'?v.entryHash:null,entryReference:action==='REUSE_ENTRY'?v.entryReference:null,
  action:v.decision.action,recordReference:v.recordReference,hostReference:v.hostReference})
 const original=identity(before)
 let opened:Awaited<ReturnType<typeof openNativePublicPaidContentV2>>|undefined
 try{
  guard();opened=await(action==='REUSE_OWNER'?openOwner(protectedInput):openPaid(protectedInput));guard()
  commerceCheck(opened.bytes instanceof Uint8Array,'PUBLIC_PAID_V2_DELIVERY_BYTES')
  const after=await read(q);guard()
  commerceCheck(identity(after)===original,'PUBLIC_PAID_V2_DELIVERY_QUALIFICATION_CHANGED')
  const content=opened;opened=undefined
  return {format:'native-public-read-v2' as const,status:'CONTENT_OPENED' as const,qualification:after,accessPath:action,content,
   requiresQualifiedSourceAndFormatAdoption:true as const,notDurablePurchaseCompletion:true as const,notMainnetAcceptance:true as const}
 }finally{opened?.bytes.fill(0)}
}
