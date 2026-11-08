import { sha256 } from '@noble/hashes/sha2.js'
import { deriveDynamicFieldID,toHex } from '@mysten/sui/utils'
import { ManagementSceneBcs,ManagementScopeBcs,ManagementSourceBcs } from '../soulidity/management/application-bcs'
import { assertManagementAdditiveScene,assertManagementVisualColors,assertManagementVisualRules } from '../soulidity/management/application-visual-rules'
import { renderManagementVisualLayers,orderManagementVisualLayers } from '../soulidity/management/application-visual-layers'
import { readPinnedMovePackageOrigins } from '../sui/pinned-move-package'
import { moveEmptyStructBytes } from '../sui/move-empty-struct'
import { readCurrentCompleteFinalEffects } from './current-maker-complete-effects'
import { readCurrentCompleteInstalledComposition } from './current-maker-complete-installed-composition'
import { readCurrentCompleteTargets,checkCurrentCompleteInstalledTargets } from './current-maker-complete-targets'
import { parseCurrentCompletePacket } from './current-maker-complete-packet'
type Installed=Awaited<ReturnType<typeof readCurrentCompleteInstalledComposition>>
function check(v:unknown,code:string):asserts v {if(!v)throw Error(`CURRENT_COMPLETE_VISUAL_PLAN_${code}`)}
/** Exact no-variant assembly::render value projection. Requires authenticated
 * publications/installed state and proof of no ActiveVariants carrier. */
export function projectCurrentCompleteVisualPlan(installed:Pick<Installed,'composition'|'scene'|'publishedProfiles'|'profiles'|'rootAdapters'|'slots'>){
 checkCurrentCompleteInstalledTargets(installed)
 const scopeKey=(s:Installed['composition']['assembly']['root'])=>ManagementScopeBcs.serialize(s).toBase64(),hash=(s:Installed['scene'])=>toHex(sha256(ManagementSceneBcs.serialize(s).toBytes()))
 const entries=installed.slots.map(slot=>({slot,fact:{product:slot.source.product,version:slot.source.version,part:slot.part.key,item:slot.source.definition.item,style:slot.source.definition.style}}))
 const local=(scope:Installed['composition']['assembly']['root']|null)=>entries.filter(e=>e.slot.part.scope===null||scope!==null&&scopeKey(e.slot.part.scope)===scopeKey(scope)).map(e=>e.fact)
 const rootFacts=local(null);assertManagementVisualColors(installed.scene,installed.composition.colors);assertManagementVisualRules(installed.scene,rootFacts)
 for(const profile of installed.publishedProfiles){assertManagementAdditiveScene(installed.scene,profile.scene)
  const owned=entries.filter(e=>e.slot.part.scope!==null&&scopeKey(e.slot.part.scope)===scopeKey(profile.scope)||e.slot.part.scope===null&&e.slot.source.product===profile.scope.product&&e.slot.source.version===profile.scope.version).map(e=>e.fact)
  assertManagementVisualRules(profile.scene,local(profile.scope),{inheritedRules:installed.scene.rules.length,owned})
 }
 const layers=entries.flatMap(({slot,fact})=>{const r=slot.source.definition.representation,scope=slot.binding.adapter!==null?slot.part.scope:toHex(r.scene_hash)===hash(installed.scene)?null:(()=>{const profiles=installed.publishedProfiles.filter(p=>p.scope.product===slot.source.product&&p.scope.version===slot.source.version);check(profiles.length===1,'SOURCE_SCOPE');return profiles[0].scope})()
  const profile=scope===null?null:installed.publishedProfiles.find(p=>scopeKey(p.scope)===scopeKey(scope));check(scope===null||profile,'PROFILE')
  const colors=profile?(()=>{const snapshots=installed.profiles.filter(p=>scopeKey(p.scope)===scopeKey(profile.scope));check(snapshots.length===1,'PALETTE');const values=structuredClone(snapshots[0].colors);for(let i=0;i<values.length;i++){for(const color of installed.composition.colors)if(toHex(color.channel)===toHex(values[i].channel))values[i]=structuredClone(color)}return values})():installed.composition.colors
  return renderManagementVisualLayers({scene:profile?profile.scene:installed.scene,representation:r,mapping:slot.binding.adapter?.mapping??null,sourceHash:sha256(ManagementSourceBcs.serialize(slot.source).toBytes()),fact,facts:profile?local(profile.scope):rootFacts,colors,layout:slot.binding.layout})
 })
 return orderManagementVisualLayers(layers)
}
/** Original history and shared owning visual helpers; does not fetch asset
 * bytes, attest renderer qualification, or prove nested semantic/custody. */
export async function readCurrentCompleteVisualPlan(input:Parameters<typeof readCurrentCompleteInstalledComposition>[0]){
 const context={...input,record:parseCurrentCompletePacket(input.record),foundation:structuredClone(input.foundation),application:structuredClone(input.application),standard:structuredClone(input.standard),visual:structuredClone(input.visual)}
 const signal=AbortSignal.any([input.signal,AbortSignal.timeout(60000)]),guard=()=>{signal.throwIfAborted();check(input.isCurrent(),'STALE')}
 guard();await readCurrentCompleteTargets({...context,signal});guard();const installed=await readCurrentCompleteInstalledComposition({...context,signal});guard()
 const final=await readCurrentCompleteFinalEffects({...context,signal});guard();const origins=await readPinnedMovePackageOrigins(input.client,context.application,signal);guard();const origin=origins.get('character::RootVisualKey');check(origin,'ROOT_VISUAL_ORIGIN')
 const link=deriveDynamicFieldID(installed.composition.id,`0x2::dynamic_object_field::Wrapper<${origin}::character::RootVisualKey>`,moveEmptyStructBytes())
 for(const [id,change]of final.effects.V2!.changedObjects)for(const owner of [change.inputState.Exist?.[1].ObjectOwner,change.outputState.ObjectWrite?.[1].ObjectOwner])if(owner===installed.composition.id)check(id===link,'UNPLANNED_COMPOSITION_CHILD')
 const layers=projectCurrentCompleteVisualPlan(installed);guard();return{transactionDigest:installed.transactionDigest,layers,originalVisualRulesAndLayerPlanMatched:true as const,noOriginalVisualVariants:true as const,
  requiresQualifiedRendererAndAssetBytesProof:true as const,requiresOriginalPlayerIssuedCountersAndNestedSemanticProof:true as const,requiresQualifiedParentCommitInvariant:true as const,requiresPayloadSealAndCurrentCustodyProof:true as const,notDeliveryReceipt:true as const,notCurrentAuthority:true as const,executionPackageVersion:'NOT_ATTESTED'as const}
}
