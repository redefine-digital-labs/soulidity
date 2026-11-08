import { bcs,type BcsType } from '@mysten/sui/bcs'
import { deriveDynamicFieldID,normalizeStructTag,toBase64,toHex } from '@mysten/sui/utils'
import { NativeInitialAuthorizationBcs,NativeInitialPaidBcs } from '../soulidity/native-initial-children'
import { ManagementLoadoutLibraryBcs } from '../soulidity/management/application-bcs'
import { MoveEmptyStructBcs,moveEmptyStructBytes } from '../sui/move-empty-struct'
import { readHistoricalMoveObject } from '../sui/historical-object'
import { readPinnedMovePackageOrigins,type PinnedMovePackage } from '../sui/pinned-move-package'
import { readCurrentCompleteApplicationRecipe } from './current-maker-complete-application-recipe'
import { readCurrentCompleteInstalledComposition } from './current-maker-complete-installed-composition'
import { readCurrentCompleteVersionHistory } from './current-maker-complete-version-history'
import { readCurrentCompleteFinalEffects } from './current-maker-complete-effects'
import { parseCurrentCompletePacket } from './current-maker-complete-packet'
const A=bcs.Address,U=bcs.u64(),V=bcs.byteVector(),N=bcs.u16(),Rates=bcs.struct('Rates',{oc:N,maker:N})
export const CurrentCompleteResaleBcs=bcs.struct('Snapshot',{schema:N,protocol:A,maker:A,version:U,policy_hash:V,oc_creator:A,maker_creator:A,rates:Rates})
export const CurrentCompleteCoreBcs=bcs.struct('Core',{id:A,protocol:A,maker:A,maker_version:U,creator:A,collection:bcs.option(A),manifest:V,configuration:V,genesis:V,resale:CurrentCompleteResaleBcs,beneficiary:A})
const Link=bcs.struct('Field',{id:A,name:bcs.struct('Wrapper',{name:MoveEmptyStructBcs}),value:A})
function check(v:unknown,code:string):asserts v {if(!v)throw Error(`CURRENT_COMPLETE_APPLICATION_CARRIERS_${code}`)}
/** Actual original Core/genesis and empty content-service carriers. Reused
 * Content BCS layouts do not imply Native authority or issuance. */
