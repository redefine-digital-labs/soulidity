import { sha256 } from '@noble/hashes/sha2.js'
import { toHex } from '@mysten/sui/utils'
import { CurrentMakerOutputPolicyBcs,readCurrentCompleteVersionHistory } from './current-maker-complete-version-history'
import { parseCurrentCompletePacket } from './current-maker-complete-packet'
function check(v:unknown,code:string):asserts v {if(!v)throw Error(`CURRENT_COMPLETE_OUTPUT_POLICY_${code}`)}
/** Original immutable output policy membership and planned inputs only. Does
 * not prove content objects, registry semantics, output artifacts or delivery. */
export async function readCurrentCompleteOutputPolicy(input:Parameters<typeof readCurrentCompleteVersionHistory>[0]){
  const record=parseCurrentCompletePacket(input.record),{isCurrent}=input,signal=AbortSignal.any([input.signal,AbortSignal.timeout(60000)])
  const guard=()=>{signal.throwIfAborted();check(isCurrent(),'STALE')}
  guard();const history=await readCurrentCompleteVersionHistory({...input,record,signal});guard()
  const p=record.plan,maker=history.versions.find(v=>v.productId===p.maker.productId)!
  const policies=maker.published.outputs.filter(policy=>toHex(policy.key)===p.outputKeyHex);check(policies.length===1,'EXACT_OUTPUT_KEY')
  const policy=policies[0],key=(v:Uint8Array)=>v.length>0&&v.length<=64
  check(toHex(sha256(CurrentMakerOutputPolicyBcs.serialize(policy).toBytes()))===p.outputPolicyHash,'POLICY_HASH')
  check(key(policy.key)&&policy.renderer.length===32&&(policy.protected?key(policy.scope):policy.scope.length===0),'POLICY_FIELDS')
  check(policy.allowed_packs.length<=64&&new Set(policy.allowed_packs.map(v=>toHex(v))).size===policy.allowed_packs.length
    &&policy.allowed_packs.every(key)&&(!policy.all_packs||policy.allowed_packs.length===0),'PACK_ALLOWLIST')
  for(const pack of p.packs){const version=history.versions.find(v=>v.productId===pack.productId)!;check(key(version.published.pack_key)
    &&(policy.all_packs||policy.allowed_packs.some(v=>toHex(v)===toHex(version.published.pack_key))),'PACK_NOT_ALLOWED')}
  check(policy.initials.every(r=>/^[a-z0-9_-]{1,32}$/.test(r.name)&&(r.kind!==0||r.name==='soul')&&(r.kind!==1||r.name==='default')),'CONTENT_NAME')
  const name=(kind:number,value:string)=>JSON.stringify([kind,value]),rules=policy.initials.map(r=>name(r.kind,r.name)),planned=p.initialContent.map(r=>name(r.kind,r.name))
  check(rules.length>=2&&rules.length<=256&&new Set(rules).size===rules.length&&policy.initials.some(r=>r.kind===0)&&policy.initials.some(r=>r.kind===1),'INITIAL_RULES')
  // Every authored rule is required by prepare_finish; append_initial_content
  // also requires membership. Registry read/download rules need another proof.
  check(planned.length===rules.length&&new Set(planned).size===planned.length&&planned.every(v=>rules.includes(v)),'EXACT_INITIAL_CONTENT')
  guard();return{transactionDigest:record.packet.digest,policy,versionFieldId:maker.fieldId,writerTransactionDigest:maker.writerTransactionDigest,
    originalOutputPolicyMatched:true as const,requiresContentRegistryAndArtifactsProof:true as const,requiresRecipeAndDeliveryProof:true as const,
    notDeliveryReceipt:true as const,notCurrentAuthority:true as const,executionPackageVersion:'NOT_ATTESTED'as const}
}
