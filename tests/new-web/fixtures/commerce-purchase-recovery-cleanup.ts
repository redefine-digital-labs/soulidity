import {bcs,TypeTagSerializer} from '@mysten/sui/bcs'
import {deriveDynamicFieldID,fromHex,normalizeStructTag} from '@mysten/sui/utils'
import {sha3_256} from '@noble/hashes/sha3.js'
import {purchaseRecoveryCustodyFixture} from './commerce-purchase-recovery-custody'
import {activityEvidenceFixture,activityHash,aid,adigest} from './activity-transaction-evidence'
import {CanonicalSoulBcs,CanonicalNativeStateBcs} from '../../../web/lib/soulidity/canonical-native-workbench'
import {NativeInitialAuthorizationBcs} from '../../../web/lib/soulidity/native-initial-children'
import {NativeOfferBcs} from '../../../web/lib/soulidity/commerce/economics-bcs'
import {nativeSaleSoulManifest} from '../../../web/lib/soulidity/commerce/native-sale-tree'
import {NativeSaleGenerationChangedBcs} from '../../../web/lib/soulidity/commerce/native-sale-cleanup-tree'
import vm from './commerce-native-market-vm.json'

// One coherent original packet and canonical full Object/effects/event/checkpoint
// model, covering real money + listing + custody + root Native cleanup readers.
// Existing recursive VM tests separately cover nested trees; no node execution.
export async function purchaseRecoveryCleanupFixture(variant='',buyerAddress?:string){
 const x=await purchaseRecoveryCustodyFixture(variant==='collection'?'collection':'',buyerAddress),f=x.finality,plan=x.original.plan,content=await activityEvidenceFixture(),changes=f.effectsData.V2!.changedObjects
 const pin=(p:any)=>({originalPackageId:p.originalPackageId,callablePackageId:p.callablePackageId,callableDigest:p.callableDigest})
 const cp=content.packageData.data.Package!;content.deployment.originalPackageId=aid(154);content.deployment.callablePackageId=aid(155);cp.id=aid(155);cp.moduleMap=new Map(['authorization','founding_library','document'].map(name=>[name,new Uint8Array([1])]));cp.typeOriginTable=[['authorization','Authorization'],['authorization','GenerationChanged'],['founding_library','Library'],['document','Record']].map(([moduleName,datatypeName])=>({moduleName,datatypeName,package:aid(154)}));content.rehashPackage()
 const np=f.packageData.data.Package!;np.moduleMap.set('birth',new Uint8Array([1]));np.typeOriginTable.push(...['State','NativeModule','AuthorizationKey','ContentOperator','ContentKey'].map(datatypeName=>({moduleName:'birth',datatypeName,package:f.deployment.originalPackageId})));np.linkageTable.set(aid(154),{upgradedId:aid(155),upgradedVersion:'2'});f.rehashPackage()
 const sp=x.standard.packageData.data.Package!;sp.typeOriginTable.push(...['ModuleKey','NestedSoulWitness','ModuleVersionKey','ModuleVersion'].map(datatypeName=>({moduleName:'soul',datatypeName,package:x.standard.deployment.originalPackageId})));x.standard.rehashPackage()
 const standard=x.standard.deployment.originalPackageId,native=f.deployment.originalPackageId
 function object(id:string,type:string,contents:Uint8Array,owner:any,version:number){const previousTransaction=version===10?f.ledger.digest:adigest(9),bytes=bcs.Object.serialize({data:{Move:{type:{Other:TypeTagSerializer.parseFromStr(type).struct!},hasPublicTransfer:true,version,contents}},owner,previousTransaction,storageRebate:0}).toBytes();const row={objectId:id,objectType:normalizeStructTag(type),version:BigInt(version),digest:activityHash('Object',bytes),bcs:{value:bytes},contents:{value:contents},previousTransaction,owner:owner.ObjectOwner?{kind:2,address:owner.ObjectOwner}:owner.AddressOwner?{kind:1,address:owner.AddressOwner}:{kind:3,version:BigInt(owner.Shared.initialSharedVersion)}};x.rows.set(`${id}:${version}`,row);return {row,owner:bcs.Object.parse(bytes).owner}}
 function effect(id:string,a:ReturnType<typeof object>,b:ReturnType<typeof object>){const row:any=[id,{inputState:{Exist:[[String(a.row.version),a.row.digest],a.owner]},outputState:{ObjectWrite:[b.row.digest,b.owner]},idOperation:{None:true}}],index=changes.findIndex(([other])=>other===id);if(index<0)changes.push(row);else changes[index]=row}
 const state=CanonicalNativeStateBcs.parse(fromHex(vm.sections.BEFORE_ROOT.state));Object.assign(state,{id:aid(68),root:plan.soulId,protocol:plan.configId,registry:plan.registryId,schema:1,creator:aid(71),creator_royalty_bps:250});state.issuer.original=native;state.issuer.callable=f.deployment.callablePackageId;const stateBytes=CanonicalNativeStateBcs.serialize(state).toBytes(),stateType=`${native}::birth::State`,witness=`${native}::birth::NativeModule`,name=new TextEncoder().encode('native')
 const stateField=deriveDynamicFieldID(plan.soulId,`0x2::dynamic_object_field::Wrapper<${standard}::soul::ModuleKey<${witness}>>`,bcs.byteVector().serialize(name).toBytes())
 const rootBeforeRow=x.rows.get(`${plan.soulId}:9`),rootAfterRow=x.rows.get(`${plan.soulId}:10`),beforeRaw=bcs.Object.parse(rootBeforeRow.bcs.value),afterRaw=bcs.Object.parse(rootAfterRow.bcs.value),root=CanonicalSoulBcs.parse(beforeRaw.data.Move!.contents),after=CanonicalSoulBcs.parse(afterRaw.data.Move!.contents)
 const d={...root.modules[0],namespace:{name:witness},name,value_type:{name:stateType},object:state.id,schema:1,removable:false,body_hash:sha3_256(stateBytes),semantic_hash:new Uint8Array(32)};root.modules=[d];after.modules=[structuredClone(d)]
 if(variant==='foreign-change'){const foreign={...structuredClone(d),namespace:{name:`${aid(180)}::foreign::Witness`},name:new Uint8Array([1]),value_type:{name:`${aid(180)}::foreign::Value`},object:aid(181)};root.modules.push(foreign);after.modules.push({...structuredClone(foreign),body_hash:new Uint8Array(32).fill(1)})}
 const rootBytes=CanonicalSoulBcs.serialize(root).toBytes(),rootType=`${standard}::soul::Soul`
 effect(plan.soulId,object(plan.soulId,rootType,rootBytes,beforeRaw.owner,9),object(plan.soulId,rootType,CanonicalSoulBcs.serialize(after).toBytes(),afterRaw.owner,10))
 effect(state.id,object(state.id,stateType,stateBytes,{ObjectOwner:stateField},9),object(state.id,stateType,CanonicalNativeStateBcs.serialize({...state,description:variant==='state-changed'?'changed':state.description}).toBytes(),{ObjectOwner:stateField},10))
 const offerRow=(await x.client.ledgerService.getObject({objectId:plan.offerId,version:9n})).response.object,offer=NativeOfferBcs.parse(offerRow.contents.value);offer.root_revision=root.revision;offer.manifest=nativeSaleSoulManifest(rootBytes)
 effect(plan.offerId,object(plan.offerId,`${native}::market::Offer`,NativeOfferBcs.serialize(offer).toBytes(),{Shared:{initialSharedVersion:1}},9),object(plan.offerId,`${native}::market::Offer`,NativeOfferBcs.serialize({...offer,active:false,purchase:null}).toBytes(),{Shared:{initialSharedVersion:1}},10))
 const Key=bcs.struct('Key',{namespace:bcs.struct('TypeName',{name:bcs.string()}),name:bcs.byteVector()}),Version=bcs.struct('VersionField',{id:bcs.Address,name:Key,value:bcs.struct('Version',{installed:bcs.u64(),updated:bcs.u64()})}),versionName={namespace:d.namespace,name:d.name},versionId=deriveDynamicFieldID(root.id,`${standard}::soul::ModuleVersionKey`,Key.serialize(versionName).toBytes()),versionType=`0x2::dynamic_field::Field<${standard}::soul::ModuleVersionKey,${standard}::soul::ModuleVersion>`
 effect(versionId,object(versionId,versionType,Version.serialize({id:versionId,name:versionName,value:{installed:1,updated:1}}).toBytes(),{ObjectOwner:root.id},9),object(versionId,versionType,Version.serialize({id:versionId,name:versionName,value:{installed:variant==='install-change'?2:1,updated:variant==='old-update'?1:2}}).toBytes(),{ObjectOwner:root.id},10))
 const authId=aid(166),wrapper=`0x2::dynamic_object_field::Wrapper<${native}::birth::AuthorizationKey>`,fieldId=deriveDynamicFieldID(state.id,wrapper,new Uint8Array([0])),Field=bcs.struct('Field',{id:bcs.Address,name:bcs.struct('Wrapper',{name:bcs.struct('Key',{dummy_field:bcs.bool()})}),value:bcs.Address}),fieldBytes=Field.serialize({id:fieldId,name:{name:{dummy_field:false}},value:authId}).toBytes(),fieldType=`0x2::dynamic_field::Field<${wrapper},0x2::object::ID>`
 effect(fieldId,object(fieldId,fieldType,fieldBytes,{ObjectOwner:state.id},9),object(fieldId,fieldType,fieldBytes,{ObjectOwner:state.id},10))
 const auth={id:authId,root:root.id,controller:{root:root.id,parent:state.id,operator:{name:`${native}::birth::ContentOperator`}},generation:0,capacity:4,count:1,next_sequence:2,grants:{id:aid(167),size:2}},authType=`${aid(154)}::authorization::Authorization`
 effect(authId,object(authId,authType,NativeInitialAuthorizationBcs.serialize(auth).toBytes(),{ObjectOwner:fieldId},9),object(authId,authType,NativeInitialAuthorizationBcs.serialize({...auth,generation:variant==='generation'?2:1,count:0}).toBytes(),{ObjectOwner:fieldId},10))
 if(variant==='missing-auth')x.rows.delete(`${authId}:10`)
 if(variant==='extra-effect')changes.push([aid(190),{inputState:{NotExist:true},outputState:{NotExist:true},idOperation:{Deleted:true}}] as any)
 if(variant!=='missing-event')f.eventsData.data.push({package_id:variant==='wrong-emitter'?aid(999):aid(155),transaction_module:'authorization',sender:plan.buyer,type_:{address:aid(154),module:'authorization',name:'GenerationChanged',typeParams:[]},contents:NativeSaleGenerationChangedBcs.serialize({root:root.id,old:0,new:1}).toBytes()})
 f.rehashEvents()
 const prior=x.client.ledgerService.getObject.getMockImplementation()!;x.client.ledgerService.getObject.mockImplementation(async(r:any)=>r.version===undefined&&r.objectId===aid(155)?{response:{object:content.pkg}}:prior(r))
 x.original.context.target.native=pin(f.deployment);x.original.context.target.standard=pin(x.standard.deployment);(x.original.context.target as any).content=pin(content.deployment);x.text=JSON.stringify(x.original)
 x.client.ledgerService.getObject.mockClear()
 return {...x,content,authId,versionId,stateId:state.id}
}
