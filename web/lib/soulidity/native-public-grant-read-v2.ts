import {bcs} from '@mysten/sui/bcs'
import type {SuiGrpcClient} from '@mysten/sui/grpc'
import {deriveDynamicFieldID,normalizeStructTag,toBase64,toHex} from '@mysten/sui/utils'
import {sha256} from '@noble/hashes/sha2.js'
import {profileReadStep} from '@soulidity/sdk'
import {collectionCommandRaw} from '../collections/collection-command-plan'
import {historicalMoveObjectType} from '../sui/historical-object'
import {readPinnedMovePackage} from '../sui/pinned-move-package'
import {moveEmptyStructBytes,MoveEmptyStructBcs} from '../sui/move-empty-struct'
import {NativeInitialAuthorizationBcs} from './native-initial-children'
import {parseCanonicalNativeWorkbenchTarget,type CanonicalNativeWorkbenchTarget} from './canonical-native-workbench'
import {readNativePublicGrantRecordV2} from './native-public-read-record-v2'
export const NativePublicGrantV2Bcs=bcs.struct('Grant',{root:bcs.Address,version:bcs.u16(),sequence:bcs.u64(),issuer:bcs.Address,grantee:bcs.Address,scope:bcs.u64(),expiry:bcs.option(bcs.u64()),generation:bcs.u64()})
const Pointer=bcs.struct('Field',{id:bcs.Address,name:bcs.struct('Wrapper',{name:MoveEmptyStructBcs}),value:bcs.Address})
const GrantField=bcs.struct('Field',{id:bcs.Address,name:bcs.Address,value:NativePublicGrantV2Bcs})
const Clock=bcs.struct('Clock',{id:bcs.Address,timestamp_ms:bcs.u64()})
const clockId='0x'+'6'.padStart(64,'0')
function check(v:unknown,c:string):asserts v{if(!v)throw Error(`NATIVE_PUBLIC_GRANT_READ_V2_${c}`)}
function decode<C extends{parse(v:Uint8Array):any;serialize(v:any):{toBytes():Uint8Array}}>(c:C,bytes:Uint8Array):ReturnType<C['parse']>{const v=c.parse(bytes);check(toBase64(c.serialize(v).toBytes())===toBase64(bytes),'CANONICAL');return v}
/** Current actual Host/Record -> embedded State's typed Authorization -> exact
 * grantee row. A snapshot never grants decryption; live Seal policy rechecks
 * current custody, issuer, generation, scope and strict Clock expiry. No paid
 * Entry, Offer, Config, owner exemption or caller Grant DTO is accepted here.
 */
