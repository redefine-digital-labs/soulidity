import {bcs} from '@mysten/sui/bcs'
import type {SuiGrpcClient} from '@mysten/sui/grpc'
import {deriveDynamicFieldID,normalizeStructTag,toBase64,toHex} from '@mysten/sui/utils'
import {sha256} from '@noble/hashes/sha2.js'
import {sha3_256} from '@noble/hashes/sha3.js'
import {profileReadStep,SoulPublicKioskBcs,KIOSK_ITEM_FIELD_TYPE,assertKioskItemField} from '@soulidity/sdk'
import {collectionCommandRaw} from '../collections/collection-command-plan'
import {historicalMoveObjectType} from '../sui/historical-object'
import {readPinnedMovePackage} from '../sui/pinned-move-package'
import {moveEmptyStructBytes,MoveEmptyStructBcs} from '../sui/move-empty-struct'
import {receiveManagementSoul} from './management/receive'
import {CanonicalSoulBcs,CanonicalOwnedAccountBcs,CanonicalNativeStateBcs,CanonicalNativeLibraryBcs,CanonicalNativeRecordBcs,parseCanonicalNativeWorkbenchTarget,type CanonicalNativeWorkbenchTarget} from './canonical-native-workbench'
import {nativeContentSealNamespace} from './native-creation-transaction'
const A=bcs.Address,U=bcs.u64()
export const NativePublicReadLinkV2Bcs=bcs.struct('PublicReadLinkV2',{id:A,root:A,host:A})
export const NativePublicReadHostV2Bcs=bcs.struct('PublicReadHostV2',{id:A,root:A,state:CanonicalNativeStateBcs})
const clockId='0x'+'6'.padStart(64,'0')
function check(v:unknown,c:string):asserts v {if(!v)throw Error(`NATIVE_PUBLIC_READ_V2_${c}`)}
function decode<C extends {parse(v:Uint8Array):any;serialize(v:any):{toBytes():Uint8Array}}>(codec:C,bytes:Uint8Array):ReturnType<C['parse']>{const value=codec.parse(bytes);check(toBase64(codec.serialize(value).toBytes())===toBase64(bytes),'CANONICAL');return value}
/** Current schema2 Link -> shared Host -> sole embedded State -> actual Record.
 * Explicit new-format consumer, never v1 fallback or a grant to decrypt. Actual
 * paid Entry/generation/expiry and policy execution remain on-chain authority.
 * Requires candidate source/format adoption before enabling a product release.
 */
