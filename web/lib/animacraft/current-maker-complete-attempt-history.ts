import { bcs } from '@mysten/sui/bcs'
import { deriveDynamicFieldID, fromHex, normalizeStructTag, toBase64, toHex } from '@mysten/sui/utils'
import { readHistoricalMoveObject } from '../sui/historical-object'
import { readPinnedMovePackageOrigins } from '../sui/pinned-move-package'
import { readCurrentCompleteFinalEffects } from './current-maker-complete-effects'
import { readCurrentCompletePaymentEvents } from './current-maker-complete-payments'
import { CurrentMakerProductBcs } from './current-maker-complete-product-income'
import { parseCurrentCompletePacket } from './current-maker-complete-packet'
const Request=bcs.struct('RequestKey',{actor:bcs.Address,kind:bcs.u8(),attempt:bcs.byteVector()})
const Field=bcs.struct('Field',{id:bcs.Address,name:Request,value:bcs.Address})
function check(v:unknown,code:string):asserts v {if(!v)throw Error(`CURRENT_COMPLETE_ATTEMPT_HISTORY_${code}`)}
/** Durable Complete replay binding from original created dynamic fields only.
 * Complete does not store PrimaryReceipt in Product.payments: that table is for
 * access purchases. Counters/publication/custody remain separate obligations. */
export async function readCurrentCompleteAttemptHistory(input:Parameters<typeof readCurrentCompletePaymentEvents>[0]){
  const record=parseCurrentCompletePacket(input.record),foundation=structuredClone(input.foundation),soulId=input.soulId,{client,isCurrent}=input
  const signal=AbortSignal.any([input.signal,AbortSignal.timeout(60000)]),guard=()=>{signal.throwIfAborted();check(isCurrent(),'STALE')}
  guard();await readCurrentCompletePaymentEvents({...input,record,foundation,soulId,signal});guard()
  const final=await readCurrentCompleteFinalEffects({record,client,isCurrent,signal});guard()
  const origins=await readPinnedMovePackageOrigins(client,record.plan.target.manufacturing,signal);guard()
  const origin=origins.get('maker_catalog::Product'),requestOrigin=origins.get('maker_catalog::RequestKey');check(origin&&requestOrigin,'TYPE_ORIGINS_REQUIRED')
  const p=record.plan,productType=normalizeStructTag(`${origin}::maker_catalog::Product<${p.target.paymentCoinType}>`),requestType=`${requestOrigin}::maker_catalog::RequestKey`
  const request={actor:p.actor,kind:2,attempt:fromHex(p.attempt)},attempts=[]
  for(const product of [p.maker,...p.packs]){
    const read=async(mode:'input'|'mutated')=>{
      const object=await readHistoricalMoveObject({client,effects:final.effects,transactionDigest:record.packet.digest,objectId:product.productId,type:productType,mode,signal,maxBytes:256*1024});guard()
      const value=CurrentMakerProductBcs.parse(object.bytes)
      check(CurrentMakerProductBcs.serialize(value).toBase64()===toBase64(object.bytes)&&value.id===product.productId&&value.protocol===p.target.configId&&object.object.owner.$kind==='Shared','PRODUCT_BINDING')
      return value
    }
    const before=await read('input'),after=await read('mutated')
    check(before.attempts.id===after.attempts.id&&BigInt(after.attempts.size)===BigInt(before.attempts.size)+1n,'TABLE_INCREMENT')
    check(JSON.stringify(before.payments)===JSON.stringify(after.payments),'ACCESS_PAYMENTS_CHANGED')
    const fieldId=deriveDynamicFieldID(after.attempts.id,requestType,Request.serialize(request).toBytes())
    const object=await readHistoricalMoveObject({client,effects:final.effects,transactionDigest:record.packet.digest,objectId:fieldId,
      type:`0x2::dynamic_field::Field<${requestType},0x2::object::ID>`,mode:'created',signal,maxBytes:256});guard()
    const field=Field.parse(object.bytes)
    check(Field.serialize(field).toBase64()===toBase64(object.bytes)&&field.id===fieldId&&field.name.actor===p.actor&&field.name.kind===2
      &&toHex(field.name.attempt)===p.attempt&&field.value===soulId&&object.object.owner.ObjectOwner===after.attempts.id,'DURABLE_BINDING')
    attempts.push({productId:product.productId,tableId:after.attempts.id,fieldId,soulId,version:String(object.reference.version),digest:object.reference.digest})
  }
  guard();return{transactionDigest:record.packet.digest,attempts,originalCompleteAttemptBindingsMatched:true as const,
    requiresOriginalPublicationPolicyProof:true as const,requiresCompletionCountersProof:true as const,notDeliveryReceipt:true as const,executionPackageVersion:'NOT_ATTESTED'as const}
}
