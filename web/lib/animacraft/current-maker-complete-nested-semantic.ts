import { bcs } from '@mysten/sui/bcs'
import { sha256 } from '@noble/hashes/sha2.js'
import { toHex } from '@mysten/sui/utils'
import { ManagementApplicationBcs,ManagementCompositionBcs,ManagementRootVisualBcs,ManagementBoundPartsBcs,ManagementPartBcs,ManagementSourceBcs,ManagementRepresentationBcs,ManagementAdapterBcs,ManagementSceneBcs,ManagementColorBcs,ManagementProfileSnapshotBcs } from '../soulidity/management/application-bcs'
import { ManagementSlotSnapshotBcs } from '../soulidity/management/application-recipe'
import { readCurrentCompleteApplicationCarriers,CurrentCompleteResaleBcs } from './current-maker-complete-application-carriers'
import { readCurrentCompleteInstalledContent,CurrentCompleteContentBcs } from './current-maker-complete-installed-content'
import { readCurrentCompleteInstalledComposition } from './current-maker-complete-installed-composition'
import { readCurrentCompleteApplicationTree } from './current-maker-complete-application-tree'
import { readCurrentCompleteArtifact,CurrentCompleteArtifactBcs } from './current-maker-complete-artifact'
import { parseCurrentCompletePacket } from './current-maker-complete-packet'
const A=bcs.Address,U=bcs.u64(),V=bcs.byteVector(),SourceSnapshot=bcs.struct('SourceSnapshot',{source_hash:V,product:A,maker:A,maker_version:U,version:U,definition:V,representation:V,rights:bcs.u8()})
export const CurrentCompleteManifestBcs=bcs.struct('Manifest',{standard_revision:U,standard_manifest:V,soul:A,revision:U,creator:A,collection:bcs.option(A),resale:CurrentCompleteResaleBcs,recipe_hash:V,core:A,composition:A,composition_revision:U,bound_module:A,authorization:A,content:A,paid_access:A,output:A,loadout:A,enhancement_table:A,enhancement_count:U,bound:bcs.vector(SourceSnapshot),references:bcs.vector(SourceSnapshot),slots:bcs.vector(ManagementSlotSnapshotBcs),scene:ManagementSceneBcs,colors:bcs.vector(ManagementColorBcs),profiles:bcs.vector(ManagementProfileSnapshotBcs)})
export const CurrentCompleteApplicationCommitmentBcs=bcs.struct('ApplicationCommitment',{domain:V,root:A,revision:U,state:V,core:V,composition:V,visual:V,bound:V,authorization:V,content:V,paid:V,loadout:V,output:bcs.option(V),recipe:bcs.option(V)})
type Installed=Awaited<ReturnType<typeof readCurrentCompleteInstalledComposition>>
type Carriers=Awaited<ReturnType<typeof readCurrentCompleteApplicationCarriers>>
export interface CurrentCompleteNestedValues {state:ReturnType<typeof ManagementApplicationBcs.parse>;installed:Pick<Installed,'slots'|'composition'|'boundParts'|'scene'|'profiles'|'rootVisual'>;carriers:{[K in 'core'|'authorization'|'paid'|'loadout']:Pick<Carriers[K],'value'|'bytes'>};content:ReturnType<typeof CurrentCompleteContentBcs.parse>;artifact:ReturnType<typeof CurrentCompleteArtifactBcs.parse>}
function check(v:unknown,code:string):asserts v {if(!v)throw Error(`CURRENT_COMPLETE_NESTED_SEMANTIC_${code}`)}
/** Owning full internal Manifest and ApplicationCommitment with explicit absent
 * configuration. Caller authenticates every body/child and absence of variants. */
