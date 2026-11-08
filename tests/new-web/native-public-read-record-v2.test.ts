import {expect,it,vi} from 'vitest'
import {bcs} from '@mysten/sui/bcs'
import {deriveDynamicFieldID} from '@mysten/sui/utils'
import {sha256} from '@noble/hashes/sha2.js'
import {sha3_256} from '@noble/hashes/sha3.js'
import {canonicalNativeWorkbenchFixture} from './fixtures/canonical-native-workbench'
import {activityHash,aid} from './fixtures/activity-transaction-evidence'
import {CanonicalSoulBcs,CanonicalOwnedAccountBcs,CanonicalNativeLibraryBcs,CanonicalNativeRecordBcs} from '../../web/lib/soulidity/canonical-native-workbench'
import {readNativePublicOwnerRecordV2,readNativePublicReadRecordV2,readNativePublicReadOverviewV2,NativePublicReadLinkV2Bcs,NativePublicReadHostV2Bcs} from '../../web/lib/soulidity/native-public-read-record-v2'
import {readNativePublicGrantV2,NativePublicGrantV2Bcs} from '../../web/lib/soulidity/native-public-grant-read-v2'
import {NativeInitialAuthorizationBcs} from '../../web/lib/soulidity/native-initial-children'
import {moveEmptyStructBytes,MoveEmptyStructBcs} from '../../web/lib/sui/move-empty-struct'
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
async function grantSetup(){
 const x=await setup(),f=x.f,target=f.input.target,viewer=aid(950),pin=target.content!,row=f.rows.get(pin.callablePackageId),raw=bcs.Object.parse(row.bcs.value)
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
it('reads actual grant-only Host Record, owned Auth child and live grantee row without a paid bit or Account',async()=>{
 const x=await grantSetup(),result=await x.runGrant()
 expect(result.viewerAddress).toBe(x.viewer);expect(result.grant.issuer).toBe(x.f.kiosk!.owner);expect(result.record.read_mask).toBe('3')
 expect(result.authorizationGeneration).toBe('0');expect(result.grantHash).toMatch(/^[0-9a-f]{64}$/);expect(result.notAuthorization).toBe(true)
 expect(x.f.client.core.listOwnedObjects).not.toHaveBeenCalled();await expect(x.run()).rejects.toThrow('PAID_RECORD')
})
it.each(['generation','issuer','scope','expiry-equal','expiry-past','root','grantee','sequence','version','missing-grant','pointer-owner','grant-owner','no-grant-bit','zero-scope','unknown-scope','auth-count','clock-birth','changed-grant'])('rejects actual grant evidence violation: %s',async variant=>{
 const x=await grantSetup()
 if(variant==='generation')x.auth.generation='1'
 if(variant==='issuer')x.grant.issuer=aid(999)
 if(variant==='scope')x.grant.scope='2'
 if(variant==='expiry-equal')x.grant.expiry='100'
 if(variant==='expiry-past')x.grant.expiry='99'
 if(variant==='root')x.grant.root=aid(999)
 if(variant==='grantee')x.grant.grantee=aid(999)
 if(variant==='sequence')x.grant.sequence='1'
 if(variant==='version')x.grant.version=2
 if(variant==='no-grant-bit'){x.record.read_mask='5';x.rewriteRecord()}
 if(variant==='zero-scope'){x.record.scope='0';x.rewriteRecord()}
 if(variant==='unknown-scope'){x.record.scope='16';x.grant.scope='16';x.rewriteRecord()}
 if(variant==='auth-count')x.auth.count='0'
 x.rewrite()
 if(variant==='missing-grant')x.f.rows.delete(x.grantId)
 if(variant==='pointer-owner'||variant==='grant-owner'||variant==='clock-birth'){
  const id=variant==='pointer-owner'?x.pointerId:variant==='grant-owner'?x.grantId:aid(6),row=x.f.rows.get(id),raw=bcs.Object.parse(row.bcs.value)
  raw.owner=variant==='clock-birth'?{Shared:{initialSharedVersion:'2'}}:{ObjectOwner:aid(999)};row.bcs.value=bcs.Object.serialize(raw).toBytes();row.digest=activityHash('Object',row.bcs.value)
 }
 if(variant==='changed-grant'){
  const read=x.f.client.ledgerService.getObject.getMockImplementation()!;let calls=0
  x.f.client.ledgerService.getObject.mockImplementation(async request=>{if(request.objectId===x.grantId&&++calls===2){x.grant.expiry='201';x.rewrite()}return read(request)})
 }
 await expect(x.runGrant()).rejects.toThrow()
})
it('captures grantee, target and original RPC methods before the first await',async()=>{
 const x=await grantSetup(),read=x.f.client.ledgerService.getObject.getMockImplementation()!;let changed=false
 x.f.client.ledgerService.getObject.mockImplementation(async request=>{if(!changed){changed=true;x.input.viewerAddress=aid(999);x.input.target.configId=aid(999);x.f.client.ledgerService.getObject=vi.fn(async()=>{throw Error('MUTATED_METHOD')})}return read(request)})
 const result=await x.runGrant();expect(result.viewerAddress).toBe(x.viewer);expect(result.grantReference.objectId).toBe(x.grantId)
})
it('forwards original RPC transport cancellation options through the private Clock observer',async()=>{
 const x=await grantSetup(),controller=new AbortController();x.input.signal=controller.signal
 await x.runGrant()
 const options=x.f.client.ledgerService.getObject.mock.calls.map(call=>Reflect.get(call,1)).filter(v=>v?.abort)
 expect(options.length).toBeGreaterThan(0);expect(options.every(v=>v.abort instanceof AbortSignal&&!v.abort.aborted)).toBe(true)
 controller.abort();expect(options.every(v=>v.abort.aborted)).toBe(true)
})
it('does not let untyped extra selection fields turn the paid adapter into a grant adapter',async()=>{
 const x=await grantSetup()
 await expect(readNativePublicReadRecordV2({...x.f.input,recordIndex:0,grantSelection:true} as any)).rejects.toThrow('PAID_RECORD')
})
function clockAt(x:Awaited<ReturnType<typeof grantSetup>>,timestamp:number,version:number){
 const row=x.f.rows.get(aid(6)),raw=bcs.Object.parse(row.bcs.value)
 raw.data.Move!.version=String(version);raw.data.Move!.contents=bcs.struct('Clock',{id:bcs.Address,timestamp_ms:bcs.u64()}).serialize({id:aid(6),timestamp_ms:String(timestamp)}).toBytes()
 row.version=BigInt(version);row.bcs.value=bcs.Object.serialize(raw).toBytes();row.digest=activityHash('Object',row.bcs.value)
}
it('accepts normal Clock advancement within each view while keeping actual Grant current',async()=>{
 const x=await grantSetup(),read=x.f.client.ledgerService.getObject.getMockImplementation()!;let n=0
 x.f.client.ledgerService.getObject.mockImplementation(async request=>{if(request.objectId===aid(6))clockAt(x,100+(++n),100+n);return read(request)})
 expect(BigInt((await x.runGrant()).clockTimestampMs)).toBeGreaterThan(100n)
})
it.each(['time-regression','version-regression','same-version-equivocation','cross-view-regression','final-version-regression','final-equivocation','final-expiry'])('rejects Clock violation while allowing ordinary time to advance: %s',async variant=>{
 const x=await grantSetup(),read=x.f.client.ledgerService.getObject.getMockImplementation()!;let n=0
 x.f.client.ledgerService.getObject.mockImplementation(async request=>{
  if(request.objectId===aid(6)){
   n++;let timestamp=100,version=100
   if(n===2&&variant==='time-regression')timestamp=99
   if(n===2&&variant==='version-regression')version=99
   if(n===2&&variant==='same-version-equivocation')timestamp=101
   if(n>=3&&variant==='cross-view-regression'){timestamp=99;version=101}
   if(n>=5&&variant==='final-version-regression'){timestamp=101;version=99}
   if(n>=5&&variant==='final-equivocation')timestamp=101
   if(n>=5&&variant==='final-expiry'){timestamp=200;version=101}
   clockAt(x,timestamp,version)
  }
  return read(request)
 })
 await expect(x.runGrant()).rejects.toThrow(variant==='final-expiry'?'EXPIRED':'CLOCK')
})
it('reads actual schema2 root/link/shared Host/embedded State/record and exact Kiosk lock without owner Account',async()=>{
 const {run,host}=await setup(),p=await run();expect(p.hostId).toBe(host.id);expect(p.record.scope).toBe('1');expect(p.shared.host.initialSharedVersion).toBe('5');expect(p.notAuthorization).toBe(true)
})
it.each(['host-root','embedded-registry','embedded-content','paid-bit','scope','deleted','purged','lock','record-hash','legacy-format'])( 'rejects %s without legacy or current fallback',async variant=>{
 const x=await setup()
 if(variant==='host-root')x.host.root=aid(99)
 if(variant==='embedded-registry')x.host.state.registry=aid(99)
 if(variant==='embedded-content')x.host.state.content=aid(99)
 if(variant==='paid-bit')x.record.read_mask='1'
 if(variant==='scope')x.record.scope='0'
 if(variant==='deleted')x.record.deleted=true
 if(variant==='purged')x.record.purged=true
 if(variant==='lock')x.f.rows.delete(x.lockId)
 if(variant==='record-hash')x.record.name='substitute'
 if(variant==='legacy-format'){x.f.root.modules[0].schema=1;const old=bcs.Object.parse(x.f.rows.get(x.f.root.id).bcs.value);x.f.object(x.f.root.id,`${x.f.standardId}::soul::Soul`,CanonicalSoulBcs.serialize(x.f.root).toBytes(),old.owner.ObjectOwner!)}
 x.rewriteHost();if(variant!=='record-hash')x.rewriteRecord()
 else{const row=x.f.rows.get(x.f.records[0].objectId),raw=bcs.Object.parse(row.bcs.value),Field=bcs.struct('Field',{id:bcs.Address,name:bcs.u64(),value:CanonicalNativeRecordBcs});const field=Field.parse(raw.data.Move!.contents);field.value.name='substitute';x.f.object(row.objectId,`0x2::dynamic_field::Field<u64,${x.f.input.target.content!.originalPackageId}::document::Record>`,Field.serialize(field).toBytes(),x.f.library.records.id)}
 await expect(x.run()).rejects.toThrow(variant==='record-hash'?'RECORD_COMMITMENT':undefined)
})

it('rejects a Host that changes while its child records are being read',async()=>{
 const x=await setup(),read=x.f.client.ledgerService.getObject.getMockImplementation()!;let reads=0
 x.f.client.ledgerService.getObject.mockImplementation(async request=>{if(request.objectId===x.host.id&&++reads===2){x.host.state.description='changed';x.rewriteHost()}return read(request)})
 await expect(x.run()).rejects.toThrow('CHANGED_RETRY')
})

it('pages actual committed public record metadata without requiring paid access for owner-only entries',async()=>{
 const x=await setup(30),first=await readNativePublicReadOverviewV2({...x.f.input,recordStart:0})
 expect(first.recordSummaries).toHaveLength(25);expect(first.recordSummaries[1].readMask).toBe('3');expect(first.nextRecordStart).toBe(25)
 const next=await readNativePublicReadOverviewV2({...x.f.input,recordStart:25})
 expect(next.recordSummaries.map(r=>r.index)).toEqual([25,26,27,28,29]);expect(next.nextRecordStart).toBeNull();expect(next.record).toBeNull()
})

it('keeps the selected index bound to the original record while caller input changes',async()=>{
 const x=await setup(),input={...x.f.input,recordIndex:0},read=x.f.client.ledgerService.getObject.getMockImplementation()!
 x.f.client.ledgerService.getObject.mockImplementation(async request=>{input.recordIndex=1;return read(request)})
 const view=await readNativePublicReadRecordV2(input);expect(view.recordIndex).toBe(0);expect(view.record.name).toBe('soul')
})

it('rejects a Link introduced in a different defining publication from the Native witness',async()=>{
 const x=await setup(),pin=x.f.input.target.native,row=x.f.rows.get(pin.callablePackageId),raw=bcs.Object.parse(row.bcs.value)
 raw.data.Package!.typeOriginTable.find(o=>o.moduleName==='birth'&&o.datatypeName==='PublicReadLinkV2')!.package=aid(999)
 row.bcs.value=bcs.Object.serialize(raw).toBytes();row.digest=activityHash('Object',row.bcs.value);pin.callableDigest=row.digest
 await expect(x.run()).rejects.toThrow('COLOCATED_WITNESS_LINK_REQUIRED')
})

it('reads an owner-only zero-scope record through the actual owned Account and locked Kiosk',async()=>{
 const x=await setup();x.record.read_mask='1';x.record.scope='0';x.rewriteRecord()
 const view=await readNativePublicOwnerRecordV2({...x.f.input,recordIndex:0,viewerAddress:x.f.kiosk!.owner})
 expect(view.accountReference.objectId).toBe(x.f.account!.id);expect(view.record.scope).toBe('0');expect(view.requiresCurrentOwnerPolicyExecution).toBe(true)
 await expect(x.run()).rejects.toThrow('PAID_RECORD')
})
it.each(['wrong-viewer','wrong-cap','unsealed','wrong-owner','missing-account','no-owner-bit','ambiguous','changed-account'])( 'rejects invalid owner read: %s',async variant=>{
 const x=await setup(),account=x.f.account!,viewer=x.f.kiosk!.owner
 if(variant==='wrong-cap')account.authority.cap.for=aid(998)
 if(variant==='unsealed')account.authority=null
 if(variant==='wrong-owner')account.owner=aid(998)
 if(variant==='missing-account')x.f.client.core.listOwnedObjects.mockResolvedValue({objects:[],hasNextPage:false,cursor:null})
 if(variant==='no-owner-bit'){x.record.read_mask='4';x.rewriteRecord()}
 if(variant==='ambiguous'){
  const duplicate=structuredClone(account);duplicate.id=aid(992);duplicate.authority.cap.id=aid(993)
  x.f.object(duplicate.id,`${x.f.input.target.custody!.originalPackageId}::account::Account`,CanonicalOwnedAccountBcs.serialize(duplicate).toBytes(),{AddressOwner:viewer})
  x.f.client.core.listOwnedObjects.mockResolvedValue({objects:[{objectId:account.id},{objectId:duplicate.id}],hasNextPage:false,cursor:null})
 }
 if(variant==='changed-account'){
  const read=x.f.client.ledgerService.getObject.getMockImplementation()!;let n=0
  x.f.client.ledgerService.getObject.mockImplementation(async request=>{
   if(request.objectId===account.id&&++n===2){account.authority.closed_digest=new Uint8Array(32).fill(9);rewrite()}
   return read(request)
  })
 }
 function rewrite(){x.f.object(account.id,`${x.f.input.target.custody!.originalPackageId}::account::Account`,CanonicalOwnedAccountBcs.serialize(account).toBytes(),{AddressOwner:viewer})}
 rewrite()
 await expect(readNativePublicOwnerRecordV2({...x.f.input,recordIndex:0,viewerAddress:variant==='wrong-viewer'?aid(998):viewer})).rejects.toThrow()
})
