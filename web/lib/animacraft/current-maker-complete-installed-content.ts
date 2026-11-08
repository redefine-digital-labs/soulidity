import { bcs,type BcsType } from '@mysten/sui/bcs'
import { sha256 } from '@noble/hashes/sha2.js'
import { deriveDynamicFieldID,toBase64,toHex } from '@mysten/sui/utils'
import { CanonicalNativeRecordBcs } from '../soulidity/canonical-native-workbench'
import { MoveEmptyStructBcs,moveEmptyStructBytes } from '../sui/move-empty-struct'
import { readHistoricalMoveObject } from '../sui/historical-object'
import { readPinnedMovePackageOrigins,type PinnedMovePackage } from '../sui/pinned-move-package'
import { readCurrentCompleteApplicationTree } from './current-maker-complete-application-tree'
import { CurrentCompleteIntentBcs,readCurrentCompleteArtifact } from './current-maker-complete-artifact'
import { readCurrentCompleteFinalEffects } from './current-maker-complete-effects'
import { parseCurrentCompletePacket } from './current-maker-complete-packet'
const A=bcs.Address,U=bcs.u64(),V=bcs.byteVector(),Table=bcs.struct('Table',{id:A,size:U})
export const CurrentCompleteContentBcs=bcs.struct('Content',{id:A,versions:Table,count:U,counts:Table,indices:Table,names_by_kind:Table,active:Table,attempts:Table})
const Name=bcs.struct('ContentName',{kind:bcs.u32(),name:bcs.string()})
const VersionKey=bcs.struct('ContentVersionKey',{kind:bcs.u32(),name:bcs.string(),version:U})
const Link=bcs.struct('Field',{id:A,name:bcs.struct('Wrapper',{name:MoveEmptyStructBcs}),value:A})
const RecordField=bcs.struct('Field',{id:A,name:U,value:CanonicalNativeRecordBcs})
const Namespace=bcs.struct('Namespace',{domain:V,schema:bcs.u16(),intent:V,kind:bcs.u32(),name:bcs.string()})
function check(v:unknown,code:string):asserts v {if(!v)throw Error(`CURRENT_COMPLETE_INSTALLED_CONTENT_${code}`)}
/** Actual original Content carrier, Records and durable lookup fields under
 * Application. Blob objects/leases, original descriptor op/scope and exact
 * Clock remain separate proofs. No payload/Seal/current-access authority. */
