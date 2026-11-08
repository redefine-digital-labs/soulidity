import {expect,it,vi} from 'vitest'
import {bcs} from '@mysten/sui/bcs'
import {deriveDynamicFieldID} from '@mysten/sui/utils'
import {sha256} from '@noble/hashes/sha2.js'
import {sha3_256} from '@noble/hashes/sha3.js'
import {canonicalNativeWorkbenchFixture} from './canonical-native-workbench'
import {activityHash,aid} from './activity-transaction-evidence'
import {CanonicalSoulBcs,CanonicalOwnedAccountBcs,CanonicalNativeLibraryBcs,CanonicalNativeRecordBcs} from '../../../web/lib/soulidity/canonical-native-workbench'
import {readNativePublicOwnerRecordV2,readNativePublicReadRecordV2,readNativePublicReadOverviewV2,NativePublicReadLinkV2Bcs,NativePublicReadHostV2Bcs} from '../../../web/lib/soulidity/native-public-read-record-v2'
import {readNativePublicGrantV2,NativePublicGrantV2Bcs} from '../../../web/lib/soulidity/native-public-grant-read-v2'
import {NativeInitialAuthorizationBcs} from '../../../web/lib/soulidity/native-initial-children'
import {moveEmptyStructBytes,MoveEmptyStructBcs} from '../../../web/lib/sui/move-empty-struct'
async function setup(count=2){
 const f=await canonicalNativeWorkbenchFixture(true,count,true),target=f.input.target,row=f.rows.get(target.native.callablePackageId),raw=bcs.Object.parse(row.bcs.value),pkg=raw.data.Package!
 pkg.typeOriginTable.push(...['PublicReadHostV2','PublicReadLinkV2'].map(datatypeName=>({moduleName:'birth',datatypeName,package:f.nativeId})))
 pkg.linkageTable=new Map([target.standard,target.content!,target.custody!].map(p=>[p.originalPackageId,{upgradedId:p.callablePackageId,upgradedVersion:String(f.rows.get(p.callablePackageId).version)}]))
 row.bcs.value=bcs.Object.serialize(raw).toBytes();row.digest=activityHash('Object',row.bcs.value);target.native.callableDigest=row.digest
 const link={id:aid(720),root:f.root.id,host:aid(721)},host={id:link.host,root:f.root.id,state:structuredClone(f.state)}
 const linkBytes=NativePublicReadLinkV2Bcs.serialize(link).toBytes(),descriptor=f.root.modules[0]
 descriptor.object=link.id;descriptor.value_type.name=`${f.nativeId}::birth::PublicReadLinkV2`;descriptor.schema=2;descriptor.body_hash=sha3_256(linkBytes);descriptor.semantic_hash=sha256(linkBytes)
 const rootOwner=bcs.Object.parse(f.rows.get(f.root.id).bcs.value).owner.ObjectOwner!
 f.object(f.root.id,`${f.standardId}::soul::Soul`,CanonicalSoulBcs.serialize(f.root).toBytes(),rootOwner)
 const oldField=bcs.Object.parse(f.rows.get(f.fieldId).bcs.value).data.Move!,Field=bcs.struct('Field',{id:bcs.Address,name:bcs.struct('Wrapper',{name:bcs.struct('Key',{name:bcs.byteVector()})}),value:bcs.Address}),field=Field.parse(oldField.contents);field.value=link.id
 const moduleWrapper=`0x2::dynamic_object_field::Wrapper<${f.standardId}::soul::ModuleKey<${f.nativeId}::birth::NativeModule>>`
 f.object(f.fieldId,`0x2::dynamic_field::Field<${moduleWrapper},0x2::object::ID>`,Field.serialize(field).toBytes(),f.root.id)
 f.rows.delete(f.state.id);f.object(link.id,`${f.nativeId}::birth::PublicReadLinkV2`,linkBytes,f.fieldId)
 const rewriteHost=()=>f.object(host.id,`${f.nativeId}::birth::PublicReadHostV2`,NativePublicReadHostV2Bcs.serialize(host).toBytes(),{Shared:{initialSharedVersion:'5'}})
 rewriteHost()
 const kioskId=f.kiosk!.id,lockId=deriveDynamicFieldID(kioskId,'0x2::kiosk::Lock',bcs.Address.serialize(f.root.id).toBytes()),Lock=bcs.struct('Field',{id:bcs.Address,name:bcs.struct('Lock',{id:bcs.Address}),value:bcs.bool()})
 f.object(lockId,'0x2::dynamic_field::Field<0x2::kiosk::Lock,bool>',Lock.serialize({id:lockId,name:{id:f.root.id},value:true}).toBytes(),kioskId)
 f.object(aid(6),'0x2::clock::Clock',bcs.struct('Clock',{id:bcs.Address,timestamp_ms:bcs.u64()}).serialize({id:aid(6),timestamp_ms:'100'}).toBytes(),{Shared:{initialSharedVersion:'1'}})
 const record=f.records[0].value;record.read_mask='5'
 const rewriteRecord=()=>{const bytes=CanonicalNativeRecordBcs.serialize(record).toBytes();f.library.entries[0].hash=sha256(bytes)
 f.object(f.records[0].objectId,`0x2::dynamic_field::Field<u64,${target.content!.originalPackageId}::document::Record>`,bcs.struct('Field',{id:bcs.Address,name:bcs.u64(),value:CanonicalNativeRecordBcs}).serialize({id:f.records[0].objectId,name:'0',value:record}).toBytes(),f.library.records.id)
 f.object(f.library.id,`${target.content!.originalPackageId}::founding_library::Library`,CanonicalNativeLibraryBcs.serialize(f.library).toBytes(),f.libraryFieldId)}
 rewriteRecord()
 return{f,host,record,link,lockId,rewriteHost,rewriteRecord,run:()=>readNativePublicReadRecordV2({...f.input,recordIndex:0})}
}
export async function grantOpenObjectsFixtureV2(viewer=aid(950)){
 const x=await setup(),f=x.f,target=f.input.target,pin=target.content!,row=f.rows.get(pin.callablePackageId),raw=bcs.Object.parse(row.bcs.value)
 raw.data.Package!.typeOriginTable.push({moduleName:'authorization',datatypeName:'Grant',package:pin.originalPackageId})
 row.bcs.value=bcs.Object.serialize(raw).toBytes();row.digest=activityHash('Object',row.bcs.value);pin.callableDigest=row.digest
 x.record.read_mask='3';x.rewriteRecord()
 const wrapper=`0x2::dynamic_object_field::Wrapper<${f.nativeId}::birth::AuthorizationKey>`,pointerId=deriveDynamicFieldID(x.host.state.id,wrapper,moveEmptyStructBytes())
 const auth={id:aid(960),controller:{operator:{name:`${f.nativeId.slice(2)}::birth::ContentOperator`},parent:x.host.state.id,root:f.root.id},root:f.root.id,generation:'0',capacity:'1',count:'1',next_sequence:'1',grants:{id:aid(961),size:'1'}}
 const grant={root:f.root.id,version:1,sequence:'0',issuer:f.kiosk!.owner,grantee:viewer,scope:'1',expiry:'200' as string|null,generation:'0'}
 const grantId=deriveDynamicFieldID(auth.grants.id,'address',bcs.Address.serialize(viewer).toBytes())
 const Pointer=bcs.struct('Field',{id:bcs.Address,name:bcs.struct('Wrapper',{name:MoveEmptyStructBcs}),value:bcs.Address}),GrantField=bcs.struct('Field',{id:bcs.Address,name:bcs.Address,value:NativePublicGrantV2Bcs})
 const rewrite=()=>{
  f.object(pointerId,`0x2::dynamic_field::Field<${wrapper},0x2::object::ID>`,Pointer.serialize({id:pointerId,name:{name:{dummy_field:false}},value:auth.id}).toBytes(),x.host.state.id)
  f.object(auth.id,`${pin.originalPackageId}::authorization::Authorization`,NativeInitialAuthorizationBcs.serialize(auth).toBytes(),pointerId)
  f.object(grantId,`0x2::dynamic_field::Field<address,${pin.originalPackageId}::authorization::Grant>`,GrantField.serialize({id:grantId,name:viewer,value:grant}).toBytes(),auth.grants.id)
 };rewrite()
 const input={...f.input,recordIndex:0,viewerAddress:viewer}
 return {...x,auth,grant,grantId,pointerId,viewer,rewrite,input,runGrant:()=>readNativePublicGrantV2(input)}
}