async function readView(input:{client:SuiGrpcClient;target:CanonicalNativeWorkbenchTarget;soulId:string;recordIndex:number|null;recordStart?:number;ownerViewer?:string;grantSelection?:true;signal:AbortSignal}){
 const target=parseCanonicalNativeWorkbenchTarget(input.target),{client,soulId}=input,index=input.recordIndex,signal=AbortSignal.any([input.signal,AbortSignal.timeout(45000)])
 const ownerViewer=input.ownerViewer;
 const grantSelection=input.grantSelection===true;check(!(ownerViewer!==undefined&&grantSelection),'READ_MODE')
 const start=input.recordStart??0;check(Number.isSafeInteger(start)&&start>=0&&start<=4096,'PAGE')
 check(target.content&&(index===null||Number.isSafeInteger(index)&&index>=0&&index<4096),'CONFIGURATION')
 const receptionInput={client,target:{chainIdentifier:target.chainIdentifier,standard:target.standard},soulId,signal}
 const first=await receiveManagementSoul(receptionInput)
 const [native,content,standard]=await Promise.all([target.native,target.content,target.standard].map(pin=>readPinnedMovePackage(client,pin!,signal)))
 for(const dependency of [content,standard]){const link=native.linkage.get(dependency.pin.originalPackageId);check(link?.upgradedId===dependency.pin.callablePackageId&&link.upgradedVersion===String(dependency.version),'DEPENDENCY')}
 function type(pkg:typeof native,module:string,name:string){const origin=pkg.origins.get(`${module}::${name}`);check(origin,'TYPE_ORIGIN');return normalizeStructTag(`${origin}::${module}::${name}`)}
 const witness=type(native,'birth','NativeModule'),linkType=type(native,'birth','PublicReadLinkV2')
 check(witness.split('::')[0]===linkType.split('::')[0],'COLOCATED_WITNESS_LINK_REQUIRED')
 const descriptor=first.modules.filter(m=>m.namespace===witness&&m.nameHex==='6e6174697665')
 check(first.producer===type(native,'registry','SoulProducer')&&first.sourceType===type(native,'registry','Registry')&&first.sourceId===target.registryId,'PRODUCER')
 check(descriptor.length===1&&descriptor[0].schema===2&&!descriptor[0].removable&&descriptor[0].valueType===linkType,'FORMAT')
 const stamps=new Map<string,{type:string;version:string;digest:string}>()
 async function read(id:string,expected:string){
  signal.throwIfAborted()
  const {response}=await profileReadStep(signal,()=>client.ledgerService.getObject({objectId:id,readMask:{paths:['object_id','version','digest','bcs']}},{abort:signal}))
  const row=response.object;check(row?.objectId===id&&typeof row.version==='bigint'&&row.version>0n&&row.digest&&row.bcs?.value instanceof Uint8Array&&row.bcs.value.length<=256*1024,'OBJECT')
  const raw=collectionCommandRaw({objectId:id,version:String(row.version),digest:row.digest,bcs:toBase64(row.bcs.value)}),move=raw.data.Move
  check(move&&historicalMoveObjectType(move.type)===normalizeStructTag(expected),'TYPE')
  const stamp={type:expected,version:String(row.version),digest:row.digest},old=stamps.get(id)
  // Clock legitimately advances while all business objects stay unchanged.
  // Its own canonical identity/birth and monotonicity are checked separately.
  if(id!==clockId){check(!old||JSON.stringify(old)===JSON.stringify(stamp),'CHANGED_RETRY');stamps.set(id,stamp)}
  return{raw,bytes:new Uint8Array(move.contents),reference:{objectId:id,version:String(row.version),digest:row.digest}}
 }
 const linkObject=await read(descriptor[0].objectId,type(native,'birth','PublicReadLinkV2')),link=decode(NativePublicReadLinkV2Bcs,linkObject.bytes)
 check(link.id===descriptor[0].objectId&&link.root===soulId&&toHex(sha3_256(linkObject.bytes))===descriptor[0].bodyHash&&toHex(sha256(linkObject.bytes))===descriptor[0].semanticHash,'LINK')
 const hostObject=await read(link.host,type(native,'birth','PublicReadHostV2')),host=decode(NativePublicReadHostV2Bcs,hostObject.bytes),state=host.state
 check(host.id===link.host&&host.root===soulId&&hostObject.raw.owner.Shared&&state.root===soulId&&state.schema===1
  &&state.protocol===target.configId&&state.registry===target.registryId&&state.creator===first.mintedBy&&state.issuer.original===target.native.originalPackageId,'HOST_STATE')
 check(new Set([soulId,link.id,host.id,state.id,state.content]).size===5,'ALIASES')
 const rootObject=await read(soulId,type(standard,'soul','Soul')),root=decode(CanonicalSoulBcs,rootObject.bytes),itemId=rootObject.raw.owner.ObjectOwner
 check(root.id===soulId&&itemId,'ROOT_OWNER')
 const item=await read(itemId,KIOSK_ITEM_FIELD_TYPE),kioskId=item.raw.owner.ObjectOwner
 check(kioskId&&assertKioskItemField(item.bytes,kioskId,soulId)===itemId,'KIOSK_ITEM')
 const kioskObject=await read(kioskId,'0x2::kiosk::Kiosk'),kiosk=decode(SoulPublicKioskBcs,kioskObject.bytes)
 check(kiosk.id===kioskId&&kioskObject.raw.owner.Shared&&BigInt(kiosk.item_count)>0n,'KIOSK')
 const lockId=deriveDynamicFieldID(kioskId,'0x2::kiosk::Lock',bcs.Address.serialize(soulId).toBytes()),lockObject=await read(lockId,'0x2::dynamic_field::Field<0x2::kiosk::Lock,bool>')
 const lock=decode(bcs.struct('LockField',{id:A,name:bcs.struct('Lock',{id:A}),value:bcs.bool()}),lockObject.bytes)
 check(lock.id===lockId&&lock.name.id===soulId&&lock.value&&lockObject.raw.owner.ObjectOwner===kioskId,'LOCK')
 const wrapper=`0x2::dynamic_object_field::Wrapper<${type(native,'birth','ContentKey')}>`,fieldId=deriveDynamicFieldID(state.id,wrapper,moveEmptyStructBytes())
 const fieldObject=await read(fieldId,`0x2::dynamic_field::Field<${wrapper},0x2::object::ID>`)
 const field=decode(bcs.struct('ContentField',{id:A,name:bcs.struct('Wrapper',{name:MoveEmptyStructBcs}),value:A}),fieldObject.bytes)
 check(field.id===fieldId&&!field.name.name.dummy_field&&field.value===state.content&&fieldObject.raw.owner.ObjectOwner===state.id,'CONTENT_LINK')
 const libraryObject=await read(state.content,type(content,'founding_library','Library')),library=decode(CanonicalNativeLibraryBcs,libraryObject.bytes)
 check(libraryObject.raw.owner.ObjectOwner===fieldId&&library.id===state.content&&library.root===soulId&&library.controller.parent===state.id&&library.controller.root===soulId
  &&normalizeStructTag(library.controller.operator.name)===type(native,'birth','ContentOperator')&&BigInt(library.records.size)<=4096n,'LIBRARY')
 check(library.entries.length===Number(library.records.size)&&new Set(library.entries.map(e=>e.index)).size===library.entries.length
  &&library.entries.every(e=>BigInt(e.index)<4096n&&e.hash.length===32),'DIRECTORY')
 let record:ReturnType<typeof CanonicalNativeRecordBcs.parse>|null=null,namespace:string|null=null,recordReference:{objectId:string;version:string;digest:string}|null=null
 async function readRecord(at:number){
 const recordId=deriveDynamicFieldID(library.records.id,'u64',bcs.u64().serialize(at).toBytes()),recordObject=await read(recordId,`0x2::dynamic_field::Field<u64,${type(content,'document','Record')}>`)
 const rf=decode(bcs.struct('RecordField',{id:A,name:U,value:CanonicalNativeRecordBcs}),recordObject.bytes),value=rf.value
 const committed=library.entries.filter(e=>e.index===String(at))
 check(rf.id===recordId&&rf.name===String(at)&&recordObject.raw.owner.ObjectOwner===library.records.id&&committed.length===1
  &&toHex(sha256(CanonicalNativeRecordBcs.serialize(value).toBytes()))===toHex(committed[0].hash),'RECORD_COMMITMENT')
 return{value,reference:recordObject.reference}
 }
 const recordSummaries:Array<{index:number;name:string;kind:number;version:string;readMask:string;scope:string;deleted:boolean;purged:boolean}>=[]
 if(index===null)for(const entry of library.entries.slice(start,start+25)){const at=Number(entry.index),{value:r}=await readRecord(at);recordSummaries.push({index:at,name:r.name,kind:r.kind,version:r.version,readMask:r.read_mask,scope:r.scope,deleted:r.deleted,purged:r.purged})}
 if(index!==null){
 const selected=await readRecord(index);record=selected.value;recordReference=selected.reference
 check(!record.deleted&&!record.purged&&(ownerViewer ? (BigInt(record.read_mask)&1n)!==0n : (BigInt(record.read_mask)&(grantSelection?2n:4n))!==0n&&BigInt(record.scope)>0n),ownerViewer?'OWNER_RECORD':grantSelection?'GRANT_RECORD':'PAID_RECORD')
 const recordNamespace=nativeContentSealNamespace(state.content,record.kind,record.name,toHex(record.nonce),record.version)
 check(record.seal_namespace===null||toHex(record.seal_namespace)===toHex(recordNamespace),'NAMESPACE');namespace=toHex(recordNamespace)
 }
 let accountReference:{objectId:string;version:string;digest:string}|null=null
 if(ownerViewer!==undefined){
  check(/^0x[0-9a-f]{64}$/.test(ownerViewer)&&BigInt(ownerViewer)>0n&&ownerViewer===kiosk.owner&&target.custody,'OWNER')
  const custody=await readPinnedMovePackage(client,target.custody,signal),dependency=native.linkage.get(custody.pin.originalPackageId)
  check(dependency?.upgradedId===custody.pin.callablePackageId&&dependency.upgradedVersion===String(custody.version),'CUSTODY_DEPENDENCY')
  const accountType=type(custody,'account','Account'),seen=new Set<string>(),cursors=new Set<string>();let cursor:string|null|undefined,done=false
  for(let page=0;page<20;page++){
   const result=await profileReadStep(signal,()=>client.core.listOwnedObjects({owner:ownerViewer,type:accountType,limit:50,cursor}))
   check(result.objects.length<=50&&typeof result.hasNextPage==='boolean','ACCOUNT_PAGE')
   for(const hint of result.objects){
    check(/^0x[0-9a-f]{64}$/.test(hint.objectId)&&BigInt(hint.objectId)>0n&&!seen.has(hint.objectId),'ACCOUNT_ALIAS');seen.add(hint.objectId)
    const object=await read(hint.objectId,accountType),account=decode(CanonicalOwnedAccountBcs,object.bytes)
    check(account.id===hint.objectId&&account.owner===ownerViewer&&object.raw.owner.AddressOwner===ownerViewer,'ACCOUNT_OWNER')
    if(account.kiosk!==kioskId||account.authority===null)continue
    const authority=account.authority
    check(authority.kiosk===kioskId&&authority.owner===ownerViewer&&authority.cap.for===kioskId
     &&/^0x[0-9a-f]{64}$/.test(authority.cap.id)&&BigInt(authority.cap.id)>0n
     &&new Set([account.id,authority.cap.id,kioskId,soulId,host.id,link.id,state.id,state.content]).size===8
     &&[0,32].includes(authority.closed_digest.length),'ACCOUNT_AUTHORITY')
    check(accountReference===null,'ACCOUNT_AMBIGUOUS');accountReference=object.reference
   }
   if(!result.hasNextPage){done=true;break}
   check(typeof result.cursor==='string'&&result.cursor.length>0&&result.cursor.length<=16384&&!cursors.has(result.cursor),'ACCOUNT_CURSOR')
   cursors.add(result.cursor);cursor=result.cursor
  }
  check(done&&accountReference,'ACCOUNT_REQUIRED')
 }
 const Clock=bcs.struct('Clock',{id:A,timestamp_ms:U}),clockObject=await read(clockId,'0x2::clock::Clock'),initialClock=decode(Clock,clockObject.bytes)
 check(initialClock.id===clockId&&clockObject.raw.owner.Shared?.initialSharedVersion==='1','CLOCK')
 for(const [id,stamp] of stamps)await read(id,stamp.type)
 check(JSON.stringify(await receiveManagementSoul(receptionInput))===JSON.stringify(first),'ROOT_CHANGED_RETRY');signal.throwIfAborted()
 const finalClockObject=await read(clockId,'0x2::clock::Clock'),clock=decode(Clock,finalClockObject.bytes)
 check(clock.id===clockId&&finalClockObject.raw.owner.Shared?.initialSharedVersion==='1'
  &&BigInt(clock.timestamp_ms)>=BigInt(initialClock.timestamp_ms)&&BigInt(finalClockObject.reference.version)>=BigInt(clockObject.reference.version)
  &&(finalClockObject.reference.version!==clockObject.reference.version||finalClockObject.reference.digest===clockObject.reference.digest),'CLOCK')
 const shared=(o:typeof hostObject)=>{const birth=o.raw.owner.Shared!.initialSharedVersion;check(BigInt(birth)>0n&&BigInt(birth)<=BigInt(o.reference.version),'SHARED_BIRTH');return{objectId:o.reference.objectId,initialSharedVersion:birth,mutable:false as const}}
 return{format:'native-public-read-v2' as const,soulId,reception:first,hostId:host.id,stateId:state.id,contentId:state.content,
  ownerAddress:kiosk.owner,accountReference,hostReference:hostObject.reference,kioskReference:kioskObject.reference,libraryReference:libraryObject.reference,recordReference,record,recordIndex:index,namespace,recordIndices:library.entries.map(e=>Number(e.index)),recordSummaries,recordStart:start,nextRecordStart:start+25<library.entries.length?start+25:null,clockTimestampMs:clock.timestamp_ms,
  shared:{kiosk:shared(kioskObject),host:shared(hostObject),clock:shared(finalClockObject)},
  requiresCurrentPaidEntryAndPolicyExecution:true as const,requiresQualifiedSourceAndFormatAdoption:true as const,notAuthorization:true as const}
}

