import { bcs, TypeTagSerializer } from '@mysten/sui/bcs'
import { normalizeStructTag, toHex } from '@mysten/sui/utils'
import { readPinnedMovePackageOrigins, type PinnedMovePackage } from '../sui/pinned-move-package'
import { readCurrentCompleteFinalEffects } from './current-maker-complete-effects'
import { currentMakerId, validateCurrentMakerPackage } from './current-maker-transactions'
const Policy = bcs.struct('PrimaryPolicy', { schema:bcs.u16(),config:bcs.Address,snapshot_revision:bcs.u64(),platform:bcs.Address,bps:bcs.u16(),complete_fee:bcs.u64() })
export const CurrentCompletePrimaryReceiptBcs = bcs.struct('PrimaryReceipt', { policy:Policy,operational_revision:bcs.u64(),subject:bcs.Address,commitment:bcs.byteVector(),actor:bcs.Address,attempt:bcs.byteVector(),expiry:bcs.u64(),gross:bcs.u64(),primary_amount:bcs.u64(),fixed:bcs.u64(),total:bcs.u64(),beneficiary:bcs.Address,net:bcs.u64(),revenue:bcs.option(bcs.Address) })
const Settled = bcs.struct('PrimarySettled', { receipt:CurrentCompletePrimaryReceiptBcs })
function check(v:unknown,code:string):asserts v {if(!v)throw Error(`CURRENT_COMPLETE_PAYMENT_${code}`)}
/** Exact original PrimarySettled event subproof. Source/version policy snapshots,
 * input Coin and Config/Product ledger effects MUST still be proved separately.
 * Matching these events never constitutes full settlement or delivery. */
export async function readCurrentCompletePaymentEvents(input: Parameters<typeof readCurrentCompleteFinalEffects>[0]&{
  foundation:PinnedMovePackage;soulId:string
}) {
  const {client,isCurrent}=input,signal=AbortSignal.any([input.signal,AbortSignal.timeout(60000)])
  const foundation=structuredClone(input.foundation),soulId=input.soulId,record=structuredClone(input.record)
  const guard=()=>{signal.throwIfAborted();check(isCurrent(),'STALE')}
  guard();validateCurrentMakerPackage(foundation);currentMakerId(soulId)
  const final=await readCurrentCompleteFinalEffects({client,record,signal,isCurrent});guard()
  check(final.executionStatus==='SUCCESS','SUCCESS_REQUIRED')
  const origins=await readPinnedMovePackageOrigins(client,foundation,signal);guard()
  const origin=origins.get('economics::PrimarySettled');check(origin,'TYPE_ORIGIN_REQUIRED')
  const type=normalizeStructTag(`${origin}::economics::PrimarySettled`),p=record.plan
  const products=[p.maker,...p.packs],seen=new Set<string>(),receipts:ReturnType<typeof Settled.parse>['receipt'][]=[]
  let total=0n,platformTotal=0n,netTotal=0n,platform:string|null=null
  for(const event of final.events){
    if(normalizeStructTag(TypeTagSerializer.tagToString({struct:event.type_}))!==type)continue
    check(event.package_id===p.target.runtime.callablePackageId&&event.transaction_module==='runtime'&&event.sender===p.actor,'EXECUTION_CONTEXT')
    const decoded=Settled.parse(event.contents),r=decoded.receipt
    check(toHex(Settled.serialize(decoded).toBytes())===toHex(event.contents),'CANONICAL_EVENT')
    check(r.revenue!==null,'REVENUE_REQUIRED')
    const index=products.findIndex(product=>product.productId===r.revenue),product=products[index]
    check(product&&!seen.has(product.productId),'PRODUCT_OR_DUPLICATE')
    const policy=r.policy,gross=BigInt(r.gross),cut=gross*BigInt(policy.bps)/10000n,fixed=index===0?BigInt(policy.complete_fee):0n
    check(policy.schema===1&&policy.config===p.target.configId&&policy.bps<=10000&&BigInt(policy.platform)!==0n&&BigInt(r.beneficiary)!==0n,'POLICY_FIELDS')
    check(r.subject===soulId&&r.actor===p.actor&&r.operational_revision===p.feeRevision&&r.expiry===p.expiryMs
      &&toHex(r.commitment)===product.policyHash&&toHex(r.attempt)===p.attempt,'ORIGINAL_SCOPE')
    check((gross===0n||cut<gross)&&(gross===0n||policy.bps===0||cut>0n)&&BigInt(r.primary_amount)===cut
      &&BigInt(r.fixed)===fixed&&BigInt(r.net)===gross-cut&&BigInt(r.total)===gross+fixed&&r.total===product.payment.amount,'AMOUNTS')
    check(platform===null||platform===policy.platform,'PLATFORM_MISMATCH');platform=policy.platform
    seen.add(product.productId);total+=BigInt(r.total);platformTotal+=cut+fixed;netTotal+=BigInt(r.net);receipts.push(r)
  }
  check(seen.size===products.length&&total===platformTotal+netTotal,'MISSING_OR_UNBALANCED')
  return {transactionDigest:final.transactionDigest,checkpoint:final.checkpoint,soulId,receipts,total:String(total),platformTotal:String(platformTotal),productNetTotal:String(netTotal),
    primarySettlementEventsMatched:true as const,requiresOriginalPublicationPolicyProof:true as const,requiresInputCoinAndLedgerProof:true as const,
    executionPackageVersion:'NOT_ATTESTED' as const,notDeliveryReceipt:true as const}
}
