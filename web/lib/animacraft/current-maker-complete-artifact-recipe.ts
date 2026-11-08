import { bcs } from '@mysten/sui/bcs'
import { sha256 } from '@noble/hashes/sha2.js'
import { deriveDynamicFieldID,toBase64,toHex } from '@mysten/sui/utils'
import { readHistoricalMoveObject } from '../sui/historical-object'
import { readPinnedMovePackageOrigins } from '../sui/pinned-move-package'
import { MoveEmptyStructBcs,moveEmptyStructBytes } from '../sui/move-empty-struct'
import { ManagementSourceBcs,ManagementLayoutBcs,ManagementAdapterBcs,ManagementPartBcs,ManagementColorBcs,ManagementProfileSnapshotBcs,ManagementProfileBcs,ManagementScopeBcs,ManagementSceneBcs } from '../soulidity/management/application-bcs'
import { readCurrentCompleteArtifact } from './current-maker-complete-artifact'
import { readCurrentCompleteFinalEffects } from './current-maker-complete-effects'
import { parseCurrentCompletePacket } from './current-maker-complete-packet'
const A=bcs.Address,U=bcs.u64(),V=bcs.byteVector()
export const CurrentCompleteRecipeSlotBcs=bcs.struct('RecipeSlot',{part:ManagementPartBcs,selection:bcs.option(bcs.struct('Selection',{source:ManagementSourceBcs,layout:ManagementLayoutBcs,adapter:bcs.option(ManagementAdapterBcs)}))})
export const CurrentCompleteRecipeBcs=bcs.struct('Recipe',{domain:V,schema:bcs.u16(),scene:V,colors:bcs.vector(ManagementColorBcs),profiles:bcs.vector(ManagementProfileSnapshotBcs),slots:bcs.vector(CurrentCompleteRecipeSlotBcs)})
const Link=bcs.struct('Field',{id:A,name:bcs.struct('Wrapper',{name:MoveEmptyStructBcs}),value:A})
const Profiles=bcs.struct('OriginalProfiles',{id:A,profiles:bcs.vector(ManagementProfileSnapshotBcs),profile_scenes:bcs.struct('Table',{id:A,size:U})})
const Page=bcs.struct('Field',{id:A,name:U,value:bcs.vector(CurrentCompleteRecipeSlotBcs)})
const ProfileField=bcs.struct('Field',{id:A,name:ManagementScopeBcs,value:ManagementProfileBcs})
function check(v:unknown,code:string):asserts v {if(!v)throw Error(`CURRENT_COMPLETE_ARTIFACT_RECIPE_${code}`)}
/** Actual created recipe pages + original profiles under original Artifact.
 * Hash proof is not source/visual validity or equality to intended Player
 * selections; those and Application/Soul tree custody remain separate. */
