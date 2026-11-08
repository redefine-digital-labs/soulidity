import {bcs} from '@mysten/sui/bcs'
import {deriveDynamicFieldID,fromBase64,toBase64} from '@mysten/sui/utils'
import {MAINNET_GENESIS_DIGEST} from '../../animacraft/mainnet-chain'
import {readHistoricalMoveObject} from '../../sui/historical-object'
import {readHistoricalChildThroughOwnedParent} from '../../sui/historical-owned-parent'
import {MoveEmptyStructBcs,moveEmptyStructBytes} from '../../sui/move-empty-struct'
import {ManagementApplicationBcs,ManagementCompositionBcs,ManagementPartBcs,ManagementStoredBindingBcs,ManagementLayoutBcs} from './application-bcs'
import {parseEquipmentManagementRecord} from './equipment-record'
import {readEquipmentHistoricalRootApplication} from './equipment-historical-root-application'
function check(v:unknown,c:string):asserts v{if(!v)throw Error(`MANAGEMENT_EQUIPMENT_SLOT_${c}`)}
/** Effects-selected original slot with actual historical CompositionKey mapping.
 * Full unaffected slot/REF/BOUND inventories, semantic recipe and outer custody
 * remain mandatory; source-qualified parent-commit invariants are not granted
 * by a metadata relation or by a caller-supplied Composition object id. */
