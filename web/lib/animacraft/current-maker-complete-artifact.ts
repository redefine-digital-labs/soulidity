import { bcs } from '@mysten/sui/bcs'
import { sha256 } from '@noble/hashes/sha2.js'
import { deriveDynamicFieldID,fromHex,normalizeStructTag,toBase64,toHex } from '@mysten/sui/utils'
import { readHistoricalMoveObject } from '../sui/historical-object'
import { moveEmptyStructBytes } from '../sui/move-empty-struct'
import { readPinnedMovePackageOrigins,type PinnedMovePackage } from '../sui/pinned-move-package'
import { ManagementSceneBcs,ManagementColorBcs,ManagementPagedSourcesBcs } from '../soulidity/management/application-bcs'
import { readCurrentCompleteFinalEffects } from './current-maker-complete-effects'
import { readCurrentCompleteOutputPolicy } from './current-maker-complete-output-policy'
import { CurrentMakerOutputPolicyBcs } from './current-maker-complete-version-history'
import { CurrentCompletePrimaryReceiptBcs,readCurrentCompletePaymentEvents } from './current-maker-complete-payments'
import { parseCurrentCompletePacket } from './current-maker-complete-packet'
const A=bcs.Address,U=bcs.u64(),V=bcs.byteVector(),T=bcs.struct('TypeName',{name:bcs.string()}),Table=bcs.struct('Table',{id:A,size:U})
export const CurrentCompleteIntentBcs=bcs.struct('Intent',{domain:V,schema:bcs.u16(),protocol:A,maker:A,maker_version:U,policy_hash:V,output_policy_hash:V,actor:A,attempt:V,name:bcs.string(),recipe:V,nonce:V})
const Receipt=bcs.struct('Receipt',{lines:bcs.vector(bcs.struct('PayLine',{product:A,version:U,policy_hash:V,receipt:CurrentCompletePrimaryReceiptBcs})),total:bcs.u128(),platform_recipient:A,fee_revision:U})
export const CurrentCompleteArtifactBcs=bcs.struct('Artifact',{id:A,controller:bcs.struct('Controller',{operator:T,parent:A,root:A}),root:A,intent:CurrentCompleteIntentBcs,policy:CurrentMakerOutputPolicyBcs,recipe:ManagementPagedSourcesBcs,scene:ManagementSceneBcs,colors:bcs.vector(ManagementColorBcs),
  render:bcs.struct('Reference',{object:A,blob_id:bcs.u256(),sha256:V,bytes:U,certified_epoch:bcs.u32(),end_epoch:bcs.u32()}),seal_id:bcs.option(V),receipt:Receipt,materializations:Table})
const Link=bcs.struct('Field',{id:A,name:bcs.struct('Wrapper',{name:bcs.struct('OutputKey',{dummy_field:bcs.bool()})}),value:A})
function check(v:unknown,code:string):asserts v {if(!v)throw Error(`CURRENT_COMPLETE_ARTIFACT_${code}`)}
/** Original created Artifact plus its actual Application dynamic-object link.
 * App-to-Soul membership, paged recipe/profiles, Blob payload and current
 * custody remain separate. Matching these fields is not a delivery receipt. */
