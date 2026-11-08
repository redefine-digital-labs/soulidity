import { bcs } from '@mysten/sui/bcs'
import { sha256 } from '@noble/hashes/sha2.js'
import { deriveDynamicFieldID, fromBase58, normalizeStructTag, toBase64, toHex } from '@mysten/sui/utils'
import { CurrentMakerVersionBcs, CurrentMakerPrimaryPolicyBcs as Primary } from './current-maker-version-bcs'
export { CurrentMakerVersionBcs, CurrentMakerOutputPolicyBcs } from './current-maker-version-bcs'
import { readHistoricalMoveObject } from '../sui/historical-object'
import { readHistoricalChildThroughParent } from '../sui/historical-parent-lineage'
import { readPinnedMovePackageOrigins } from '../sui/pinned-move-package'
import { readCurrentCompleteFinalEffects } from './current-maker-complete-effects'
import { readCurrentCompletePaymentEvents } from './current-maker-complete-payments'
import { readCurrentCompleteCountHistory } from './current-maker-complete-count-history'
import { CurrentMakerProductBcs } from './current-maker-complete-product-income'
import { parseCurrentCompletePacket } from './current-maker-complete-packet'
const A=bcs.Address,U=bcs.u64()
const Field=bcs.struct('Field',{id:A,name:U,value:CurrentMakerVersionBcs})
function check(v:unknown,code:string):asserts v {if(!v)throw Error(`CURRENT_COMPLETE_VERSION_HISTORY_${code}`)}
/** Pure checks only. Caller must authenticate the full Version field against
 * the original Product input root. Hash agreement alone is not membership. */
export function checkCurrentCompletePublishedTerms(input:{bytes:Uint8Array;expectedHash:string;productId:string;configId:string;version:string;parentId:string|null;parentVersion:string;parentPolicy:Uint8Array|null;
  receipt:Awaited<ReturnType<typeof readCurrentCompletePaymentEvents>>['receipts'][number];actorCountBefore:string;aggregateBefore:string}){
  check(input.bytes.length>0&&input.bytes.length<=196608,'VERSION_SIZE')
  const v=CurrentMakerVersionBcs.parse(input.bytes),context=v.publication
  check(CurrentMakerVersionBcs.serialize(v).toBase64()===toBase64(input.bytes),'CANONICAL_VERSION')
  check(toHex(v.policy_hash)===input.expectedHash&&toHex(sha256(CurrentMakerVersionBcs.serialize({...v,policy_hash:new Uint8Array()}).toBytes()))===input.expectedHash,'POLICY_HASH')
  check(context&&context.protocol===input.configId&&context.product===input.productId&&context.version===input.version&&context.parent===input.parentId
    &&context.parent_version===input.parentVersion&&(context.parent_policy===null?input.parentPolicy===null:input.parentPolicy!==null&&toHex(context.parent_policy)===toHex(input.parentPolicy)),'PUBLICATION_CONTEXT')
  check(toHex(input.receipt.commitment)===input.expectedHash,'RECEIPT_COMMITMENT')
  check(v.primary!==null&&Primary.serialize(v.primary).toBase64()===Primary.serialize(input.receipt.policy).toBase64()&&v.beneficiary===input.receipt.beneficiary,'SETTLEMENT_TERMS')
  check(v.completion_mode<=3&&BigInt(v.completion_price)<=1000000000000n&&BigInt(v.quota)<=1000000000n&&BigInt(v.cap)<=1000000000n
    &&(v.cap==='0'||BigInt(v.quota)<=BigInt(v.cap)),'COMPLETION_DOMAIN')
  check(v.completion_mode===0?v.completion_price==='0'&&v.quota==='0':v.completion_mode===1?BigInt(v.completion_price)>0n&&v.quota==='0':v.completion_mode===2?BigInt(v.completion_price)>0n&&BigInt(v.quota)>0n:v.completion_price==='0'&&BigInt(v.quota)>0n,'COMPLETION_MODE')
  const actor=BigInt(input.actorCountBefore),all=BigInt(input.aggregateBefore)
  check(actor>=0n&&all>=actor&&(v.cap==='0'||all<BigInt(v.cap)),'CAP')
  check(v.completion_mode!==3||actor<BigInt(v.quota),'QUOTA_EXHAUSTED')
  const price=v.completion_mode===0?'0':v.completion_mode===1?v.completion_price:actor<BigInt(v.quota)?'0':v.completion_price
  check(price===input.receipt.gross,'ORIGINAL_PRICE')
  return v
}
/** Original Version via authenticated shared-parent ancestry. No current DF
 * fallback or unverified preflight simulation. Missing/bounded history throws. */