export function currentCompleteNestedSemantic(values:CurrentCompleteNestedValues){
 const {state,installed:i,carriers:c,content,artifact}=values,part=(p:Installed['slots'][number]['part'])=>ManagementPartBcs.serialize(p).toBase64()
 const snapshot=(s:Installed['slots'][number]['source'])=>({source_hash:sha256(ManagementSourceBcs.serialize(s).toBytes()),product:s.product,maker:s.maker,maker_version:s.maker_version,version:s.version,definition:s.definition_hash,representation:sha256(ManagementRepresentationBcs.serialize(s.definition.representation).toBytes()),rights:s.definition.rights})
 const inventory=(kind:'reference'|'bound',count:number)=>{const rows=i.slots.filter(s=>s.binding[kind]!==null).sort((a,b)=>Number(BigInt(a.binding[kind]!)-BigInt(b.binding[kind]!)));check(rows.length===count&&rows.every((s,index)=>s.binding[kind]===String(index)),'INVENTORY');return rows.map(s=>snapshot(s.source))}
 const slots=i.composition.assembly.parts.map(p=>{const selected=i.slots.find(s=>part(s.part)===part(p));return{part:p,binding:selected?{source:snapshot(selected.source),layout:selected.binding.layout,item:selected.binding.item,bound:selected.binding.bound,adapter:selected.binding.adapter===null?null:sha256(ManagementAdapterBcs.serialize(selected.binding.adapter).toBytes())}:null}})
 const core=c.core.value,manifest=CurrentCompleteManifestBcs.parse(CurrentCompleteManifestBcs.serialize({standard_revision:'0',standard_manifest:new Uint8Array(),soul:state.root,revision:state.revision,creator:core.creator,collection:core.collection,resale:core.resale,recipe_hash:state.recipe_hash,core:core.id,composition:i.composition.id,composition_revision:i.composition.revision,bound_module:i.boundParts.id,authorization:c.authorization.value.id,content:content.id,paid_access:c.paid.value.id,output:artifact.id,loadout:c.loadout.value.id,enhancement_table:i.composition.enhancements.id,enhancement_count:i.composition.enhancements.size,bound:inventory('bound',i.boundParts.records.locations.length),references:inventory('reference',i.composition.references.locations.length),slots,scene:i.scene,colors:i.composition.colors,profiles:i.profiles}).toBytes()),manifestHash=sha256(CurrentCompleteManifestBcs.serialize(manifest).toBytes())
 const stateBytes=ManagementApplicationBcs.serialize(state).toBytes(),configBytes=bcs.option(V).serialize(null).toBytes(),extended=new Uint8Array(stateBytes.length+configBytes.length);extended.set(stateBytes);extended.set(configBytes,stateBytes.length)
 const commitment={domain:new TextEncoder().encode('soulidity/animacraft/state/v2'),root:state.root,revision:state.revision,state:extended,core:c.core.bytes,composition:ManagementCompositionBcs.serialize(i.composition).toBytes(),visual:ManagementRootVisualBcs.serialize(i.rootVisual).toBytes(),bound:ManagementBoundPartsBcs.serialize(i.boundParts).toBytes(),authorization:c.authorization.bytes,content:CurrentCompleteContentBcs.serialize(content).toBytes(),paid:c.paid.bytes,loadout:c.loadout.bytes,output:CurrentCompleteArtifactBcs.serialize(artifact).toBytes(),recipe:manifestHash}
 return{manifest,manifestHash:toHex(manifestHash),commitment,semanticHash:toHex(sha256(CurrentCompleteApplicationCommitmentBcs.serialize(commitment).toBytes()))}
}
/** Exact original Standard semantic_hash across complete actual child bodies.
 * Table values/asset bytes/Seal/current custody are independently required. */
export async function readCurrentCompleteNestedSemantic(input:Parameters<typeof readCurrentCompleteApplicationCarriers>[0]){
 const context={...input,record:parseCurrentCompletePacket(input.record),foundation:structuredClone(input.foundation),application:structuredClone(input.application),standard:structuredClone(input.standard),visual:structuredClone(input.visual),content:structuredClone(input.content)}
 const signal=AbortSignal.any([input.signal,AbortSignal.timeout(60000)]),guard=()=>{signal.throwIfAborted();check(input.isCurrent(),'STALE')}
 guard();const carriers=await readCurrentCompleteApplicationCarriers({...context,signal});guard()
 const content=await readCurrentCompleteInstalledContent({...context,signal});guard()
 const installed=await readCurrentCompleteInstalledComposition({...context,signal});guard()
 const tree=await readCurrentCompleteApplicationTree({...context,signal});guard()
 const artifact=await readCurrentCompleteArtifact({...context,signal});guard()
 const a=carriers.authorization.value,l=carriers.paid.value,b=carriers.loadout.value,c=content.carrier
 const roles=[tree.soulId,tree.applicationId,artifact.artifact.id,artifact.artifact.recipe.pages.id,artifact.artifact.materializations.id,installed.composition.id,installed.rootVisual.id,installed.boundParts.id,installed.composition.slots.id,installed.composition.references.pages.id,installed.boundParts.records.pages.id,installed.composition.assembly.profiles.id,installed.composition.assembly.palettes.id,installed.composition.enhancements.id,carriers.core.value.id,a.id,a.grants.id,l.id,l.offers.id,l.entries.id,l.attempts.id,b.id,b.heads.id,b.receipts.id,c.id,c.versions.id,c.counts.id,c.indices.id,c.names_by_kind.id,c.active.id,c.attempts.id]
 check(new Set(roles).size===roles.length,'ROLE_ALIAS')
 const result=currentCompleteNestedSemantic({state:tree.state,installed,carriers,content:c,artifact:artifact.artifact});check(result.semanticHash===toHex(tree.descriptor.semantic_hash),'HASH')
 guard();return{transactionDigest:tree.transactionDigest,semanticHash:result.semanticHash,manifestHash:result.manifestHash,originalNestedApplicationSemanticMatched:true as const,
  requiresOriginalPlayerIssuedCountersAndContentPolicyProof:true as const,requiresQualifiedParentCommitInvariant:true as const,requiresQualifiedRendererAndAssetBytesProof:true as const,requiresPayloadSealAndCurrentCustodyProof:true as const,notDeliveryReceipt:true as const,notCurrentAuthority:true as const,executionPackageVersion:'NOT_ATTESTED'as const}
}
