import { bcs } from '@mysten/sui/bcs'
import { sha3_256 } from '@noble/hashes/sha3.js'
import { deriveDynamicFieldID,normalizeStructTag,toBase64,toHex } from '@mysten/sui/utils'
import { CanonicalSoulBcs } from '../soulidity/canonical-native-workbench'
import { ManagementApplicationBcs } from '../soulidity/management/application-bcs'
import { readHistoricalMoveObject } from '../sui/historical-object'
import { readPinnedMovePackageOrigins,type PinnedMovePackage } from '../sui/pinned-move-package'
import { readCurrentMakerCreatedSoulProof } from './current-maker-result-proof'
import { readCurrentCompleteFinalEffects } from './current-maker-complete-effects'
import { readCurrentCompleteArtifact } from './current-maker-complete-artifact'
import { parseCurrentCompletePacket } from './current-maker-complete-packet'
const Link=bcs.struct('Field',{id:bcs.Address,name:bcs.struct('Wrapper',{name:bcs.struct('ModuleKey',{name:bcs.byteVector()})}),value:bcs.Address})
function check(v:unknown,code:string):asserts v {if(!v)throw Error(`CURRENT_COMPLETE_APPLICATION_TREE_${code}`)}
/** Original Standard root -> typed Application module -> Artifact tree path.
 * Standard body_hash is SHA3 of ApplicationState bytes. Its semantic_hash binds
 * nested state under a different commitment and is deliberately NOT claimed
 * verified here; Application recipe_hash is not Artifact semantic recipe hash. */
export async function readCurrentCompleteApplicationTree(input:Parameters<typeof readCurrentCompleteArtifact>[0]&{standard:PinnedMovePackage}){
 const record=parseCurrentCompletePacket(input.record),standard=structuredClone(input.standard),application=structuredClone(input.application),soulId=input.soulId,applicationId=input.applicationId,{client,isCurrent}=input
 const signal=AbortSignal.any([input.signal,AbortSignal.timeout(60000)]),guard=()=>{signal.throwIfAborted();check(isCurrent(),'STALE')}
 guard();const artifact=await readCurrentCompleteArtifact({...input,record,application,signal});guard()
 const final=await readCurrentCompleteFinalEffects({record,client,isCurrent,signal});guard()
 const std=await readPinnedMovePackageOrigins(client,standard,signal);guard()
 const app=await readPinnedMovePackageOrigins(client,application,signal);guard()
 const manufacturing=await readPinnedMovePackageOrigins(client,record.plan.target.manufacturing,signal);guard()
 const runtime=await readPinnedMovePackageOrigins(client,record.plan.target.runtime,signal);guard()
 const soulOrigin=std.get('soul::Soul'),keyOrigin=std.get('soul::ModuleKey'),stateOrigin=app.get('character::ApplicationState'),witnessOrigin=app.get('character::ApplicationWitness'),operatorOrigin=runtime.get('application_operator::ApplicationOperator'),productOrigin=manufacturing.get('maker_catalog::Product'),producerOrigin=manufacturing.get('maker_catalog::SoulProducer')
 check(soulOrigin&&keyOrigin&&stateOrigin&&witnessOrigin&&operatorOrigin&&productOrigin&&producerOrigin,'TYPE_ORIGINS_REQUIRED')
 const p=record.plan,witness=`${witnessOrigin}::character::ApplicationWitness`,stateType=`${stateOrigin}::character::ApplicationState`
 const created=await readCurrentMakerCreatedSoulProof({client,effects:final.effects,transactionDigest:record.packet.digest,standard,signal,isCurrent,expected:{soulId,actor:p.actor,makerId:p.maker.productId,version:p.maker.version,policyHash:p.maker.policyHash,name:p.name,
  producerType:`${producerOrigin}::maker_catalog::SoulProducer`,sourceType:`${productOrigin}::maker_catalog::Product<${p.target.paymentCoinType}>`}});guard()
 const rootObject=await readHistoricalMoveObject({client,effects:final.effects,transactionDigest:record.packet.digest,objectId:soulId,type:`${soulOrigin}::soul::Soul`,mode:'created',signal,maxBytes:256*1024});guard()
 const root=CanonicalSoulBcs.parse(rootObject.bytes),name=new TextEncoder().encode('animacraft'),descriptors=root.modules.filter(d=>normalizeStructTag(d.namespace.name)===normalizeStructTag(witness)&&toHex(d.name)===toHex(name))
 check(descriptors.length===1,'UNIQUE_MODULE_DESCRIPTOR')
 const descriptor=descriptors[0];check(descriptor.object===applicationId&&normalizeStructTag(descriptor.value_type.name)===normalizeStructTag(stateType)&&descriptor.schema===3&&!descriptor.removable&&descriptor.body_hash.length===32&&descriptor.semantic_hash.length===32,'MODULE_DESCRIPTOR')
 const wrapper=`0x2::dynamic_object_field::Wrapper<${keyOrigin}::soul::ModuleKey<${witness}>>`,linkId=deriveDynamicFieldID(soulId,wrapper,bcs.byteVector().serialize(name).toBytes())
 const linkObject=await readHistoricalMoveObject({client,effects:final.effects,transactionDigest:record.packet.digest,objectId:linkId,type:`0x2::dynamic_field::Field<${wrapper},0x2::object::ID>`,mode:'created',signal,maxBytes:1024});guard()
 const link=Link.parse(linkObject.bytes);check(Link.serialize(link).toBase64()===toBase64(linkObject.bytes)&&link.id===linkId&&toHex(link.name.name.name)===toHex(name)&&link.value===applicationId&&linkObject.object.owner.ObjectOwner===soulId,'MODULE_LINK')
 const stateObject=await readHistoricalMoveObject({client,effects:final.effects,transactionDigest:record.packet.digest,objectId:applicationId,type:stateType,mode:'created',signal,maxBytes:256*1024});guard()
 const state=ManagementApplicationBcs.parse(stateObject.bytes)
 check(ManagementApplicationBcs.serialize(state).toBase64()===toBase64(stateObject.bytes)&&state.id===applicationId&&state.root===soulId&&state.revision==='0'&&state.recipe_hash.length===32
  &&normalizeStructTag(state.operator.name)===normalizeStructTag(`${operatorOrigin}::application_operator::ApplicationOperator`)&&stateObject.object.owner.ObjectOwner===linkId,'APPLICATION_BODY_OWNER')
 check(toHex(sha3_256(stateObject.bytes))===toHex(descriptor.body_hash),'STANDARD_BODY_HASH')
 guard();return{transactionDigest:record.packet.digest,soulId,applicationId,artifactId:artifact.artifact.id,linkId,state,descriptor,creatingRecipient:created.creatingRecipient,
  originalApplicationSoulArtifactTreeMatched:true as const,requiresNestedSemanticCommitmentProof:true as const,requiresInstalledComponentsAndContentProof:true as const,requiresCurrentCustodyAndWorkbenchProof:true as const,requiresQualifiedRendererProof:true as const,
  notDeliveryReceipt:true as const,notCurrentAuthority:true as const,executionPackageVersion:'NOT_ATTESTED'as const}
}