export async function readNativePublicReadOverviewV2(input:{client:SuiGrpcClient;target:CanonicalNativeWorkbenchTarget;soulId:string;recordStart?:number;signal:AbortSignal}){
 return readView({...input,recordIndex:null,ownerViewer:undefined,grantSelection:undefined})
}

type NativePublicReadOverviewV2=Awaited<ReturnType<typeof readNativePublicReadOverviewV2>>
type NativePublicOwnerSourceViewV2=Pick<NativePublicReadOverviewV2,'soulId'|'ownerAddress'|'reception'|'hostReference'|'kioskReference'|'libraryReference'>
type NativePublicOwnerSourceRecordV2=Pick<NativePublicReadOverviewV2['recordSummaries'][number],'index'|'kind'|'name'|'version'>

/** The standard Root revision advances when a Native V2 handover clears the
 * Authorization generation. Bind the rendered record to the exact readset,
 * so a new custody generation requires a refreshed selection even if the
 * owner address and record index have returned to the same values. */
export function nativePublicOwnerSourceKeyV2(view:NativePublicOwnerSourceViewV2,record:NativePublicOwnerSourceRecordV2){
 const {revision,rootVersion,rootDigest}=view.reception
 return JSON.stringify([view.soulId,view.ownerAddress,revision,rootVersion,rootDigest,view.hostReference,view.kioskReference,view.libraryReference,
  record.index,record.kind,record.name,record.version])
}