export async function readCurrentCompleteArtifactRecipe(input:Parameters<typeof readCurrentCompleteArtifact>[0]){
 const record=parseCurrentCompletePacket(input.record),application=structuredClone(input.application),{client,isCurrent}=input
 const signal=AbortSignal.any([input.signal,AbortSignal.timeout(60000)]),guard=()=>{signal.throwIfAborted();check(isCurrent(),'STALE')}
 guard();const original=await readCurrentCompleteArtifact({...input,record,application,signal});guard()
 const final=await readCurrentCompleteFinalEffects({record,client,isCurrent,signal});guard()
 const app=await readPinnedMovePackageOrigins(client,application,signal);guard()
 const pub=await readPinnedMovePackageOrigins(client,record.plan.target.publication,signal);guard()
 const model=await readPinnedMovePackageOrigins(client,record.plan.target.model,signal);guard()
 const keyOrigin=app.get('output::OriginalProfilesKey'),profilesOrigin=app.get('output::OriginalProfiles'),slotOrigin=pub.get('output_data::RecipeSlot'),scopeOrigin=model.get('assembly::Scope'),profileOrigin=model.get('assembly::Profile');check(keyOrigin&&profilesOrigin&&slotOrigin&&scopeOrigin&&profileOrigin,'TYPE_ORIGINS_REQUIRED')
 const read=async(objectId:string,type:string,owner:string)=>{const object=await readHistoricalMoveObject({client,effects:final.effects,transactionDigest:record.packet.digest,objectId,type,mode:'created',signal,maxBytes:256*1024});guard();check(object.object.owner.ObjectOwner===owner,'CHILD_OWNER');return object.bytes}
 const artifact=original.artifact,wrapper=`0x2::dynamic_object_field::Wrapper<${keyOrigin}::output::OriginalProfilesKey>`,linkId=deriveDynamicFieldID(artifact.id,wrapper,moveEmptyStructBytes())
 const linkBytes=await read(linkId,`0x2::dynamic_field::Field<${wrapper},0x2::object::ID>`,artifact.id),link=Link.parse(linkBytes)
 check(Link.serialize(link).toBase64()===toBase64(linkBytes)&&link.id===linkId,'PROFILE_LINK')
 const profileBytes=await read(link.value,`${profilesOrigin}::output::OriginalProfiles`,linkId),profiles=Profiles.parse(profileBytes)
 check(Profiles.serialize(profiles).toBase64()===toBase64(profileBytes)&&profiles.id===link.value&&profiles.profiles.length<=64&&profiles.profile_scenes.size===String(profiles.profiles.length),'PROFILE_CARRIER')
 const seen=new Set<string>(),published=[]
 for(const snapshot of profiles.profiles){
  const key=ManagementScopeBcs.serialize(snapshot.scope).toBytes(),scopeKey=toHex(key);check(!seen.has(scopeKey),'DUPLICATE_PROFILE');seen.add(scopeKey)
  const fieldId=deriveDynamicFieldID(profiles.profile_scenes.id,`${scopeOrigin}::assembly::Scope`,key),bytes=await read(fieldId,`0x2::dynamic_field::Field<${scopeOrigin}::assembly::Scope,${profileOrigin}::assembly::Profile>`,profiles.profile_scenes.id),field=ProfileField.parse(bytes),profile=field.value
  check(ProfileField.serialize(field).toBase64()===toBase64(bytes)&&field.id===fieldId&&toHex(ManagementScopeBcs.serialize(field.name).toBytes())===scopeKey&&toHex(ManagementScopeBcs.serialize(profile.scope).toBytes())===scopeKey,'PROFILE_FIELD')
  check(JSON.stringify(profile.parent)===JSON.stringify(snapshot.parent)&&toHex(sha256(ManagementSceneBcs.serialize(profile.scene).toBytes()))===toHex(snapshot.scene)
   &&JSON.stringify(profile.parts)===JSON.stringify(snapshot.parts)&&JSON.stringify(profile.adapters.map(a=>[...sha256(ManagementAdapterBcs.serialize(a).toBytes())]))===JSON.stringify(snapshot.adapters.map(a=>[...a])),'PROFILE_SNAPSHOT')
  check(snapshot.colors.length===profile.scene.channels.length&&snapshot.colors.every((c,i)=>toHex(c.channel)===toHex(profile.scene.channels[i].key)&&(c.swatch===null||profile.scene.channels[i].editable&&profile.scene.channels[i].swatches.some(w=>toHex(w.key)===toHex(c.swatch!)))),'PROFILE_COLORS')
  published.push(profile)
 }
 const store=artifact.recipe,slots=[];check(store.locations.length<=512&&BigInt(store.page_count)<=512n&&store.pages.size===store.page_count,'PAGE_COUNT')
 let lastBytes=0
 for(let page=0n;page<BigInt(store.page_count);page++){
  const fieldId=deriveDynamicFieldID(store.pages.id,'u64',U.serialize(page).toBytes()),bytes=await read(fieldId,`0x2::dynamic_field::Field<u64,vector<${slotOrigin}::output_data::RecipeSlot>>`,store.pages.id),field=Page.parse(bytes)
  check(Page.serialize(field).toBase64()===toBase64(bytes)&&field.id===fieldId&&field.name===String(page)&&field.value.length>0&&field.value.length<=32,'PAGE_FIELD')
  lastBytes=0
  for(const [i,slot]of field.value.entries()){const location=store.locations[slots.length];check(location&&location.page===String(page)&&location.index===String(i),'LOCATION');lastBytes+=CurrentCompleteRecipeSlotBcs.serialize(slot).toBytes().length;slots.push(slot)}
  check(lastBytes<=196608,'PAGE_BYTES')
 }
 check(slots.length===store.locations.length&&String(lastBytes)===store.last_bytes,'PAGES_INCOMPLETE')
 const keys=slots.map(s=>ManagementPartBcs.serialize(s.part).toBase64());check(new Set(keys).size===keys.length,'DUPLICATE_PART')
 check(artifact.colors.length===artifact.scene.channels.length&&artifact.colors.every((c,i)=>toHex(c.channel)===toHex(artifact.scene.channels[i].key)&&(c.swatch===null||artifact.scene.channels[i].editable&&artifact.scene.channels[i].swatches.some(w=>toHex(w.key)===toHex(c.swatch!)))),'ROOT_COLORS')
 for(const snapshot of profiles.profiles){const scope=ManagementScopeBcs.serialize(snapshot.scope).toBase64();check(slots.some(slot=>slot.selection!==null&&(slot.part.scope!==null&&ManagementScopeBcs.serialize(slot.part.scope).toBase64()===scope||slot.selection.source.product===snapshot.scope.product&&slot.selection.source.version===snapshot.scope.version)),'INACTIVE_PROFILE')}
 const profileOrder=profiles.profiles.map(p=>toHex(ManagementScopeBcs.serialize(p.scope).toBytes()));check(profileOrder.every((key,i)=>i===0||profileOrder[i-1]<key),'PROFILE_ORDER')
 const recipe={domain:new TextEncoder().encode('soulidity-semantic-recipe'),schema:2,scene:sha256(ManagementSceneBcs.serialize(artifact.scene).toBytes()),colors:artifact.colors,profiles:profiles.profiles,slots}
 check(toHex(sha256(CurrentCompleteRecipeBcs.serialize(recipe).toBytes()))===record.plan.recipeHash,'ORIGINAL_RECIPE_HASH')
 guard();return{transactionDigest:record.packet.digest,artifactId:artifact.id,scene:artifact.scene,colors:artifact.colors,slots,profiles:profiles.profiles,publishedProfiles:published,originalArtifactRecipeHashMatched:true as const,
  requiresPlayerSelectionAndSourceComparisonProof:true as const,requiresVisualRulesAndApplicationTreeProof:true as const,requiresBlobAndCustodyProof:true as const,notDeliveryReceipt:true as const,notCurrentAuthority:true as const,executionPackageVersion:'NOT_ATTESTED'as const}
}