export async function readCurrentCompleteApplicationCarriers(input:Parameters<typeof readCurrentCompleteInstalledComposition>[0]&{content:PinnedMovePackage}){
 const context={...input,record:parseCurrentCompletePacket(input.record),foundation:structuredClone(input.foundation),application:structuredClone(input.application),standard:structuredClone(input.standard),visual:structuredClone(input.visual),content:structuredClone(input.content)}
 const signal=AbortSignal.any([input.signal,AbortSignal.timeout(60000)]),guard=()=>{signal.throwIfAborted();check(input.isCurrent(),'STALE')}
 guard();const recipe=await readCurrentCompleteApplicationRecipe({...context,signal});guard()
 const installed=await readCurrentCompleteInstalledComposition({...context,signal});guard()
 const history=await readCurrentCompleteVersionHistory({...context,signal});guard()
 const final=await readCurrentCompleteFinalEffects({...context,signal});guard()
 const app=await readPinnedMovePackageOrigins(input.client,context.application,signal);guard();const content=await readPinnedMovePackageOrigins(input.client,context.content,signal);guard()
 const type=(origins:Map<string,string>,module:string,name:string)=>{const origin=origins.get(`${module}::${name}`);check(origin,'TYPE_ORIGIN');return`${origin}::${module}::${name}`}
 const at=(name:string)=>type(app,'character',name),allowed=new Set<string>(),read=async(id:string,type:string,owner:string)=>{const row=await readHistoricalMoveObject({client:input.client,effects:final.effects,transactionDigest:context.record.packet.digest,objectId:id,type,mode:'created',signal,maxBytes:256*1024});guard();check(row.object.owner.ObjectOwner===owner,'OWNER');return row.bytes}
 const linkId=(key:string)=>deriveDynamicFieldID(context.applicationId,`0x2::dynamic_object_field::Wrapper<${at(key)}>`,moveEmptyStructBytes())
 for(const key of ['CoreKey','CompositionKey','BoundPartsKey','AuthorizationKey','ContentKey','PaidAccessKey','OutputKey','LoadoutKey'])allowed.add(linkId(key))
 for(const slot of installed.slots)if(slot.binding.item!==null)allowed.add(deriveDynamicFieldID(context.applicationId,`0x2::dynamic_object_field::Wrapper<${at('ItemKey')}>`,A.serialize(slot.binding.item).toBytes()))
 const decode=<T>(codec:BcsType<T,any>,bytes:Uint8Array)=>{const value=codec.parse(bytes);check(codec.serialize(value).toBase64()===toBase64(bytes),'CANONICAL');return value}
 const carrier=async<T extends{id:string}>(key:string,type:string,codec:BcsType<T,any>)=>{const id=linkId(key),wrapper=`0x2::dynamic_object_field::Wrapper<${at(key)}>`,link=decode(Link,await read(id,`0x2::dynamic_field::Field<${wrapper},0x2::object::ID>`,context.applicationId));check(link.id===id&&!link.name.name.dummy_field,'LINK');const bytes=await read(link.value,type,id),value=decode(codec,bytes);check(value.id===link.value,'CARRIER_ID');return{value,bytes,linkId:id}}
 const core=await carrier('CoreKey',at('Core'),CurrentCompleteCoreBcs),authorization=await carrier('AuthorizationKey',type(content,'authorization','Authorization'),NativeInitialAuthorizationBcs),paid=await carrier('PaidAccessKey',type(content,'paid_access','Ledger'),NativeInitialPaidBcs),loadout=await carrier('LoadoutKey',type(content,'loadout','Library'),ManagementLoadoutLibraryBcs)
 const p=context.record.plan,publication=history.versions.find(v=>v.productId===p.maker.productId)! ,v=publication.published,c=core.value
 check(c.protocol===p.target.configId&&c.maker===p.maker.productId&&c.maker_version===p.maker.version&&c.creator===p.actor&&c.collection===null&&toHex(c.genesis)===recipe.applicationRecipeHash&&toHex(c.manifest)===toHex(v.manifest)&&toHex(c.configuration)===toHex(v.configuration)&&c.beneficiary===v.beneficiary,'CORE_GENESIS_PUBLICATION')
 const expected={schema:1,protocol:p.target.configId,maker:p.maker.productId,version:p.maker.version,policy_hash:v.policy_hash,oc_creator:p.actor,maker_creator:publication.creator,rates:v.soul_rates}
 check(CurrentCompleteResaleBcs.serialize(c.resale).toBase64()===CurrentCompleteResaleBcs.serialize(expected).toBase64(),'RESALE')
 for(const {value}of [authorization,paid,loadout])check(value.root===context.soulId&&value.controller.root===context.soulId&&value.controller.parent===context.applicationId&&normalizeStructTag(value.controller.operator.name)===normalizeStructTag(at('ContentOperator')),'CONTROLLER')
 const a=authorization.value,l=paid.value,b=loadout.value
 check(a.generation==='0'&&a.capacity==='1'&&a.count==='0'&&a.next_sequence==='0'&&a.grants.size==='0','INITIAL_AUTHORIZATION')
 check(l.protocol===p.target.configId&&l.revision==='0'&&l.offers.size==='0'&&l.entries.size==='0'&&l.attempts.size==='0','INITIAL_PAID')
 check(b.version===1&&b.count==='0'&&b.heads.size==='0'&&b.receipts.size==='0','INITIAL_LOADOUT')
 const links=new Map([core,authorization,paid,loadout].map(c=>[c.linkId,c.value.id])),closed=[c.id,a.id,l.id,b.id]
 const empty=[a.grants.id,l.offers.id,l.entries.id,l.attempts.id,b.heads.id,b.receipts.id],roles=[context.applicationId,context.soulId,context.artifactId,installed.composition.id,installed.boundPartsId,installed.rootVisual.id,installed.composition.slots.id,installed.composition.references.pages.id,installed.composition.assembly.profiles.id,installed.composition.assembly.palettes.id,installed.composition.enhancements.id,installed.boundParts.records.pages.id,c.id,a.id,l.id,b.id,...links.keys(),...empty]
 check(new Set(roles).size===roles.length,'ROLE_ALIAS')
 for(const [id,change]of final.effects.V2!.changedObjects)for(const owner of [change.inputState.Exist?.[1].ObjectOwner,change.outputState.ObjectWrite?.[1].ObjectOwner]){
  if(owner===context.applicationId)check(allowed.has(id),'UNPLANNED_APPLICATION_CHILD')
  if(owner){check(!empty.includes(owner)&&!closed.includes(owner),'UNPLANNED_SERVICE_FIELD');if(links.has(owner))check(links.get(owner)===id,'UNPLANNED_CARRIER_CHILD')}
 }
 guard();return{transactionDigest:context.record.packet.digest,core,authorization,paid,loadout,originalApplicationInitialCarriersMatched:true as const,noOriginalStateConfiguration:true as const,
  requiresActualContentAndNestedSemanticProof:true as const,requiresOriginalPlayerAndIssuedCountersProof:true as const,requiresQualifiedParentCommitInvariant:true as const,
  requiresQualifiedRendererAndAssetBytesProof:true as const,requiresPayloadSealAndCurrentCustodyProof:true as const,notDeliveryReceipt:true as const,notCurrentAuthority:true as const,executionPackageVersion:'NOT_ATTESTED'as const}
}