export async function readCurrentCompleteInstalledContent(input:Parameters<typeof readCurrentCompleteApplicationTree>[0]&{content:PinnedMovePackage}){
 const record=parseCurrentCompletePacket(input.record),application=structuredClone(input.application),content=structuredClone(input.content),{client,isCurrent}=input
 const applicationId=input.applicationId,context={...input,record,application,content,standard:structuredClone(input.standard),foundation:structuredClone(input.foundation),applicationId,artifactId:input.artifactId,soulId:input.soulId}
 const signal=AbortSignal.any([input.signal,AbortSignal.timeout(60000)]),guard=()=>{signal.throwIfAborted();check(isCurrent(),'STALE')}
 guard();await readCurrentCompleteApplicationTree({...context,signal});guard()
 const artifact=await readCurrentCompleteArtifact({...context,signal});guard()
 const final=await readCurrentCompleteFinalEffects({record,client,isCurrent,signal});guard()
 const app=await readPinnedMovePackageOrigins(client,application,signal);guard()
 const doc=await readPinnedMovePackageOrigins(client,content,signal);guard()
 const keyOrigin=app.get('character::ContentKey'),origin=app.get('character::Content'),nameOrigin=app.get('character::ContentName'),versionOrigin=app.get('character::ContentVersionKey'),recordOrigin=doc.get('document::Record');check(keyOrigin&&origin&&nameOrigin&&versionOrigin&&recordOrigin,'TYPE_ORIGINS_REQUIRED')
 const p=record.plan,read=async(id:string,type:string,owner:string)=>{const object=await readHistoricalMoveObject({client,effects:final.effects,transactionDigest:record.packet.digest,objectId:id,type,mode:'created',signal,maxBytes:128*1024});guard();check(object.object.owner.ObjectOwner===owner,'FIELD_OWNER');return object.bytes}
 const wrapper=`0x2::dynamic_object_field::Wrapper<${keyOrigin}::character::ContentKey>`,linkId=deriveDynamicFieldID(applicationId,wrapper,moveEmptyStructBytes()),linkBytes=await read(linkId,`0x2::dynamic_field::Field<${wrapper},0x2::object::ID>`,applicationId),link=Link.parse(linkBytes)
 check(Link.serialize(link).toBase64()===toBase64(linkBytes)&&link.id===linkId,'CONTENT_LINK')
 const bytes=await read(link.value,`${origin}::character::Content`,linkId),carrier=CurrentCompleteContentBcs.parse(bytes),n=String(p.initialContent.length),kinds=new Set(p.initialContent.map(c=>c.kind))
 check(CurrentCompleteContentBcs.serialize(carrier).toBase64()===toBase64(bytes)&&carrier.id===link.value&&carrier.count===n&&carrier.versions.size===n&&carrier.counts.size===n&&carrier.indices.size===n&&carrier.attempts.size===n&&carrier.names_by_kind.size===String(kinds.size)&&carrier.active.size==='0','CONTENT_COUNTS')
 const tableIds=[carrier.versions.id,carrier.counts.id,carrier.indices.id,carrier.attempts.id,carrier.names_by_kind.id,carrier.active.id]
 check(new Set([carrier.id,linkId,applicationId,...tableIds]).size===tableIds.length+3,'TABLE_ALIAS')
 const expected=new Map(tableIds.map(id=>[id,new Set<string>()]))
 const u64Field=async<T>(tableId:string,keyType:string,keyBytes:Uint8Array,codec:BcsType<T,any>,value:string)=>{
  const id=deriveDynamicFieldID(tableId,keyType,keyBytes),Field=bcs.struct('Field',{id:A,name:codec,value:U}),bytes=await read(id,`0x2::dynamic_field::Field<${keyType},u64>`,tableId),field=Field.parse(bytes)
  expected.get(tableId)!.add(id)
  check(Field.serialize(field).toBase64()===toBase64(bytes)&&field.id===id&&toHex(codec.serialize(field.name).toBytes())===toHex(keyBytes)&&field.value===value,'LOOKUP_FIELD');return id
 }
 const records=[]
 for(const [index,planned]of p.initialContent.entries()){
  const id=deriveDynamicFieldID(carrier.versions.id,'u64',U.serialize(index).toBytes()),bytes=await read(id,`0x2::dynamic_field::Field<u64,${recordOrigin}::document::Record>`,carrier.versions.id),field=RecordField.parse(bytes),r=field.value
  check(RecordField.serialize(field).toBase64()===toBase64(bytes)&&field.id===id&&field.name===String(index),'RECORD_FIELD')
  expected.get(carrier.versions.id)!.add(id)
  const rule=artifact.artifact.policy.initials.find(r=>r.kind===planned.kind&&r.name===planned.name);check(rule,'RULE_REQUIRED')
  const namespace=Namespace.serialize({domain:new TextEncoder().encode('soulidity-complete-content'),schema:1,intent:sha256(CurrentCompleteIntentBcs.serialize(artifact.artifact.intent).toBytes()),kind:planned.kind,name:planned.name}).toBytes()
  check(r.kind===planned.kind&&r.name===planned.name&&r.version==='0'&&!r.deleted&&!r.purged&&r.read_mask===rule.read_mask&&r.download_policy===rule.download_policy
   &&toHex(r.nonce)===p.nonce&&r.envelope.length>0&&r.envelope.length<=65536&&toHex(r.envelope)===toHex(new Uint8Array(planned.envelope))&&r.seal_namespace!==null&&toHex(r.seal_namespace)===toHex(namespace),'ORIGINAL_RECORD')
  check(r.reference.object===planned.blobObjectId&&toHex(r.reference.sha256)===planned.sha256&&BigInt(r.reference.bytes)>0n&&r.reference.certified_epoch<r.reference.end_epoch&&BigInt(r.created_at_ms)<=BigInt(final.checkpointTimestampMs),'REFERENCE_TIME')
  await u64Field(carrier.counts.id,`${nameOrigin}::character::ContentName`,Name.serialize({kind:r.kind,name:r.name}).toBytes(),Name,'1')
  await u64Field(carrier.indices.id,`${versionOrigin}::character::ContentVersionKey`,VersionKey.serialize({kind:r.kind,name:r.name,version:'0'}).toBytes(),VersionKey,String(index))
  await u64Field(carrier.attempts.id,'vector<u8>',V.serialize(sha256(namespace)).toBytes(),V,String(index))
  records.push({index:String(index),fieldId:id,record:r})
 }
 for(const kind of kinds)await u64Field(carrier.names_by_kind.id,'u32',bcs.u32().serialize(kind).toBytes(),bcs.u32(),String(p.initialContent.filter(c=>c.kind===kind).length))
 for(const [id,change]of final.effects.V2!.changedObjects){const owners=[change.inputState.Exist?.[1].ObjectOwner,change.outputState.ObjectWrite?.[1].ObjectOwner];for(const owner of owners)if(owner&&expected.has(owner))check(expected.get(owner)!.has(id),'UNPLANNED_CONTENT_FIELDS')}
 guard();return{transactionDigest:record.packet.digest,contentId:carrier.id,linkId,carrier,records,originalInstalledContentRecordsMatched:true as const,
  requiresOriginalDescriptorAndClockProof:true as const,requiresContentBlobInstallationAndLeaseProof:true as const,requiresPayloadSealAndNestedSemanticProof:true as const,
  notDeliveryReceipt:true as const,notCurrentAuthority:true as const,executionPackageVersion:'NOT_ATTESTED'as const}
}
