import { toHex } from '@mysten/sui/utils'
import { ManagementPartBcs } from '../soulidity/management/application-bcs'
import { applicationRecipeCommitment } from '../soulidity/management/application-recipe'
import { readCurrentCompleteInstalledComposition } from './current-maker-complete-installed-composition'
import { readCurrentCompleteApplicationTree } from './current-maker-complete-application-tree'
import { readCurrentCompleteVisualPlan } from './current-maker-complete-visual-plan'
import { parseCurrentCompletePacket } from './current-maker-complete-packet'
type Installed=Awaited<ReturnType<typeof readCurrentCompleteInstalledComposition>>
function check(v:unknown,code:string):asserts v {if(!v)throw Error(`CURRENT_COMPLETE_APPLICATION_RECIPE_${code}`)}
/** Exact Character composition recipe, including empty parts and full Source
 * snapshots. Original effects must separately prove absence of variants. */
export function currentCompleteApplicationRecipe(installed:Pick<Installed,'composition'|'scene'|'publishedProfiles'|'profiles'|'rootAdapters'|'slots'>){
 return applicationRecipeCommitment({composition:installed.composition,rootVisual:{scene:installed.scene,adapters:installed.rootAdapters},
  profiles:installed.publishedProfiles.map((profile,i)=>({profile,colors:installed.profiles[i].colors})),variants:[],
  slots:installed.slots.map(s=>({partBcs:ManagementPartBcs.serialize(s.part).toBase64(),source:s.source,binding:s.binding}))})
}
/** Original Standard-bound Application recipe, distinct from the Artifact
 * semantic recipe and the full nested Application semantic commitment. */
export async function readCurrentCompleteApplicationRecipe(input:Parameters<typeof readCurrentCompleteInstalledComposition>[0]){
 const context={...input,record:parseCurrentCompletePacket(input.record),foundation:structuredClone(input.foundation),application:structuredClone(input.application),standard:structuredClone(input.standard),visual:structuredClone(input.visual)}
 const signal=AbortSignal.any([input.signal,AbortSignal.timeout(60000)]),guard=()=>{signal.throwIfAborted();check(input.isCurrent(),'STALE')}
 guard();await readCurrentCompleteVisualPlan({...context,signal});guard()
 const tree=await readCurrentCompleteApplicationTree({...context,signal});guard()
 const installed=await readCurrentCompleteInstalledComposition({...context,signal});guard()
 const hash=currentCompleteApplicationRecipe(installed);check(toHex(hash)===toHex(tree.state.recipe_hash),'HASH')
 guard();return{transactionDigest:installed.transactionDigest,applicationRecipeHash:toHex(hash),artifactRecipeHash:context.record.plan.recipeHash,
  originalApplicationRecipeMatched:true as const,requiresCoreGenesisAndNestedSemanticProof:true as const,requiresOriginalPlayerAndIssuedCountersProof:true as const,
  requiresQualifiedParentCommitInvariant:true as const,requiresQualifiedRendererAndAssetBytesProof:true as const,requiresPayloadSealAndCurrentCustodyProof:true as const,
  notDeliveryReceipt:true as const,notCurrentAuthority:true as const,executionPackageVersion:'NOT_ATTESTED'as const}
}
