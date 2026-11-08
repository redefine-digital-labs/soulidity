import { bcs,type BcsType } from '@mysten/sui/bcs'
import { deriveDynamicFieldID,fromHex,normalizeStructTag,toBase64 } from '@mysten/sui/utils'
import { readHistoricalMoveObject } from '../sui/historical-object'
import { MoveEmptyStructBcs,moveEmptyStructBytes } from '../sui/move-empty-struct'
import { readPinnedMovePackageOrigins,type PinnedMovePackage } from '../sui/pinned-move-package'
import { ManagementCompositionBcs,ManagementRootVisualBcs,ManagementBoundPartsBcs,ManagementItemBcs,ManagementStoredBindingBcs,ManagementPartBcs,ManagementScopeBcs,ManagementProfileBcs,ManagementColorBcs,ManagementSourceBcs,ManagementLayoutBcs,ManagementAdapterBcs,ManagementSceneBcs } from '../soulidity/management/application-bcs'
import { readCurrentCompleteArtifactRecipe } from './current-maker-complete-artifact-recipe'
import { readCurrentCompleteApplicationTree } from './current-maker-complete-application-tree'
import { readCurrentCompleteFinalEffects } from './current-maker-complete-effects'
import { parseCurrentCompletePacket } from './current-maker-complete-packet'
const A=bcs.Address,U=bcs.u64(),V=bcs.byteVector(),Link=bcs.struct('Field',{id:A,name:bcs.struct('Wrapper',{name:MoveEmptyStructBcs}),value:A})
function check(v:unknown,code:string):asserts v {if(!v)throw Error(`CURRENT_COMPLETE_INSTALLED_COMPOSITION_${code}`)}
/** Actual created slots and all three rights-storage modes matched to original
 * Artifact recipe. Metadata is not current Item control, a licensed Source
 * receipt, Player equality or full Application semantic commitment. */
