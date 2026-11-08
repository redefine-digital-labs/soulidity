import { bcs } from '@mysten/sui/bcs'
import { ManagementAdapterBcs,ManagementSceneBcs,ManagementProfileBcs,ManagementScopeBcs } from '../soulidity/management/application-bcs'
import { readCurrentCompleteInstalledComposition } from './current-maker-complete-installed-composition'
import { readCurrentCompleteVersionHistory } from './current-maker-complete-version-history'
import { parseCurrentCompletePacket } from './current-maker-complete-packet'
function check(v:unknown,code:string):asserts v {if(!v)throw Error(`CURRENT_COMPLETE_PUBLISHED_ASSEMBLY_${code}`)}
/** Actual original immutable publications -> installed root assembly/visual and
 * active Pack profiles. This does not attest execution or visual compatibility. */
export async function readCurrentCompletePublishedAssembly(input:Parameters<typeof readCurrentCompleteInstalledComposition>[0]){
 const record=parseCurrentCompletePacket(input.record),context={...input,record,foundation:structuredClone(input.foundation),application:structuredClone(input.application),standard:structuredClone(input.standard),visual:structuredClone(input.visual)}
 const signal=AbortSignal.any([input.signal,AbortSignal.timeout(60000)]),guard=()=>{signal.throwIfAborted();check(input.isCurrent(),'STALE')}
 guard();const installed=await readCurrentCompleteInstalledComposition({...context,signal});guard()
 const history=await readCurrentCompleteVersionHistory({...context,signal});guard()
 const root=history.versions.find(v=>v.productId===record.plan.maker.productId);check(root&&root.parentScope===null,'ROOT_PUBLICATION')
 const v=root.published,a=installed.composition.assembly,keys=bcs.vector(bcs.byteVector()),adapters=bcs.vector(ManagementAdapterBcs)
 check(keys.serialize(a.base_parts).toBase64()===keys.serialize(v.parts).toBase64(),'BASE_PARTS')
 check(keys.serialize(installed.composition.required).toBase64()===keys.serialize(v.required_parts).toBase64(),'REQUIRED_PARTS')
 check(ManagementSceneBcs.serialize(installed.scene).toBase64()===ManagementSceneBcs.serialize(v.scene).toBase64(),'ROOT_SCENE')
 check(adapters.serialize(installed.rootAdapters).toBase64()===adapters.serialize(v.adapters).toBase64(),'ROOT_ADAPTERS')
 for(const key of v.required_parts)check(installed.slots.some(s=>s.part.scope===null&&bcs.byteVector().serialize(s.part.key).toBase64()===bcs.byteVector().serialize(key).toBase64()),'REQUIRED_SLOT')
 for(const profile of installed.publishedProfiles){
  const published=history.versions.find(v=>v.productId===profile.scope.product&&v.version===profile.scope.version);check(published&&published.parentScope!==null,'PACK_PUBLICATION')
  check(ManagementScopeBcs.serialize(published.parentScope).toBase64()===ManagementScopeBcs.serialize(a.root).toBase64(),'PACK_PARENT')
  const pv=published.published;check(pv.publication?.parent_policy!==null&&pv.publication?.parent_policy!==undefined&&bcs.byteVector().serialize(pv.publication.parent_policy).toBase64()===bcs.byteVector().serialize(v.policy_hash).toBase64(),'PACK_PARENT_POLICY')
  const expected={scope:{...a.root,product:published.productId,version:published.version,policy:pv.policy_hash},parent:published.parentScope,scene:pv.scene,parts:pv.parts,adapters:pv.adapters}
  check(ManagementProfileBcs.serialize(profile).toBase64()===ManagementProfileBcs.serialize(expected).toBase64(),'PACK_PROFILE')
 }
 guard();return{transactionDigest:record.packet.digest,requiredPartCount:v.required_parts.length,activePackProfileCount:installed.publishedProfiles.length,originalPublishedAssemblyMatched:true as const,
  requiresOriginalPlayerAndIssuedCountersProof:true as const,requiresQualifiedVisualRulesAndNestedSemanticProof:true as const,requiresQualifiedParentCommitInvariant:true as const,
  requiresPayloadSealAndCurrentCustodyProof:true as const,notDeliveryReceipt:true as const,notCurrentAuthority:true as const,executionPackageVersion:'NOT_ATTESTED'as const}
}
