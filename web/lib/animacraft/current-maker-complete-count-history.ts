import { bcs } from '@mysten/sui/bcs'
import { deriveDynamicFieldID, normalizeStructTag, toBase64 } from '@mysten/sui/utils'
import { readHistoricalMoveObject } from '../sui/historical-object'
import { readPinnedMovePackageOrigins } from '../sui/pinned-move-package'
import { readCurrentCompleteFinalEffects } from './current-maker-complete-effects'
import { readCurrentCompleteAttemptHistory } from './current-maker-complete-attempt-history'
import { CurrentMakerProductBcs } from './current-maker-complete-product-income'
import { parseCurrentCompletePacket } from './current-maker-complete-packet'
const Key=bcs.struct('CountKey',{version:bcs.u64(),wallet:bcs.Address})
const Field=bcs.struct('Field',{id:bcs.Address,name:Key,value:bcs.u64()})
const zero=`0x${'0'.repeat(64)}`
function check(v:unknown,code:string):asserts v {if(!v)throw Error(`CURRENT_COMPLETE_COUNT_HISTORY_${code}`)}
/** Original Complete actor + aggregate counter increments, including the first
 * created field. Original publication quota/cap/price and issued selections are
 * separate proofs; these counts never grant current access or retry authority. */
export async function readCurrentCompleteCountHistory(input:Parameters<typeof readCurrentCompleteAttemptHistory>[0]){
  const record=parseCurrentCompletePacket(input.record),foundation=structuredClone(input.foundation),soulId=input.soulId,{client,isCurrent}=input
  const signal=AbortSignal.any([input.signal,AbortSignal.timeout(60000)]),guard=()=>{signal.throwIfAborted();check(isCurrent(),'STALE')}
  guard();await readCurrentCompleteAttemptHistory({...input,record,foundation,soulId,signal});guard()
  const final=await readCurrentCompleteFinalEffects({record,client,isCurrent,signal});guard()
  const origins=await readPinnedMovePackageOrigins(client,record.plan.target.manufacturing,signal);guard()
  const origin=origins.get('maker_catalog::Product'),keyOrigin=origins.get('maker_catalog::CountKey');check(origin&&keyOrigin,'TYPE_ORIGINS_REQUIRED')
  const p=record.plan,productType=normalizeStructTag(`${origin}::maker_catalog::Product<${p.target.paymentCoinType}>`),keyType=`${keyOrigin}::maker_catalog::CountKey`,counts=[]
  for(const product of [p.maker,...p.packs]){
    const root=async(mode:'input'|'mutated')=>{
      const object=await readHistoricalMoveObject({client,effects:final.effects,transactionDigest:record.packet.digest,objectId:product.productId,type:productType,mode,signal,maxBytes:256*1024});guard()
      const value=CurrentMakerProductBcs.parse(object.bytes)
      check(CurrentMakerProductBcs.serialize(value).toBase64()===toBase64(object.bytes)&&value.id===product.productId&&value.protocol===p.target.configId&&object.object.owner.$kind==='Shared','PRODUCT_BINDING');return value
    }
    const before=await root('input'),after=await root('mutated');check(before.completes.id===after.completes.id,'TABLE_ID_CHANGED')
    let created=0
    const rows=[]
    for(const wallet of [zero,p.actor]){
      const name={version:product.version,wallet},fieldId=deriveDynamicFieldID(after.completes.id,keyType,Key.serialize(name).toBytes())
      const changes=final.effects.V2!.changedObjects.filter(([id])=>id===fieldId);check(changes.length===1,'COUNTER_EFFECT_REQUIRED')
      const isCreated=changes[0][1].idOperation.$kind==='Created';if(isCreated)created++
      const read=async(mode:'input'|'created'|'mutated')=>{
        const object=await readHistoricalMoveObject({client,effects:final.effects,transactionDigest:record.packet.digest,objectId:fieldId,
          type:`0x2::dynamic_field::Field<${keyType},u64>`,mode,signal,maxBytes:128});guard()
        const value=Field.parse(object.bytes)
        check(Field.serialize(value).toBase64()===toBase64(object.bytes)&&value.id===fieldId&&value.name.version===product.version&&value.name.wallet===wallet
          &&object.object.owner.ObjectOwner===after.completes.id,'COUNTER_BINDING');return{object,value}
      }
      const old=isCreated?null:await read('input'),next=await read(isCreated?'created':'mutated'),prior=old?BigInt(old.value.value):0n
      check(BigInt(next.value.value)===prior+1n,'EXACT_INCREMENT')
      rows.push({wallet,fieldId,before:String(prior),after:next.value.value,created:isCreated,version:String(next.object.reference.version),digest:next.object.reference.digest})
    }
    check(BigInt(after.completes.size)===BigInt(before.completes.size)+BigInt(created),'TABLE_SIZE')
    check(BigInt(rows[0].after)>=BigInt(rows[1].after),'AGGREGATE_BELOW_WALLET')
    counts.push({productId:product.productId,productVersion:product.version,tableId:after.completes.id,rows})
  }
  guard();return{transactionDigest:record.packet.digest,counts,originalCompleteCountersMatched:true as const,requiresOriginalPublicationPolicyProof:true as const,
    requiresIssuedSelectionsProof:true as const,notDeliveryReceipt:true as const,notCurrentAuthority:true as const,executionPackageVersion:'NOT_ATTESTED'as const}
}