export async function readCurrentCompleteInstalledComposition(input:Parameters<typeof readCurrentCompleteApplicationTree>[0]&{visual:PinnedMovePackage}){
 const record=parseCurrentCompletePacket(input.record),{client,isCurrent}=input,context={...input,record,application:structuredClone(input.application),standard:structuredClone(input.standard),foundation:structuredClone(input.foundation),visual:structuredClone(input.visual),applicationId:input.applicationId,artifactId:input.artifactId,soulId:input.soulId}
 const signal=AbortSignal.any([input.signal,AbortSignal.timeout(60000)]),guard=()=>{signal.throwIfAborted();check(isCurrent(),'STALE')}
 guard();await readCurrentCompleteApplicationTree({...context,signal});guard()
 const recipe=await readCurrentCompleteArtifactRecipe({...context,signal});guard()
 const final=await readCurrentCompleteFinalEffects({record,client,isCurrent,signal});guard()
 const app=await readPinnedMovePackageOrigins(client,context.application,signal);guard()
 const model=await readPinnedMovePackageOrigins(client,record.plan.target.model,signal);guard()
 const manufacturing=await readPinnedMovePackageOrigins(client,record.plan.target.manufacturing,signal);guard()
 const productOrigin=manufacturing.get('maker_catalog::Product');check(productOrigin,'PRODUCT_ORIGIN_REQUIRED')
 const visual=await readPinnedMovePackageOrigins(client,context.visual,signal);guard()
 const type=(origins:Map<string,string>,module:string,name:string)=>{const origin=origins.get(`${module}::${name}`);check(origin,'TYPE_ORIGIN_REQUIRED');return`${origin}::${module}::${name}`}
 const at=(name:string)=>type(app,'character',name),mt=(name:string)=>type(model,'assembly',name),partType=mt('PartKey'),scopeType=mt('Scope'),sourceType=type(model,'policy','Source')
 const expected=new Map<string,Set<string>>()
 const read=async(id:string,type:string,owner:string)=>{const object=await readHistoricalMoveObject({client,effects:final.effects,transactionDigest:record.packet.digest,objectId:id,type,mode:'created',signal,maxBytes:256*1024});guard();check(object.object.owner.ObjectOwner===owner,'OWNER');expected.get(owner)?.add(id);return object.bytes}
 const decode=<T>(codec:BcsType<T,any>,bytes:Uint8Array)=>{const value=codec.parse(bytes);check(codec.serialize(value).toBase64()===toBase64(bytes),'CANONICAL');return value}
 const carrier=async<T>(parent:string,key:string,name:string,codec:BcsType<T,any>)=>{const wrapper=`0x2::dynamic_object_field::Wrapper<${at(key)}>`,linkId=deriveDynamicFieldID(parent,wrapper,moveEmptyStructBytes()),link=decode(Link,await read(linkId,`0x2::dynamic_field::Field<${wrapper},0x2::object::ID>`,parent));check(link.id===linkId,'LINK');const value=decode(codec,await read(link.value,at(name),linkId));check((value as {id:string}).id===link.value,'CARRIER_ID');return value}
 const composition=await carrier(context.applicationId,'CompositionKey','Composition',ManagementCompositionBcs),rootVisual=await carrier(composition.id,'RootVisualKey','RootVisual',ManagementRootVisualBcs),bound=await carrier(context.applicationId,'BoundPartsKey','BoundParts',ManagementBoundPartsBcs)
 const p=record.plan,a=composition.assembly
 const roles=[context.applicationId,context.artifactId,context.soulId,composition.id,rootVisual.id,bound.id,composition.slots.id,composition.references.pages.id,bound.records.pages.id,a.profiles.id,a.palettes.id,composition.enhancements.id];check(new Set(roles).size===roles.length,'TABLE_ALIAS')
 check(a.root.protocol===p.target.configId&&a.root.product===p.maker.productId&&a.root.version===p.maker.version&&toBase64(a.root.policy)===toBase64(fromHex(p.maker.policyHash))&&normalizeStructTag(a.root.source_type.name)===normalizeStructTag(`${productOrigin}::maker_catalog::Product<${p.target.paymentCoinType}>`),'ROOT_SCOPE')
 check(ManagementSceneBcs.serialize(rootVisual.scene).toBase64()===ManagementSceneBcs.serialize(recipe.scene).toBase64()&&JSON.stringify(composition.colors)===JSON.stringify(recipe.colors),'ROOT_SCENE_COLORS')
 const active=recipe.slots.filter(slot=>slot.selection!==null)
 check(composition.slots.size===String(active.length)&&composition.enhancements.size==='0'&&a.parts.length===recipe.slots.length&&a.parts.every((part,i)=>ManagementPartBcs.serialize(part).toBase64()===ManagementPartBcs.serialize(recipe.slots[i].part).toBase64()),'SLOTS')
 expected.set(composition.slots.id,new Set())
 const pages=async(store:typeof composition.references)=>{
  check(store.locations.length<=512&&BigInt(store.page_count)<=512n&&store.pages.size===store.page_count,'PAGE_COUNT');expected.set(store.pages.id,new Set())
  const values:ReturnType<typeof ManagementSourceBcs.parse>[]=[],Field=bcs.struct('Field',{id:A,name:U,value:bcs.vector(ManagementSourceBcs)});let bytes=0
  for(let page=0n;page<BigInt(store.page_count);page++){const id=deriveDynamicFieldID(store.pages.id,'u64',U.serialize(page).toBytes()),field=decode(Field,await read(id,`0x2::dynamic_field::Field<u64,vector<${sourceType}>>`,store.pages.id));check(field.id===id&&field.name===String(page)&&field.value.length>0&&field.value.length<=32,'PAGE_FIELD');bytes=0
   for(const [i,source]of field.value.entries()){const location=store.locations[values.length];check(location&&location.page===String(page)&&location.index===String(i),'LOCATION');bytes+=ManagementSourceBcs.serialize(source).toBytes().length;values.push(source)}check(bytes<=196608,'PAGE_BYTES')}
  check(values.length===store.locations.length&&String(bytes)===store.last_bytes,'PAGE_SIZE');return values
 }
 const references=await pages(composition.references),bounds=await pages(bound.records),usedReferences=new Set<number>(),usedBounds=new Set<number>(),items=new Set<string>(),slots=[]
 check(new Set(references.map(s=>ManagementSourceBcs.serialize(s).toBase64())).size===references.length&&new Set(bounds.map(s=>ManagementSourceBcs.serialize(s).toBase64())).size===bounds.length,'DUPLICATE_INVENTORY')
 expected.set(a.profiles.id,new Set());expected.set(a.palettes.id,new Set());expected.set(composition.enhancements.id,new Set())
 for(const slot of active){const value=slot.selection!,key=ManagementPartBcs.serialize(slot.part).toBytes(),id=deriveDynamicFieldID(composition.slots.id,partType,key),Field=bcs.struct('Field',{id:A,name:ManagementPartBcs,value:ManagementStoredBindingBcs}),field=decode(Field,await read(id,`0x2::dynamic_field::Field<${partType},${at('StoredBinding')}>`,composition.slots.id)),binding=field.value
  check(field.id===id&&ManagementPartBcs.serialize(field.name).toBase64()===toBase64(key)&&ManagementLayoutBcs.serialize(binding.layout).toBase64()===ManagementLayoutBcs.serialize(value.layout).toBase64()
   &&(binding.adapter===null?value.adapter===null:value.adapter!==null&&ManagementAdapterBcs.serialize(binding.adapter).toBase64()===ManagementAdapterBcs.serialize(value.adapter).toBase64()),'BINDING')
  const mode=value.source.definition.rights;let source:typeof value.source
  if(mode===0){check(binding.reference!==null&&binding.item===null&&binding.bound===null,'REFERENCE_MODE');const index=Number(binding.reference);check(Number.isSafeInteger(index)&&index<references.length&&!usedReferences.has(index),'REFERENCE_INDEX');usedReferences.add(index);source=references[index]}
  else if(mode===1){check(binding.bound!==null&&binding.item===null&&binding.reference===null,'BOUND_MODE');const index=Number(binding.bound);check(Number.isSafeInteger(index)&&index<bounds.length&&!usedBounds.has(index),'BOUND_INDEX');usedBounds.add(index);source=bounds[index]}
  else{check(mode===2&&binding.item!==null&&binding.bound===null&&binding.reference===null&&!items.has(binding.item),'ITEM_MODE');items.add(binding.item);const wrapper=`0x2::dynamic_object_field::Wrapper<${at('ItemKey')}>`,linkId=deriveDynamicFieldID(context.applicationId,wrapper,A.serialize(binding.item).toBytes()),IL=bcs.struct('Field',{id:A,name:bcs.struct('Wrapper',{name:bcs.struct('ItemKey',{id:A})}),value:A}),link=decode(IL,await read(linkId,`0x2::dynamic_field::Field<${wrapper},0x2::object::ID>`,context.applicationId));check(link.id===linkId&&link.name.name.id===binding.item&&link.value===binding.item,'ITEM_LINK');const item=decode(ManagementItemBcs,await read(binding.item,type(model,'components','Item'),linkId));check(item.id===binding.item,'ITEM_ID');source=item.source}
  check(ManagementSourceBcs.serialize(source).toBase64()===ManagementSourceBcs.serialize(value.source).toBase64(),'INSTALLED_SOURCE');slots.push({part:slot.part,binding,source})
 }
 check(usedReferences.size===references.length&&usedBounds.size===bounds.length,'UNUSED_INVENTORY')
 check(a.scopes.length===recipe.profiles.length&&a.profiles.size===String(a.scopes.length)&&a.palettes.size===String(a.scopes.length),'PROFILE_COUNT')
 for(const [i,snapshot]of recipe.profiles.entries()){const key=ManagementScopeBcs.serialize(snapshot.scope).toBytes();check(ManagementScopeBcs.serialize(a.scopes[i]).toBase64()===toBase64(key),'SCOPE_ORDER')
  const id=deriveDynamicFieldID(a.profiles.id,scopeType,key),PF=bcs.struct('Field',{id:A,name:ManagementScopeBcs,value:ManagementProfileBcs}),field=decode(PF,await read(id,`0x2::dynamic_field::Field<${scopeType},${mt('Profile')}>`,a.profiles.id));check(field.id===id&&ManagementScopeBcs.serialize(field.name).toBase64()===toBase64(key)&&ManagementProfileBcs.serialize(field.value).toBase64()===ManagementProfileBcs.serialize(recipe.publishedProfiles[i]).toBase64(),'INSTALLED_PROFILE')
  const paletteId=deriveDynamicFieldID(a.palettes.id,scopeType,key),CF=bcs.struct('Field',{id:A,name:ManagementScopeBcs,value:bcs.vector(ManagementColorBcs)}),palette=decode(CF,await read(paletteId,`0x2::dynamic_field::Field<${scopeType},vector<${type(visual,'visual','ColorChoice')}>>`,a.palettes.id));check(palette.id===paletteId&&ManagementScopeBcs.serialize(palette.name).toBase64()===toBase64(key)&&JSON.stringify(palette.value)===JSON.stringify(snapshot.colors),'INSTALLED_PALETTE')
 }
 for(const [id,change]of final.effects.V2!.changedObjects)for(const owner of [change.inputState.Exist?.[1].ObjectOwner,change.outputState.ObjectWrite?.[1].ObjectOwner])if(owner&&expected.has(owner))check(expected.get(owner)!.has(id),'UNPLANNED_FIELDS')
 guard();return{transactionDigest:record.packet.digest,composition,rootVisual,boundParts:bound,scene:rootVisual.scene,rootAdapters:rootVisual.adapters,profiles:recipe.profiles,publishedProfiles:recipe.publishedProfiles,boundPartsId:bound.id,slots,originalInstalledCompositionMatchesArtifact:true as const,requiresPlayerAndPublishedSourceComparisonProof:true as const,requiresPublishedAssemblyAndRootAdapterProof:true as const,requiresQualifiedVisualRulesAndNestedSemanticProof:true as const,requiresCurrentCustodyAndWorkbenchProof:true as const,notDeliveryReceipt:true as const,notCurrentAuthority:true as const,executionPackageVersion:'NOT_ATTESTED'as const}
}
