import {bcs} from '@mysten/sui/bcs'
import {Transaction} from '@mysten/sui/transactions'
import {deriveDynamicFieldID,fromBase64,toBase64,toHex} from '@mysten/sui/utils'
import {sha256} from '@noble/hashes/sha2.js'
import type {SuiGrpcClient} from '@mysten/sui/grpc'
import {readHistoricalMoveObject} from '../../sui/historical-object'
import {ManagementItemBcs,ManagementSourceBcs,ManagementDefinitionBcs} from './application-bcs'
import {parseEquipmentManagementRecord,verifyEquipmentManagementSignature,type EquipmentManagementRecord} from './equipment-record'
import {readEquipmentFinalizedExecution} from './equipment-execution'
function check(v:unknown,c:string):asserts v{if(!v)throw Error(`MANAGEMENT_EQUIPMENT_ITEMS_${c}`)}
/** Only original effects-selected Item/ItemKey relations. Original Root/App/slot
 * membership and qualified source invariants remain separate obligations; this
 * cannot establish a complete successful equipment operation by itself. */
export async function readEquipmentHistoricalItems(input:{client:SuiGrpcClient;record:EquipmentManagementRecord;signal:AbortSignal}){
 const record=parseEquipmentManagementRecord(input.record),p=record.plan,signal=AbortSignal.any([input.signal,AbortSignal.timeout(60000)])
 if(record.packet.signature!==null)await verifyEquipmentManagementSignature(record,input.client)
 const execution=await readEquipmentFinalizedExecution({...input,record,signal})
 if(execution.status!=='FINALIZED_EXECUTION')return{execution,items:null,completeBusinessOutputVerified:false as const}
 const effects=execution.effects,Key=bcs.struct('ItemKey',{id:bcs.Address}),wrapper=`0x2::dynamic_object_field::Wrapper<${p.target.application.originalPackageId}::character::ItemKey>`
 const Field=bcs.struct('Field',{id:bcs.Address,name:bcs.struct('Wrapper',{name:Key}),value:bcs.Address})
 const common={client:input.client,effects,transactionDigest:record.packet.digest,signal,maxBytes:256*1024}
 function fieldId(id:string){return deriveDynamicFieldID(p.applicationId,wrapper,Key.serialize({id}).toBytes())}
 async function mapping(id:string,mode:'input'|'created'){
  const objectId=fieldId(id),row=await readHistoricalMoveObject({...common,objectId,type:`0x2::dynamic_field::Field<${wrapper},0x2::object::ID>`,mode}),value=Field.parse(row.bytes)
  check(Field.serialize(value).toBase64()===toBase64(row.bytes)&&value.id===objectId&&value.name.name.id===id&&value.value===id&&row.object.owner.ObjectOwner===p.applicationId,'FIELD_BINDING')
  return row.reference
 }
 async function item(id:string){
  const args={...common,objectId:id,type:`${p.target.model.originalPackageId}::components::Item`}
  const before=await readHistoricalMoveObject({...args,mode:'input'}),after=await readHistoricalMoveObject({...args,mode:'mutated'}),value=ManagementItemBcs.parse(before.bytes)
  check(ManagementItemBcs.serialize(value).toBase64()===toBase64(before.bytes)&&value.id===id&&value.source.definition.rights===2&&toHex(sha256(ManagementDefinitionBcs.serialize(value.source.definition).toBytes()))===toHex(value.source.definition_hash)&&toBase64(before.bytes)===toBase64(after.bytes),'ITEM_CONSERVATION')
  return{before,after,sourceHash:toHex(sha256(ManagementSourceBcs.serialize(value.source).toBytes()))}
 }
 const incoming=[] as Array<{id:string;sourceHash:string;inputVersion:string;inputDigest:string;outputVersion:string;outputDigest:string;destination:'ORIGINAL_APPLICATION'}>
 const outgoing=[] as Array<{id:string;sourceHash:string;inputVersion:string;inputDigest:string;outputVersion:string;outputDigest:string;destination:'ORIGINAL_AUTHOR'}>
 if(p.action.kind!=='REMOVE'){
  const id=p.action.itemId,proof=await item(id),data=Transaction.from(fromBase64(record.packet.bytes)).getData(),refs=data.inputs.flatMap(row=>row.Object?.ImmOrOwnedObject?.objectId===id?[row.Object.ImmOrOwnedObject]:[])
  check(refs.length===1&&String(proof.before.reference.version)===refs[0].version&&proof.before.reference.digest===refs[0].digest&&proof.before.object.owner.AddressOwner===p.author,'INCOMING_ORIGINAL_INPUT')
  check(proof.after.object.owner.ObjectOwner===fieldId(id),'INCOMING_DESTINATION');await mapping(id,'created')
  incoming.push({id,sourceHash:proof.sourceHash,inputVersion:String(proof.before.reference.version),inputDigest:proof.before.reference.digest,outputVersion:String(proof.after.reference.version),outputDigest:proof.after.reference.digest,destination:'ORIGINAL_APPLICATION'})
 }
 if(p.previous.kind==='ITEM'){
  const id=p.previous.itemId,proof=await item(id),field=fieldId(id);await mapping(id,'input')
  check(proof.before.object.owner.ObjectOwner===field&&proof.after.object.owner.AddressOwner===p.author,'OUTGOING_DESTINATION')
  const changes=effects.V2!.changedObjects.filter(([objectId])=>objectId===field)
  check(changes.length===1&&changes[0][1].idOperation.$kind==='Deleted'&&changes[0][1].outputState.$kind==='NotExist','OUTGOING_FIELD_DELETION')
  outgoing.push({id,sourceHash:proof.sourceHash,inputVersion:String(proof.before.reference.version),inputDigest:proof.before.reference.digest,outputVersion:String(proof.after.reference.version),outputDigest:proof.after.reference.digest,destination:'ORIGINAL_AUTHOR'})
 }
 signal.throwIfAborted()
 return{execution,items:{status:'ORIGINAL_ITEM_RELATIONS_VERIFIED' as const,transactionDigest:record.packet.digest,checkpoint:execution.checkpoint,incoming,outgoing,
  noDeclaredTransferableItemObligation:incoming.length===0&&outgoing.length===0,requiresOriginalRootApplicationSlotProof:true as const,requiresReferenceAndBoundInventoryProof:true as const,requiresQualifiedOriginalSource:true as const,completeBusinessOutputVerified:false as const},completeBusinessOutputVerified:false as const}
}