export async function readCurrentCompleteArtifact(input:Parameters<typeof readCurrentCompleteOutputPolicy>[0]&{application:PinnedMovePackage;applicationId:string;artifactId:string}){
  const record=parseCurrentCompletePacket(input.record),application=structuredClone(input.application),applicationId=input.applicationId,artifactId=input.artifactId,soulId=input.soulId,{client,isCurrent}=input
  const signal=AbortSignal.any([input.signal,AbortSignal.timeout(60000)]),guard=()=>{signal.throwIfAborted();check(isCurrent(),'STALE')}
  guard();check([applicationId,artifactId].every(id=>/^0x[0-9a-f]{64}$/.test(id)&&BigInt(id)>0n)&&new Set([applicationId,artifactId,soulId]).size===3,'IDS')
  const output=await readCurrentCompleteOutputPolicy({...input,record,signal});guard()
  const payments=await readCurrentCompletePaymentEvents({...input,record,signal});guard()
  const final=await readCurrentCompleteFinalEffects({record,client,isCurrent,signal});guard()
  const origins=await readPinnedMovePackageOrigins(client,application,signal);guard()
  const origin=origins.get('output::Artifact'),keyOrigin=origins.get('character::OutputKey'),operatorOrigin=origins.get('character::ContentOperator');check(origin&&keyOrigin&&operatorOrigin,'TYPE_ORIGINS_REQUIRED')
  const wrapper=`0x2::dynamic_object_field::Wrapper<${keyOrigin}::character::OutputKey>`,linkId=deriveDynamicFieldID(applicationId,wrapper,moveEmptyStructBytes())
  const read=async(objectId:string,type:string)=>{const object=await readHistoricalMoveObject({client,effects:final.effects,transactionDigest:record.packet.digest,objectId,type,mode:'created',signal,maxBytes:256*1024});guard();return object}
  const linkObject=await read(linkId,`0x2::dynamic_field::Field<${wrapper},0x2::object::ID>`),link=Link.parse(linkObject.bytes)
  check(Link.serialize(link).toBase64()===toBase64(linkObject.bytes)&&link.id===linkId&&!link.name.name.dummy_field&&link.value===artifactId&&linkObject.object.owner.ObjectOwner===applicationId,'APPLICATION_LINK')
  const object=await read(artifactId,`${origin}::output::Artifact`),artifact=CurrentCompleteArtifactBcs.parse(object.bytes),p=record.plan
  check(CurrentCompleteArtifactBcs.serialize(artifact).toBase64()===toBase64(object.bytes)&&object.bytes.length<=245760&&artifact.id===artifactId&&object.object.owner.ObjectOwner===linkId,'CANONICAL_ARTIFACT_OWNER')
  check(artifact.root===soulId&&artifact.controller.root===soulId&&artifact.controller.parent===applicationId&&normalizeStructTag(artifact.controller.operator.name)===normalizeStructTag(`${operatorOrigin}::character::ContentOperator`),'CONTROLLER')
  const expectedIntent={domain:new TextEncoder().encode('soulidity-complete-intent'),schema:1,protocol:p.target.configId,maker:p.maker.productId,maker_version:p.maker.version,policy_hash:fromHex(p.maker.policyHash),output_policy_hash:fromHex(p.outputPolicyHash),actor:p.actor,attempt:fromHex(p.attempt),name:p.name,recipe:fromHex(p.recipeHash),nonce:fromHex(p.nonce)}
  check(CurrentCompleteIntentBcs.serialize(artifact.intent).toBase64()===CurrentCompleteIntentBcs.serialize(expectedIntent).toBase64(),'ORIGINAL_INTENT')
  check(CurrentMakerOutputPolicyBcs.serialize(artifact.policy).toBase64()===CurrentMakerOutputPolicyBcs.serialize(output.policy).toBase64()&&toHex(artifact.scene.renderer)===toHex(output.policy.renderer),'ORIGINAL_POLICY')
  const products=[p.maker,...p.packs]
  check(artifact.receipt.lines.length===products.length&&artifact.receipt.total===payments.total&&artifact.receipt.fee_revision===p.feeRevision&&artifact.receipt.platform_recipient===payments.receipts[0].policy.platform,'RECEIPT_TOTAL')
  for(const [index,product]of products.entries()){const line=artifact.receipt.lines[index],receipt=payments.receipts.find(r=>r.revenue===product.productId)!
    check(line.product===product.productId&&line.version===product.version&&toHex(line.policy_hash)===product.policyHash&&CurrentCompletePrimaryReceiptBcs.serialize(line.receipt).toBase64()===CurrentCompletePrimaryReceiptBcs.serialize(receipt).toBase64(),'RECEIPT_LINE')}
  check(artifact.render.object===p.render.blobObjectId&&toHex(artifact.render.sha256)===p.render.sha256&&BigInt(artifact.render.bytes)>0n&&artifact.render.end_epoch>artifact.render.certified_epoch,'RENDER_REFERENCE')
  const Namespace=bcs.struct('Namespace',{domain:V,schema:bcs.u16(),intent:V,kind:bcs.u32(),name:bcs.string()})
  const seal=Namespace.serialize({domain:new TextEncoder().encode('soulidity-complete-render'),schema:1,intent:sha256(CurrentCompleteIntentBcs.serialize(expectedIntent).toBytes()),kind:0,name:''}).toBytes()
  check(artifact.policy.protected?artifact.seal_id!==null&&toHex(artifact.seal_id)===toHex(seal):artifact.seal_id===null,'RENDER_SEAL_ID')
  check(artifact.materializations.size==='0','INITIAL_MATERIALIZATIONS')
  guard();return{transactionDigest:record.packet.digest,artifact,linkId,reference:{version:String(object.reference.version),digest:object.reference.digest},originalArtifactFieldsMatched:true as const,
    requiresApplicationTreeAndCustodyProof:true as const,requiresRecipeProfilesAndBlobProof:true as const,notDeliveryReceipt:true as const,notCurrentAuthority:true as const,executionPackageVersion:'NOT_ATTESTED'as const}
}