export async function readCurrentCompleteVersionHistory(input:Parameters<typeof readCurrentCompletePaymentEvents>[0]&{maxHops?:number}){
  const record=parseCurrentCompletePacket(input.record),foundation=structuredClone(input.foundation),soulId=input.soulId,maxHops=input.maxHops,{client,isCurrent}=input
  const signal=AbortSignal.any([input.signal,AbortSignal.timeout(60000)]),guard=()=>{signal.throwIfAborted();check(isCurrent(),'STALE')}
  guard();const counts=await readCurrentCompleteCountHistory({...input,record,foundation,soulId,signal});guard()
  const payments=await readCurrentCompletePaymentEvents({...input,record,foundation,soulId,signal});guard()
  const final=await readCurrentCompleteFinalEffects({record,client,isCurrent,signal});guard()
  const origins=await readPinnedMovePackageOrigins(client,record.plan.target.manufacturing,signal);guard()
  const origin=origins.get('maker_catalog::Product'),versionOrigin=origins.get('maker_catalog::Version');check(origin&&versionOrigin,'TYPE_ORIGINS_REQUIRED')
  const p=record.plan,rootType=normalizeStructTag(`${origin}::maker_catalog::Product<${p.target.paymentCoinType}>`),versions=[]
  for(const product of [p.maker,...p.packs]){
    const root=await readHistoricalMoveObject({client,effects:final.effects,transactionDigest:record.packet.digest,objectId:product.productId,type:rootType,mode:'input',signal,maxBytes:256*1024});guard()
    const decode=(bytes:Uint8Array)=>{const value=CurrentMakerProductBcs.parse(bytes);check(CurrentMakerProductBcs.serialize(value).toBase64()===toBase64(bytes)&&value.id===product.productId&&value.protocol===p.target.configId,'PRODUCT_BINDING');return value}
    const value=decode(root.bytes),fieldId=deriveDynamicFieldID(value.versions.id,'u64',U.serialize(product.version).toBytes())
    const child=await readHistoricalChildThroughParent({client,anchorEffects:final.effects,anchorTransactionDigest:record.packet.digest,anchorMode:'input',anchorCheckpoint:final.checkpoint,
      rootId:product.productId,rootType,parentUid:value.versions.id,childId:fieldId,childType:`0x2::dynamic_field::Field<u64,${versionOrigin}::maker_catalog::Version>`,
      chainIdentifier:toHex(fromBase58(p.target.chainIdentifier).slice(0,4)),genesisDigest:p.target.chainIdentifier,signal,maxHops,
      assertContainsParent:(bytes,parent)=>{check(decode(bytes).versions.id===parent,'VERSIONS_PARENT_CHANGED')}});guard()
    const field=Field.parse(child.bytes);check(Field.serialize(field).toBase64()===toBase64(child.bytes)&&field.id===fieldId&&field.name===product.version,'VERSION_FIELD')
    const rows=counts.counts.find(c=>c.productId===product.productId)!.rows,r=payments.receipts.find(r=>r.revenue===product.productId)!
    const published=checkCurrentCompletePublishedTerms({bytes:CurrentMakerVersionBcs.serialize(field.value).toBytes(),expectedHash:product.policyHash,productId:product.productId,configId:p.target.configId,version:product.version,
      parentId:value.maker,parentVersion:value.parent_version,parentPolicy:value.parent_snapshot?.policy_hash??null,receipt:r,actorCountBefore:rows[1].before,aggregateBefore:rows[0].before})
    versions.push({productId:product.productId,version:product.version,creator:value.creator,parentScope:value.parent_snapshot?.scope??null,fieldId,writerTransactionDigest:child.writerTransactionDigest,trail:child.trail,published})
  }
  guard();return{transactionDigest:record.packet.digest,versions,originalPublicationPricingMatched:true as const,requiresIssuedSelectionsProof:true as const,
    requiresOutputPolicyAndDeliveryProof:true as const,notDeliveryReceipt:true as const,notCurrentAuthority:true as const,executionPackageVersion:'NOT_ATTESTED'as const}
}
