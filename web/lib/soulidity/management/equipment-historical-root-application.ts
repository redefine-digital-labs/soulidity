import {bcs} from '@mysten/sui/bcs'
import {deriveDynamicFieldID,normalizeStructTag,toBase64,toHex} from '@mysten/sui/utils'
import {sha3_256} from '@noble/hashes/sha3.js'
import {deriveKioskItemFieldId} from '@soulidity/sdk'
import {readHistoricalMoveObject} from '../../sui/historical-object'
import {CanonicalSoulBcs} from '../canonical-native-workbench'
import {ManagementApplicationBcs} from './application-bcs'
import {parseEquipmentManagementRecord} from './equipment-record'
import {readEquipmentHistoricalItems} from './equipment-historical-items'
function check(v:unknown,c:string):asserts v{if(!v)throw Error(`MANAGEMENT_EQUIPMENT_ROOT_APPLICATION_${c}`)}
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b)
type Root=ReturnType<typeof CanonicalSoulBcs.parse>
const moduleKey=(row:Root['modules'][number])=>`${normalizeStructTag(row.namespace.name)}:${toHex(row.name)}`
/** Original effects-authenticated Root descriptor and App-body relation only.
 * Untouched typed module fields still need historical membership proof, not a
 * requirement that they appear in this transaction's changedObjects. No source
 * semantic commitment or whole business success is inferred from body_hash. */
export async function readEquipmentHistoricalRootApplication(input:Parameters<typeof readEquipmentHistoricalItems>[0]&{standardTypeOrigin:string}){
 check(typeof input.standardTypeOrigin==='string'&&/^0x[0-9a-f]{64}$/.test(input.standardTypeOrigin)&&!/^0x0+$/.test(input.standardTypeOrigin),'STANDARD_ORIGIN')
 const record=parseEquipmentManagementRecord(input.record),p=record.plan,standard=input.standardTypeOrigin,signal=AbortSignal.any([input.signal,AbortSignal.timeout(60000)])
 const evidence=await readEquipmentHistoricalItems({...input,record,signal})
 if(!evidence.items)return{...evidence,rootApplication:null}
 const execution=evidence.execution;check(execution.status==='FINALIZED_EXECUTION','FINALITY')
 const common={client:input.client,effects:execution.effects,transactionDigest:record.packet.digest,signal,maxBytes:256*1024},rootType=`${standard}::soul::Soul`
 const rootInput=await readHistoricalMoveObject({...common,objectId:p.soulId,type:rootType,mode:'input'}),rootOutput=await readHistoricalMoveObject({...common,objectId:p.soulId,type:rootType,mode:'mutated'})
 const before=CanonicalSoulBcs.parse(rootInput.bytes),after=CanonicalSoulBcs.parse(rootOutput.bytes),kioskItem=deriveKioskItemFieldId(p.kioskId,p.soulId)
 check(CanonicalSoulBcs.serialize(before).toBase64()===toBase64(rootInput.bytes)&&CanonicalSoulBcs.serialize(after).toBase64()===toBase64(rootOutput.bytes),'ROOT_CANONICAL')
 check(rootInput.object.owner.ObjectOwner===kioskItem&&rootOutput.object.owner.ObjectOwner===kioskItem&&before.id===p.soulId&&after.id===p.soulId&&before.schema===1&&after.schema===1&&!before.editing&&!after.editing&&before.revision===p.expectedRoot&&after.revision===String(BigInt(p.expectedRoot)+1n)&&before.name===after.name&&equal(before.origin,after.origin),'ORIGINAL_ROOT')
 const app=p.target.application.originalPackageId,namespace=normalizeStructTag(`${app}::character::ApplicationWitness`),appName='616e696d616372616674'
 function descriptor(root:Root){
  check(root.modules.length<=64&&new Set(root.modules.map(moduleKey)).size===root.modules.length,'MODULE_ALIAS')
  const rows=root.modules.filter(row=>normalizeStructTag(row.namespace.name)===namespace&&toHex(row.name)===appName)
  check(rows.length===1,'APPLICATION_MODULE');const row=rows[0]
  check(row.object===p.applicationId&&row.schema===3&&!row.removable&&normalizeStructTag(row.value_type.name)===normalizeStructTag(`${app}::character::ApplicationState`)&&row.body_hash.length===32&&row.semantic_hash.length===32,'APPLICATION_DESCRIPTOR')
  return row
 }
 const descriptorBefore=descriptor(before),descriptorAfter=descriptor(after)
 const stable=(row:typeof descriptorBefore)=>({namespace:row.namespace,name:row.name,value_type:row.value_type,object:row.object,schema:row.schema,removable:row.removable})
 check(equal(stable(descriptorBefore),stable(descriptorAfter)),'MODULE_IDENTITY_CHANGED')
 const unaffected=(root:Root)=>root.modules.filter(row=>moduleKey(row)!==moduleKey(descriptorBefore)).slice().sort((a,b)=>moduleKey(a).localeCompare(moduleKey(b)))
 check(before.modules.length===after.modules.length&&equal(unaffected(before),unaffected(after)),'UNRELATED_MODULE_CHANGED')
 const wrapper=`0x2::dynamic_object_field::Wrapper<${standard}::soul::ModuleKey<${app}::character::ApplicationWitness>>`,moduleField=deriveDynamicFieldID(p.soulId,wrapper,bcs.byteVector().serialize(new TextEncoder().encode('animacraft')).toBytes())
 async function application(mode:'input'|'mutated',expectedRevision:string,descriptor:typeof descriptorBefore){
  const object=await readHistoricalMoveObject({...common,objectId:p.applicationId,type:`${app}::character::ApplicationState`,mode}),value=ManagementApplicationBcs.parse(object.bytes)
  check(ManagementApplicationBcs.serialize(value).toBase64()===toBase64(object.bytes)&&object.object.owner.ObjectOwner===moduleField&&value.id===p.applicationId&&value.root===p.soulId&&value.revision===expectedRevision&&value.recipe_hash.length===32,'APPLICATION_BINDING')
  check(toHex(sha3_256(object.bytes))===toHex(descriptor.body_hash),'APPLICATION_BODY_COMMITMENT')
  return{value,reference:object.reference}
 }
 const appBefore=await application('input',p.expectedApplication,descriptorBefore),appAfter=await application('mutated',String(BigInt(p.expectedApplication)+1n),descriptorAfter)
 check(equal(appBefore.value.operator,appAfter.value.operator),'OPERATOR_CHANGED');signal.throwIfAborted()
 return{...evidence,rootApplication:{status:'ORIGINAL_ROOT_APPLICATION_RELATIONS_VERIFIED' as const,transactionDigest:record.packet.digest,checkpoint:execution.checkpoint,
  rootBefore:before,rootAfter:after,applicationBefore:appBefore.value,applicationAfter:appAfter.value,rootInputReference:rootInput.reference,rootOutputReference:rootOutput.reference,applicationInputReference:appBefore.reference,applicationOutputReference:appAfter.reference,moduleFieldId:moduleField,
  rootApplicationBodyBindingVerified:true as const,requiresKioskAccountTreeProof:true as const,requiresModuleFieldHistoryProof:true as const,requiresCompositionAndSlotProof:true as const,requiresSourceSemanticCommitmentProof:true as const,requiresQualifiedOriginalSource:true as const,completeBusinessOutputVerified:false as const},completeBusinessOutputVerified:false as const}
}
