import { normalizeStructTag, toBase64 } from '@mysten/sui/utils'
import { CurrentMakerProductBcs, CurrentMakerProductPrimaryBcs as Primary } from './current-maker-product-bcs'
export { CurrentMakerProductBcs } from './current-maker-product-bcs'
import { readHistoricalMoveObject } from '../sui/historical-object'
import { readPinnedMovePackageOrigins } from '../sui/pinned-move-package'
import { readCurrentCompleteFinalEffects } from './current-maker-complete-effects'
import { readCurrentCompletePaymentEvents } from './current-maker-complete-payments'
import { parseCurrentCompletePacket } from './current-maker-complete-packet'
function check(v:unknown,code:string):asserts v {if(!v)throw Error(`CURRENT_COMPLETE_PRODUCT_INCOME_${code}`)}
/** Exact original Product income credit only; dynamic table values and original
 * immutable publication policy are deliberately not inferred from root sizes. */
export async function readCurrentCompleteProductIncome(input:Parameters<typeof readCurrentCompletePaymentEvents>[0]){
  const record=parseCurrentCompletePacket(input.record),foundation=structuredClone(input.foundation),{client,isCurrent}=input
  const signal=AbortSignal.any([input.signal,AbortSignal.timeout(60000)]),guard=()=>{signal.throwIfAborted();check(isCurrent(),'STALE')}
  guard();const payments=await readCurrentCompletePaymentEvents({...input,record,foundation,signal});guard()
  const final=await readCurrentCompleteFinalEffects({record,client,isCurrent,signal});guard()
  const origins=await readPinnedMovePackageOrigins(client,record.plan.target.manufacturing,signal);guard()
  const origin=origins.get('maker_catalog::Product');check(origin,'TYPE_ORIGIN_REQUIRED')
  const p=record.plan,type=normalizeStructTag(`${origin}::maker_catalog::Product<${p.target.paymentCoinType}>`),products=[]
  for(const [index,product]of [p.maker,...p.packs].entries()){
    const read=async(mode:'input'|'mutated')=>{
      const object=await readHistoricalMoveObject({client,effects:final.effects,transactionDigest:record.packet.digest,objectId:product.productId,type,mode,signal,maxBytes:256*1024});guard()
      const value=CurrentMakerProductBcs.parse(object.bytes)
      check(CurrentMakerProductBcs.serialize(value).toBase64()===toBase64(object.bytes),'CANONICAL_PRODUCT')
      check(object.object.owner.$kind==='Shared'&&value.id===product.productId&&value.protocol===p.target.configId&&value.income.root===value.id
        &&value.lifecycle===1&&BigInt(value.version)>=BigInt(product.version),'PRODUCT_BINDING')
      check(index===0?value.maker===null&&value.parent_snapshot===null&&value.parent_version==='0':value.maker===p.maker.productId&&value.parent_snapshot!==null&&BigInt(value.parent_version)>0n,'PARENT_BINDING')
      check(BigInt(value.income.collected)>=BigInt(value.income.withdrawn)&&BigInt(value.income.collected)-BigInt(value.income.withdrawn)===BigInt(value.income.funds),'LEDGER_CONSERVATION')
      return{object,value}
    }
    const before=await read('input'),after=await read('mutated'),a=before.value,b=after.value,r=payments.receipts.find(r=>r.revenue===product.productId)!
    check(Primary.serialize(a.primary).toBase64()===Primary.serialize(r.policy).toBase64(),'PRIMARY_POLICY_MISMATCH')
    check(JSON.stringify(before.object.object.owner)===JSON.stringify(after.object.object.owner),'OWNER_CHANGED')
    // Only these root fields may change in Complete. Their dynamic field values
    // (counts, attempts, issued selections and payment receipts) remain unproved.
    const allowed={income:a.income,issued:a.issued,completes:a.completes,attempts:a.attempts}
    check(CurrentMakerProductBcs.serialize({...b,...allowed}).toBase64()===CurrentMakerProductBcs.serialize(a).toBase64(),'UNEXPECTED_ROOT_CHANGE')
    for(const key of ['issued','completes','attempts','payments']as const)check(a[key].id===b[key].id,'TABLE_ID_CHANGED')
    const amount=BigInt(r.net)
    check(BigInt(b.income.funds)===BigInt(a.income.funds)+amount&&BigInt(b.income.collected)===BigInt(a.income.collected)+amount
      &&BigInt(b.income.revision)===BigInt(a.income.revision)+(amount>0n?1n:0n)&&b.income.withdrawn===a.income.withdrawn
      &&JSON.stringify(b.income.requests)===JSON.stringify(a.income.requests),'EXACT_DEPOSIT')
    products.push({productId:product.productId,amount:String(amount),before:{version:String(before.object.reference.version),digest:before.object.reference.digest,ledger:a.income},after:{version:String(after.object.reference.version),digest:after.object.reference.digest,ledger:b.income}})
  }
  guard();return{transactionDigest:record.packet.digest,products,originalProductNetIncomeMatched:true as const,requiresOriginalPublicationPolicyProof:true as const,
    requiresDynamicBusinessFieldsProof:true as const,executionPackageVersion:'NOT_ATTESTED'as const,notDeliveryReceipt:true as const}
}
