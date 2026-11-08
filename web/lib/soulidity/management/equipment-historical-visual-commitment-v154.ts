import { bcs } from '@mysten/sui/bcs'
import { fromBase64, toHex } from '@mysten/sui/utils'
import { sha256 } from '@noble/hashes/sha2.js'
import { sha3_256 } from '@noble/hashes/sha3.js'
import { ManagementApplicationBcs, ManagementCompositionBcs, ManagementRootVisualBcs, ManagementProfileBcs, ManagementColorBcs,
  ManagementVariantBcs, ManagementPartBcs, ManagementSourceBcs, ManagementStoredBindingBcs, ManagementSceneBcs, ManagementAdapterBcs, ManagementLayerBcs } from './application-bcs'
import { applicationRecipeCommitment } from './application-recipe'
import { applicationSemanticRecipeCommitment } from './application-semantic-recipe'
import { renderManagementAssembly } from './application-assembly-render'
import { readEquipmentHistoricalModelV154 } from './equipment-historical-model-v154'
import { captureAccountOriginalReadClientV155 } from './account-original-readers-v155'
import { parseEquipmentManagementRecord } from './equipment-record'

function check(value: unknown, code: string): asserts value { if (!value) throw Error(`MANAGEMENT_EQUIPMENT_VISUAL_V154_${code}`) }
export interface EquipmentOriginalVisualValuesV154 {
  application: ReturnType<typeof ManagementApplicationBcs.parse>
  composition: ReturnType<typeof ManagementCompositionBcs.parse>
  rootVisual: ReturnType<typeof ManagementRootVisualBcs.parse>
  profiles: Array<{ profile: ReturnType<typeof ManagementProfileBcs.parse>; colors: ReturnType<typeof ManagementColorBcs.parse>[] }>
  variants: ReturnType<typeof ManagementVariantBcs.parse>[]
  slots: Array<{ partBcs: string; source: ReturnType<typeof ManagementSourceBcs.parse>; binding: ReturnType<typeof ManagementStoredBindingBcs.parse> }>
}
/** Pure exact commitment/render computation. Provenance must come from the
 * original historical pipeline below. No caller hash or successful computation
 * grants source qualification, current authority, or a complete receipt. */
export function verifyEquipmentOriginalVisualValuesV154(input: EquipmentOriginalVisualValuesV154) {
  const value = structuredClone(input), { application, composition, rootVisual, profiles, variants, slots } = value
  check(application.recipe_hash.length === 32, 'APPLICATION_RECIPE_LENGTH')
  const recipeHash = toHex(applicationRecipeCommitment(value))
  check(recipeHash === toHex(application.recipe_hash), 'APPLICATION_RECIPE_COMMITMENT')
  const resolved = slots.map(row => ({ part: ManagementPartBcs.parse(fromBase64(row.partBcs)), source: row.source, layout: row.binding.layout, adapter: row.binding.adapter }))
  const snapshots = profiles.map(({ profile, colors }) => ({ scope: profile.scope, parent: profile.parent,
    scene: sha256(ManagementSceneBcs.serialize(profile.scene).toBytes()), parts: profile.parts, colors,
    adapters: profile.adapters.map(adapter => sha256(ManagementAdapterBcs.serialize(adapter).toBytes())) }))
  // Character state_changed deliberately permits exits (operations3/4/5)
  // after rules or anchors become unsatisfied. Its attach/replace rule check
  // also omits the separate required-root precondition of render_plan.
  // Preserve this distinction: an equipment exit can succeed while the saved
  // composition is explicitly unavailable for public rendering.
  let layers: ReturnType<typeof renderManagementAssembly> | null = null, renderFailureCode: string | null = null
  try { layers = renderManagementAssembly({ composition: { ...composition, required: [] }, rootVisual, profiles, variants, slots: resolved }) }
  catch (error) {
    check(error instanceof Error && /^(APPLICATION_FORMS_SOURCE_POLICY_|APPLICATION_SCENE_RULE_|APPLICATION_VISUAL_RULE_|APPLICATION_VISUAL_LAYER_|APPLICATION_ASSEMBLY_RENDER_)/.test(error.message), 'UNEXPECTED_RENDER_ERROR')
    renderFailureCode = error.message
  }
  const missingRequiredParts = composition.required.filter(required => !resolved.some(row => row.part.scope === null && toHex(row.part.key) === toHex(required))).map(toHex)
  let semanticRecipeHash: string | null = null
  try { semanticRecipeHash = toHex(applicationSemanticRecipeCommitment({ composition, rootVisual, profiles: snapshots, variants, slots: resolved })) }
  catch (error) { check(error instanceof Error && error.message.startsWith('APPLICATION_VISUAL_RULE_'), 'UNEXPECTED_SEMANTIC_RECIPE_ERROR') }
  const renderPlanHash = layers === null ? null : toHex(sha3_256(bcs.vector(ManagementLayerBcs).serialize(layers).toBytes()))
  return { recipeHash, semanticRecipeHash, renderPlanHash, layers, profiles: snapshots, missingRequiredParts, renderFailureCode,
    originalApplicationRecipeMatched: true as const, sourcePolicyAndVisualEligibilityVerified: layers !== null,
    renderPlanAvailable: layers !== null && missingRequiredParts.length === 0,
    requiresFullApplicationCommitmentAndQualifiedRendererAssets: true as const }
}
/** Both actual original App.recipe_hash values, full source/layout policy,
 * profile/variant eligibility and exact display instructions. This is an
 * internal step of the complete original successful recovery query. */
export async function readEquipmentHistoricalVisualCommitmentV154(input: Parameters<typeof readEquipmentHistoricalModelV154>[0]) {
  const record = parseEquipmentManagementRecord(input.record), client = captureAccountOriginalReadClientV155(input.client, input.signal)
  const context = { client, record, standardTypeOrigin: input.standardTypeOrigin, visualTypeOrigin: input.visualTypeOrigin,
    compositionId: input.compositionId, originalOccupiedPartBcs: [...input.originalOccupiedPartBcs], maxHops: input.maxHops, signal: input.signal }
  const evidence = await readEquipmentHistoricalModelV154(context)
  if (!evidence.model || !evidence.sources || !evidence.slot || !evidence.rootApplication) return { ...evidence, visualCommitment: null }
  const profiles = evidence.model.profiles.map((profile, index) => ({ profile, colors: evidence.model!.palettes[index] }))
  const shared = { rootVisual: evidence.model.rootVisual, profiles, variants: evidence.model.variants }
  const before = verifyEquipmentOriginalVisualValuesV154({ ...shared, application: evidence.rootApplication.applicationBefore,
    composition: evidence.slot.compositionBefore, slots: evidence.sources.inputs })
  const after = verifyEquipmentOriginalVisualValuesV154({ ...shared, application: evidence.rootApplication.applicationAfter,
    composition: evidence.slot.compositionAfter, slots: evidence.sources.outputs })
  check(record.plan.action.kind === 'REMOVE' || after.sourcePolicyAndVisualEligibilityVerified, 'ATTACH_REPLACE_RULES')
  context.signal.throwIfAborted()
  return { ...evidence, visualCommitment: { before, after, bothOriginalApplicationRecipesVerified: true as const,
    requiresFullApplicationCommitmentGasAllEffectsAndSourceQualification: true as const }, completeBusinessOutputVerified: false as const }
}