export async function readEquipmentHistoricalSlot(input:Parameters<typeof readEquipmentHistoricalRootApplication>[0]&{compositionId:string;maxHops?:number}){
 const record=parseEquipmentManagementRecord(input.record),p=record.plan,id=input.compositionId
 check(typeof id==='string'&&/^0x[0-9a-f]{64}$/.test(id)&&!/^0x0+$/.test(id)&&![p.soulId,p.applicationId,p.accountId,p.kioskId,p.author,...[p.target.application,p.target.model].flatMap(pkg=>[pkg.originalPackageId,pkg.callablePackageId])].includes(id),'COMPOSITION_ID')
 const signal=AbortSignal.any([input.signal,AbortSignal.timeout(60000)]),evidence=await readEquipmentHistoricalRootApplication({...input,record,signal})
 if(!evidence.rootApplication)return{...evidence,slot:null}
 const execution=evidence.execution;check(execution.status==='FINALIZED_EXECUTION','FINALITY')
 const app=p.target.application.originalPackageId,wrapper=`0x2::dynamic_object_field::Wrapper<${app}::character::CompositionKey>`,fieldId=deriveDynamicFieldID(p.applicationId,wrapper,moveEmptyStructBytes())
 check(!execution.effects.V2!.changedObjects.some(([objectId])=>objectId===fieldId),'PERMANENT_MAPPING_CHANGED')
 const mapping=await readHistoricalChildThroughOwnedParent({client:input.client,anchorEffects:execution.effects,anchorTransactionDigest:record.packet.digest,anchorCheckpoint:execution.checkpoint,anchorMode:'input',rootId:p.applicationId,rootType:`${app}::character::ApplicationState`,rootOwnerId:evidence.rootApplication.moduleFieldId,childId:fieldId,childType:`0x2::dynamic_field::Field<${wrapper},0x2::object::ID>`,chainIdentifier:p.target.chainIdentifier,genesisDigest:MAINNET_GENESIS_DIGEST,signal,maxHops:input.maxHops,assertRoot(bytes){
  const value=ManagementApplicationBcs.parse(bytes);check(ManagementApplicationBcs.serialize(value).toBase64()===toBase64(bytes)&&value.id===p.applicationId&&value.root===p.soulId&&BigInt(value.revision)<=BigInt(p.expectedApplication)&&value.operator.name===evidence.rootApplication!.applicationBefore.operator.name,'APP_HISTORY')
 }})
 const Mapping=bcs.struct('Field',{id:bcs.Address,name:bcs.struct('Wrapper',{name:MoveEmptyStructBcs}),value:bcs.Address}),mapped=Mapping.parse(mapping.bytes)
 check(mapping.reference.created&&Mapping.serialize(mapped).toBase64()===toBase64(mapping.bytes)&&mapped.id===fieldId&&mapped.name.name.dummy_field===false&&mapped.value===id,'COMPOSITION_MAPPING')
 const common={client:input.client,effects:execution.effects,transactionDigest:record.packet.digest,signal,maxBytes:256*1024}
 const old=await readHistoricalMoveObject({...common,objectId:id,type:`${app}::character::Composition`,mode:'input'}),written=await readHistoricalMoveObject({...common,objectId:id,type:`${app}::character::Composition`,mode:'mutated'})
 const before=ManagementCompositionBcs.parse(old.bytes),after=ManagementCompositionBcs.parse(written.bytes)
 check(ManagementCompositionBcs.serialize(before).toBase64()===toBase64(old.bytes)&&ManagementCompositionBcs.serialize(after).toBase64()===toBase64(written.bytes)&&before.id===id&&after.id===id&&old.object.owner.ObjectOwner===fieldId&&written.object.owner.ObjectOwner===fieldId&&BigInt(after.revision)===BigInt(before.revision)+1n,'COMPOSITION_BINDING')
 const invariant=(value:typeof before)=>ManagementCompositionBcs.serialize({...value,revision:'0',slots:{...value.slots,size:'0'}}).toBase64()
 check(invariant(before)===invariant(after),'UNRELATED_COMPOSITION_CHANGED')
 const parts=before.assembly.parts.map(part=>ManagementPartBcs.serialize(part).toBase64())
 check(parts.length<=512&&new Set(parts).size===parts.length&&parts[Number(p.partIndex)]===p.partBcs&&BigInt(before.slots.size)<=BigInt(parts.length)&&BigInt(after.slots.size)<=BigInt(parts.length),'PART_INDEX_OR_COUNTS')
 const expectedCount=BigInt(before.slots.size)+(p.action.kind==='ATTACH'?1n:p.action.kind==='REMOVE'?-1n:0n)
 check(expectedCount>=0n&&String(expectedCount)===after.slots.size,'SLOT_COUNT')
 const partType=`${p.target.model.originalPackageId}::assembly::PartKey`,type=`0x2::dynamic_field::Field<${partType},${app}::character::StoredBinding>`,Field=bcs.struct('Field',{id:bcs.Address,name:ManagementPartBcs,value:ManagementStoredBindingBcs})
 const slotId=deriveDynamicFieldID(before.slots.id,partType,fromBase64(p.partBcs)),changes=execution.effects.V2!.changedObjects.filter(([objectId])=>objectId===slotId)
 check(changes.length===1,'SLOT_EFFECT_REQUIRED');const change=changes[0][1]
 async function binding(objectId:string,partBcs:string,mode:'input'|'created'|'mutated'){
  const object=await readHistoricalMoveObject({...common,objectId,type,mode}),field=Field.parse(object.bytes)
  check(Field.serialize(field).toBase64()===toBase64(object.bytes)&&field.id===objectId&&ManagementPartBcs.serialize(field.name).toBase64()===partBcs&&object.object.owner.ObjectOwner===before.slots.id&&[field.value.reference,field.value.bound,field.value.item].filter(v=>v!==null).length===1,'SLOT_FIELD')
  return field.value
 }
 let inputBinding:ReturnType<typeof ManagementStoredBindingBcs.parse>|null=null,outputBinding:ReturnType<typeof ManagementStoredBindingBcs.parse>|null=null
 if(p.action.kind==='ATTACH')check(change.inputState.$kind==='NotExist'&&change.idOperation.$kind==='Created','ATTACH_ABSENCE')
 else{
  inputBinding=await binding(slotId,p.partBcs,'input')
  check(p.previous.kind==='ITEM'?inputBinding.item===p.previous.itemId&&inputBinding.reference===null&&inputBinding.bound===null:p.previous.kind==='BOUND'?inputBinding.bound!==null&&inputBinding.item===null&&inputBinding.reference===null:p.previous.kind==='REFERENCE'&&inputBinding.reference!==null&&inputBinding.item===null&&inputBinding.bound===null,'ORIGINAL_PREVIOUS_BINDING')
 }
 if(p.action.kind==='REMOVE')check(change.idOperation.$kind==='Deleted'&&change.outputState.$kind==='NotExist','REMOVE_DELETION')
 else{
  outputBinding=await binding(slotId,p.partBcs,p.action.kind==='ATTACH'?'created':'mutated')
  check(outputBinding.item===p.action.itemId&&outputBinding.reference===null&&outputBinding.bound===null&&ManagementLayoutBcs.serialize(outputBinding.layout).toBase64()===ManagementLayoutBcs.serialize(p.action.layout).toBase64(),'OUTPUT_BINDING')
 }
 for(const part of parts){if(part===p.partBcs)continue;const objectId=deriveDynamicFieldID(before.slots.id,partType,fromBase64(part)),matches=execution.effects.V2!.changedObjects.filter(([id])=>id===objectId);check(matches.length<=1,'OTHER_SLOT_ALIAS');if(matches.length){const a=await binding(objectId,part,'input'),b=await binding(objectId,part,'mutated');check(ManagementStoredBindingBcs.serialize(a).toBase64()===ManagementStoredBindingBcs.serialize(b).toBase64(),'OTHER_SLOT_CHANGED')}}
 signal.throwIfAborted()
 return{...evidence,slot:{status:'ORIGINAL_EQUIPMENT_SLOT_RELATIONS_VERIFIED' as const,transactionDigest:record.packet.digest,checkpoint:execution.checkpoint,compositionBefore:before,compositionAfter:after,compositionKeyHistory:mapping,slotId,partBcs:p.partBcs,partIndex:p.partIndex,inputBinding,outputBinding,
  originalTargetSlotBindingVerified:true as const,requiresAllUntouchedInventoryProof:true as const,requiresReferenceAndBoundSourceProof:true as const,requiresAdapterEligibilityProof:true as const,requiresSourceSemanticCommitmentProof:true as const,requiresQualifiedParentCommitInvariant:true as const,completeBusinessOutputVerified:false as const},completeBusinessOutputVerified:false as const}
}