export async function readNativePublicReadRecordV2(input:{client:SuiGrpcClient;target:CanonicalNativeWorkbenchTarget;soulId:string;recordIndex:number;signal:AbortSignal}){
 const index=input.recordIndex,view=await readView({...input,recordIndex:index,ownerViewer:undefined,grantSelection:undefined});check(view.record&&view.namespace!==null&&view.recordReference,'SELECTED_RECORD')
 return {...view,record:view.record,namespace:view.namespace,recordReference:view.recordReference,recordIndex:index}
}

/** Owner-only record selection with actual pinned owned Account/Kiosk pairing.
 * A current snapshot is not authority: the owner Seal policy rechecks it live. */
export async function readNativePublicOwnerRecordV2(input:{client:SuiGrpcClient;target:CanonicalNativeWorkbenchTarget;soulId:string;recordIndex:number;viewerAddress:string;signal:AbortSignal}){
 const index=input.recordIndex,viewer=input.viewerAddress
 check(/^0x[0-9a-f]{64}$/.test(viewer)&&BigInt(viewer)>0n,'OWNER')
 const view=await readView({...input,recordIndex:index,ownerViewer:viewer,grantSelection:undefined})
 check(view.record&&view.namespace!==null&&view.recordReference&&view.accountReference,'OWNER_SELECTED_RECORD')
 return {...view,record:view.record,namespace:view.namespace,recordReference:view.recordReference,accountReference:view.accountReference,recordIndex:index,
  requiresCurrentOwnerPolicyExecution:true as const,requiresCurrentPaidEntryAndPolicyExecution:false as const}
}

/** Select the actual grant-readable Record without pretending it has the paid
 * bit. This verifies no Grant: the separate current Authorization/Grant reader
 * and live grant Seal policy must still approve the particular viewer. */
export async function readNativePublicGrantRecordV2(input:{client:SuiGrpcClient;target:CanonicalNativeWorkbenchTarget;soulId:string;recordIndex:number;signal:AbortSignal}){
 const index=input.recordIndex,view=await readView({...input,recordIndex:index,ownerViewer:undefined,grantSelection:true})
 check(view.record&&view.namespace!==null&&view.recordReference,'GRANT_SELECTED_RECORD')
 return {...view,record:view.record,namespace:view.namespace,recordReference:view.recordReference,recordIndex:index,
  requiresCurrentGrantAndPolicyExecution:true as const,requiresCurrentPaidEntryAndPolicyExecution:false as const}
}
