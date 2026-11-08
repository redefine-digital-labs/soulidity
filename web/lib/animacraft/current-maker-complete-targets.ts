import { sha256 } from '@noble/hashes/sha2.js'
import { normalizeStructTag,toHex } from '@mysten/sui/utils'
import { ManagementSourceBcs,ManagementSceneBcs,ManagementScopeBcs,ManagementAdapterBcs,ManagementRepresentationBcs } from '../soulidity/management/application-bcs'
import { readCurrentCompleteInstalledComposition } from './current-maker-complete-installed-composition'
import { readCurrentCompletePublishedAssembly } from './current-maker-complete-published-assembly'
import { parseCurrentCompletePacket } from './current-maker-complete-packet'
type Installed=Awaited<ReturnType<typeof readCurrentCompleteInstalledComposition>>
function check(v:unknown,code:string):asserts v {if(!v)throw Error(`CURRENT_COMPLETE_TARGETS_${code}`)}
/** Owning state_target/native_matches and source dependency checks on values.
 * Caller must authenticate installed state and publication membership first. */
export function checkCurrentCompleteInstalledTargets(installed:Pick<Installed,'composition'|'scene'|'publishedProfiles'|'rootAdapters'|'slots'>){
 const a=installed.composition.assembly,base=toHex(sha256(ManagementSceneBcs.serialize(installed.scene).toBytes())),scopeKey=(s:typeof a.root)=>ManagementScopeBcs.serialize(s).toBase64(),hashes=installed.slots.map(s=>toHex(s.source.definition_hash))
 const bounds=(b:Installed['slots'][number]['source']['definition']['bounds'],l:Installed['slots'][number]['binding']['layout'])=>{
  check(BigInt(l.x)<=BigInt(b.max_x)&&BigInt(l.y)<=BigInt(b.max_y)&&BigInt(l.scale_ppm)>=BigInt(b.min_scale)&&BigInt(l.scale_ppm)<=BigInt(b.max_scale)&&BigInt(l.rotation_mdeg)<=BigInt(b.max_rotation)&&(l.color.length===0||b.colors.some(c=>toHex(c)===toHex(l.color))),'LAYOUT_BOUNDS')
 }
 let nativeCount=0,adapterCount=0
 for(const slot of installed.slots){const s=slot.source,d=s.definition,r=d.representation,representationScene=toHex(r.scene_hash),part=toHex(slot.part.key)
  check(d.required_styles.every(h=>hashes.includes(toHex(h)))&&d.forbidden_styles.every(h=>!hashes.includes(toHex(h))),'SOURCE_DEPENDENCIES');bounds(d.bounds,slot.binding.layout)
  const common=normalizeStructTag(s.source_type.name)===normalizeStructTag(a.root.source_type.name)&&s.protocol===a.root.protocol&&s.maker===a.root.product&&s.maker_version===a.root.version&&toHex(d.part)===part
  const isNative=common&&(representationScene===base?slot.part.scope===null&&a.base_parts.some(p=>toHex(p)===part):installed.publishedProfiles.some(p=>p.scope.product===s.product&&p.scope.version===s.version&&representationScene===toHex(sha256(ManagementSceneBcs.serialize(p.scene).toBytes()))&&p.parts.some(k=>toHex(k)===part)&&(a.base_parts.some(k=>toHex(k)===part)?slot.part.scope===null:slot.part.scope!==null&&scopeKey(slot.part.scope)===scopeKey(p.scope))))
  if(isNative){check(slot.binding.adapter===null,'NATIVE_ADAPTER');nativeCount++;const scene=representationScene===base?installed.scene:installed.publishedProfiles.find(p=>p.scope.product===s.product&&p.scope.version===s.version&&toHex(sha256(ManagementSceneBcs.serialize(p.scene).toBytes()))===representationScene)!.scene;check(toHex(r.renderer)===toHex(scene.renderer),'NATIVE_RENDERER')}
  else {const profile=slot.part.scope===null?null:installed.publishedProfiles.find(p=>scopeKey(p.scope)===scopeKey(slot.part.scope!));check(slot.part.scope===null||profile,'TARGET_PROFILE')
   const candidates=(profile?profile.adapters:installed.rootAdapters).filter(v=>toHex(v.source_hash)===toHex(sha256(ManagementSourceBcs.serialize(s).toBytes()))&&toHex(v.target_part)===part),selected=candidates.at(-1)
   check(selected&&slot.binding.adapter!==null&&ManagementAdapterBcs.serialize(selected).toBase64()===ManagementAdapterBcs.serialize(slot.binding.adapter).toBase64(),'PUBLISHED_ADAPTER')
   const scene=profile?profile.scene:installed.scene,m=selected.mapping
   check(toHex(m.representation)===toHex(sha256(ManagementRepresentationBcs.serialize(r).toBytes()))&&toHex(m.scene)===toHex(sha256(ManagementSceneBcs.serialize(scene).toBytes()))&&m.maps.length===r.fragments.length,'MAPPING_COMMITMENT');bounds(selected.bounds,slot.binding.layout);adapterCount++
  }
 }
 return{nativeCount,adapterCount}
}
/** Actual historical installed state plus actual immutable publication proof.
 * Full visual rules/rendering, nested semantic commitment and custody remain. */
export async function readCurrentCompleteTargets(input:Parameters<typeof readCurrentCompleteInstalledComposition>[0]){
 const context={...input,record:parseCurrentCompletePacket(input.record),foundation:structuredClone(input.foundation),application:structuredClone(input.application),standard:structuredClone(input.standard),visual:structuredClone(input.visual)}
 const signal=AbortSignal.any([input.signal,AbortSignal.timeout(60000)]),guard=()=>{signal.throwIfAborted();check(input.isCurrent(),'STALE')}
 guard();await readCurrentCompletePublishedAssembly({...context,signal});guard()
 const installed=await readCurrentCompleteInstalledComposition({...context,signal});guard();const counts=checkCurrentCompleteInstalledTargets(installed);guard()
 return{transactionDigest:installed.transactionDigest,...counts,originalInstalledTargetsAndDependenciesMatched:true as const,requiresQualifiedVisualRulesAndNestedSemanticProof:true as const,requiresOriginalPlayerAndIssuedCountersProof:true as const,requiresQualifiedParentCommitInvariant:true as const,requiresPayloadSealAndCurrentCustodyProof:true as const,notDeliveryReceipt:true as const,notCurrentAuthority:true as const,executionPackageVersion:'NOT_ATTESTED'as const}
}