export async function readNativePublicGrantV2(input:{client:SuiGrpcClient;target:CanonicalNativeWorkbenchTarget;soulId:string;recordIndex:number;viewerAddress:string;signal:AbortSignal}){
 const {soulId,recordIndex,viewerAddress:viewer}=input,target=parseCanonicalNativeWorkbenchTarget(input.target)
 check(/^0x[0-9a-f]{64}$/.test(viewer)&&BigInt(viewer)>0n&&target.content,'VIEWER')
 const source=input.client,getObject=source.ledgerService.getObject.bind(source.ledgerService)
 let previousClock:{version:bigint;timestamp:bigint;digest:string}|null=null
 // Private to this query: Clock may advance across both coherent views and
 // the final expiry check, but it must never move backwards or equivocate.
 const client={core:{getChainIdentifier:source.core.getChainIdentifier.bind(source.core)},ledgerService:{getObject:async(...args:Parameters<typeof getObject>)=>{
  const [request]=args,result=await getObject(...args)
  if(request.objectId===clockId){
   const row=result.response.object;check(row?.bcs?.value&&typeof row.digest==='string'&&row.version!==undefined,'CLOCK_OBJECT')
   const raw=collectionCommandRaw({objectId:clockId,version:String(row.version),digest:row.digest,bcs:toBase64(row.bcs.value)}),move=raw.data.Move
   check(move&&historicalMoveObjectType(move.type)===normalizeStructTag('0x2::clock::Clock')&&raw.owner.Shared?.initialSharedVersion==='1','CLOCK_OBJECT')
   const clock=decode(Clock,new Uint8Array(move.contents));check(clock.id===clockId,'CLOCK_OBJECT')
   const current={version:BigInt(row.version),timestamp:BigInt(clock.timestamp_ms),digest:row.digest}
   check(!previousClock||current.version>=previousClock.version&&current.timestamp>=previousClock.timestamp&&(current.version!==previousClock.version||current.digest===previousClock.digest),'CLOCK_MONOTONIC')
   previousClock=current
  }
  return result
 }}} as unknown as SuiGrpcClient
 const signal=AbortSignal.any([input.signal,AbortSignal.timeout(45000)]),recordInput={client,target,soulId,recordIndex,signal}
 const view=await readNativePublicGrantRecordV2(recordInput)
 // This protocol's canonical scope_seal/memory/skills/assets are 1/2/4/8.
 // Additional scope bits require an explicit supported protocol adapter.
 check((BigInt(view.record.scope)&15n)===BigInt(view.record.scope),'UNSUPPORTED_SCOPE')
 const native=await readPinnedMovePackage(client,target.native,signal),content=await readPinnedMovePackage(client,target.content,signal),link=native.linkage.get(content.pin.originalPackageId)
 check(link?.upgradedId===content.pin.callablePackageId&&link.upgradedVersion===String(content.version),'DEPENDENCY')
 function type(pkg:typeof native,module:string,name:string){const origin=pkg.origins.get(`${module}::${name}`);check(origin,'ORIGIN');return normalizeStructTag(`${origin}::${module}::${name}`)}
 const observations=new Map<string,{type:string;version:string;digest:string}>()
 async function read(id:string,expected:string){
  const {response}=await profileReadStep(signal,()=>client.ledgerService.getObject({objectId:id,readMask:{paths:['object_id','version','digest','bcs']}}))
  const row=response.object;check(row?.bcs?.value&&typeof row.digest==='string'&&row.digest.length>0&&row.version!==undefined,'OBJECT')
  const raw=collectionCommandRaw({objectId:id,version:String(row.version),digest:row.digest,bcs:toBase64(row.bcs.value)}),move=raw.data.Move
  check(move&&historicalMoveObjectType(move.type)===normalizeStructTag(expected),'TYPE')
  const stamp={type:expected,version:String(row.version),digest:row.digest},prior=observations.get(id)
  check(!prior||JSON.stringify(prior)===JSON.stringify(stamp),'CHANGED_RETRY');observations.set(id,stamp)
  return{raw,bytes:new Uint8Array(move.contents),reference:{objectId:id,version:String(row.version),digest:row.digest}}
 }
 const wrapper=`0x2::dynamic_object_field::Wrapper<${type(native,'birth','AuthorizationKey')}>`,pointerId=deriveDynamicFieldID(view.stateId,wrapper,moveEmptyStructBytes())
 const pointerObject=await read(pointerId,`0x2::dynamic_field::Field<${wrapper},0x2::object::ID>`),pointer=decode(Pointer,pointerObject.bytes)
 check(pointer.id===pointerId&&!pointer.name.name.dummy_field&&pointerObject.raw.owner.ObjectOwner===view.stateId,'POINTER')
 const authObject=await read(pointer.value,type(content,'authorization','Authorization')),auth=decode(NativeInitialAuthorizationBcs,authObject.bytes)
 check(auth.id===pointer.value&&authObject.raw.owner.ObjectOwner===pointerId&&auth.root===soulId&&auth.controller.root===soulId&&auth.controller.parent===view.stateId&&normalizeStructTag(auth.controller.operator.name)===type(native,'birth','ContentOperator'),'CONTROLLER')
 check(new Set([soulId,view.hostId,view.stateId,view.contentId,pointerId,auth.id,auth.grants.id]).size===7,'ALIASES')
 const grantId=deriveDynamicFieldID(auth.grants.id,'address',bcs.Address.serialize(viewer).toBytes()),grantObject=await read(grantId,`0x2::dynamic_field::Field<address,${type(content,'authorization','Grant')}>`),field=decode(GrantField,grantObject.bytes),grant=field.value
 check(field.id===grantId&&field.name===viewer&&grantObject.raw.owner.ObjectOwner===auth.grants.id&&BigInt(auth.grants.size)>0n,'GRANT_FIELD')
 check(BigInt(auth.count)>0n&&BigInt(auth.count)<=BigInt(auth.capacity)&&BigInt(auth.capacity)<=10000n,'AUTH_COUNTS')
 check(grant.version===1&&BigInt(grant.scope)>0n&&(BigInt(grant.scope)&15n)===BigInt(grant.scope)&&grant.root===soulId&&grant.grantee===viewer&&BigInt(grant.sequence)<BigInt(auth.next_sequence),'GRANT_IDENTITY')
 check(grant.issuer===view.ownerAddress&&grant.generation===auth.generation&&(BigInt(grant.scope)&BigInt(view.record.scope))===BigInt(view.record.scope),'GRANT_LIVE')
 for(const[id,stamp]of observations)await read(id,stamp.type)
 const latest=await readNativePublicGrantRecordV2(recordInput)
 const stable=(v:typeof view)=>{const{clockTimestampMs:_,...rest}=v;return JSON.stringify(rest)}
 check(stable(latest)===stable(view),'HOST_RECORD_CHANGED')
 const clockObject=await read(clockId,'0x2::clock::Clock'),clock=decode(Clock,clockObject.bytes)
 check(clock.id===clockId&&clockObject.raw.owner.Shared?.initialSharedVersion==='1'&&BigInt(clock.timestamp_ms)>=BigInt(latest.clockTimestampMs),'CLOCK')
 check(grant.expiry===null||BigInt(grant.expiry)>BigInt(clock.timestamp_ms),'EXPIRED')
 signal.throwIfAborted()
 const grantBytes=NativePublicGrantV2Bcs.serialize(grant).toBytes(),domain=new TextEncoder().encode('soulidity-grant-v1'),hashBytes=new Uint8Array(domain.length+grantBytes.length);hashBytes.set(domain);hashBytes.set(grantBytes,domain.length)
 return {...view,clockTimestampMs:clock.timestamp_ms,viewerAddress:viewer,authorizationReference:authObject.reference,grantReference:grantObject.reference,authorizationGeneration:auth.generation,grant,grantHash:toHex(sha256(hashBytes)),requiresCurrentGrantAndPolicyExecution:true as const,notAuthorization:true as const}
}
