import { bcs } from '@mysten/sui/bcs'
import { toHex } from '@mysten/sui/utils'
import { sha256 } from '@noble/hashes/sha2.js'
import { CurrentCompleteManifestBcs, CurrentCompleteApplicationCommitmentBcs } from '../../animacraft/current-maker-complete-nested-semantic'
import { CurrentCompleteCoreBcs } from '../../animacraft/current-maker-complete-application-carriers'
import { CurrentCompleteContentBcs } from '../../animacraft/current-maker-complete-installed-content'
import { CurrentCompleteArtifactBcs } from '../../animacraft/current-maker-complete-artifact'
import { NativeInitialAuthorizationBcs, NativeInitialPaidBcs, NativeInitialConfigurationBcs } from '../native-initial-children'
import { ManagementApplicationBcs, ManagementCompositionBcs, ManagementRootVisualBcs, ManagementBoundPartsBcs, ManagementLoadoutLibraryBcs,
  ManagementSourceBcs, ManagementPartBcs, ManagementAdapterBcs, ManagementRepresentationBcs, ManagementScopeBcs } from './application-bcs'
import { verifyEquipmentOriginalVisualValuesV154, type EquipmentOriginalVisualValuesV154 } from './equipment-historical-visual-commitment-v154'
import { parseEquipmentManagementRecord } from './equipment-record'
import { readEquipmentHistoricalApplicationV154 } from './equipment-historical-application-v154'
function check(value: unknown, code: string): asserts value { if (!value) throw Error(`MANAGEMENT_EQUIPMENT_NESTED_V154_${code}`) }
export interface EquipmentNestedValuesV154 extends EquipmentOriginalVisualValuesV154 {
  core: ReturnType<typeof CurrentCompleteCoreBcs.parse>
  authorization: ReturnType<typeof NativeInitialAuthorizationBcs.parse>
  content: ReturnType<typeof CurrentCompleteContentBcs.parse>
  paid: ReturnType<typeof NativeInitialPaidBcs.parse>
  loadout: ReturnType<typeof ManagementLoadoutLibraryBcs.parse>
  artifact: ReturnType<typeof CurrentCompleteArtifactBcs.parse>
  configuration: ReturnType<typeof NativeInitialConfigurationBcs.parse> | null
  boundParts: ReturnType<typeof ManagementBoundPartsBcs.parse>
  referenceSources: ReturnType<typeof ManagementSourceBcs.parse>[]
  boundSources: ReturnType<typeof ManagementSourceBcs.parse>[]
}
/** Exact complete-state algorithm using ALL permanent source rows, including
 * unmounted sources. General existing-state bodies and optional configuration
 * are retained. Pure computation grants neither provenance nor success. */
export function equipmentNestedApplicationCommitmentV154(input: EquipmentNestedValuesV154) {
  const v = structuredClone(input), { application: state, composition: c } = v, visual = verifyEquipmentOriginalVisualValuesV154(v)
  check(v.referenceSources.length === c.references.locations.length && v.boundSources.length === v.boundParts.records.locations.length
    && v.referenceSources.every(s => s.definition.rights === 0) && v.boundSources.every(s => s.definition.rights === 1), 'PERMANENT_INVENTORY')
  const snapshot = (s: typeof v.referenceSources[number]) => ({ source_hash: sha256(ManagementSourceBcs.serialize(s).toBytes()), product: s.product,
    maker: s.maker, maker_version: s.maker_version, version: s.version, definition: s.definition_hash,
    representation: sha256(ManagementRepresentationBcs.serialize(s.definition.representation).toBytes()), rights: s.definition.rights })
  for (const row of v.slots) {
    const b = row.binding
    check([b.reference, b.bound, b.item].filter(value => value !== null).length === 1, 'SLOT_KIND')
    const original = b.reference !== null ? v.referenceSources[Number(b.reference)] : b.bound !== null ? v.boundSources[Number(b.bound)] : row.source
    check(original && ManagementSourceBcs.serialize(original).toBase64() === ManagementSourceBcs.serialize(row.source).toBase64()
      && row.source.definition.rights === (b.reference !== null ? 0 : b.bound !== null ? 1 : 2), 'SLOT_SOURCE')
  }
  const slots = c.assembly.parts.map(part => {
    const row = v.slots.find(row => row.partBcs === ManagementPartBcs.serialize(part).toBase64())
    return { part, binding: row ? { source: snapshot(row.source), layout: row.binding.layout, item: row.binding.item, bound: row.binding.bound,
      adapter: row.binding.adapter === null ? null : sha256(ManagementAdapterBcs.serialize(row.binding.adapter).toBytes()) } : null }
  })
  const scopeKey = (scope: ReturnType<typeof ManagementScopeBcs.parse>) => ManagementScopeBcs.serialize(scope).toBase64()
  const effectiveScene = v.variants.find(row => scopeKey(row.original.scope) === scopeKey(c.assembly.root))?.target ?? v.rootVisual.scene
  const manifest = CurrentCompleteManifestBcs.parse(CurrentCompleteManifestBcs.serialize({ standard_revision: '0', standard_manifest: new Uint8Array(),
    soul: state.root, revision: state.revision, creator: v.core.creator, collection: v.core.collection, resale: v.core.resale, recipe_hash: state.recipe_hash,
    core: v.core.id, composition: c.id, composition_revision: c.revision, bound_module: v.boundParts.id, authorization: v.authorization.id,
    content: v.content.id, paid_access: v.paid.id, output: v.artifact.id, loadout: v.loadout.id, enhancement_table: c.enhancements.id,
    enhancement_count: c.enhancements.size, bound: v.boundSources.map(snapshot), references: v.referenceSources.map(snapshot), slots,
    scene: effectiveScene, colors: c.colors, profiles: visual.profiles }).toBytes())
  const manifestHash = sha256(CurrentCompleteManifestBcs.serialize(manifest).toBytes())
  const configurationHash = v.configuration === null ? null : sha256(bcs.struct('Commitment', { domain: bcs.byteVector(), configuration: bcs.byteVector() })
    .serialize({ domain: new TextEncoder().encode('soulidity/state-configuration/v1'), configuration: NativeInitialConfigurationBcs.serialize(v.configuration).toBytes() }).toBytes())
  const body = ManagementApplicationBcs.serialize(state).toBytes(), optional = bcs.option(bcs.byteVector()).serialize(configurationHash).toBytes()
  const extended = new Uint8Array(body.length + optional.length); extended.set(body); extended.set(optional, body.length)
  const commitment = { domain: new TextEncoder().encode('soulidity/animacraft/state/v2'), root: state.root, revision: state.revision, state: extended,
    core: CurrentCompleteCoreBcs.serialize(v.core).toBytes(), composition: ManagementCompositionBcs.serialize(c).toBytes(), visual: ManagementRootVisualBcs.serialize(v.rootVisual).toBytes(),
    bound: ManagementBoundPartsBcs.serialize(v.boundParts).toBytes(), authorization: NativeInitialAuthorizationBcs.serialize(v.authorization).toBytes(),
    content: CurrentCompleteContentBcs.serialize(v.content).toBytes(), paid: NativeInitialPaidBcs.serialize(v.paid).toBytes(), loadout: ManagementLoadoutLibraryBcs.serialize(v.loadout).toBytes(),
    output: CurrentCompleteArtifactBcs.serialize(v.artifact).toBytes(), recipe: manifestHash }
  return { ...visual, manifest, manifestHash: toHex(manifestHash), commitment, semanticHash: toHex(sha256(CurrentCompleteApplicationCommitmentBcs.serialize(commitment).toBytes())),
    configurationHash: configurationHash === null ? null : toHex(configurationHash) }
}
/** Match the two actual Standard descriptor semantic_hash values using every
 * original mandatory App body, full Manifest and optional configuration. */
export async function readEquipmentHistoricalNestedSemanticV154(input: Parameters<typeof readEquipmentHistoricalApplicationV154>[0]) {
  const signal = input.signal, record = parseEquipmentManagementRecord(input.record)
  const evidence = await readEquipmentHistoricalApplicationV154({ ...input, record })
  if (!evidence.applicationTree || !evidence.model || !evidence.sources || !evidence.slot || !evidence.rootApplication) return { ...evidence, nestedSemantic: null }
  const t = evidence.applicationTree, m = evidence.model, s = evidence.sources, r = evidence.rootApplication
  const shared = { core: t.core.value, authorization: t.authorization.value, content: t.content.value, paid: t.paid.value, loadout: t.loadout.value,
    artifact: t.output.value, configuration: t.configuration?.value ?? null, boundParts: s.boundParts, referenceSources: s.referenceSources, boundSources: s.boundSources,
    rootVisual: m.rootVisual, profiles: m.profiles.map((profile, index) => ({ profile, colors: m.palettes[index] })), variants: m.variants }
  const before = equipmentNestedApplicationCommitmentV154({ ...shared, application: r.applicationBefore, composition: evidence.slot.compositionBefore, slots: s.inputs })
  const after = equipmentNestedApplicationCommitmentV154({ ...shared, application: r.applicationAfter, composition: evidence.slot.compositionAfter, slots: s.outputs })
  check(record.plan.action.kind === 'REMOVE' || after.sourcePolicyAndVisualEligibilityVerified, 'ATTACH_REPLACE_RULES')
  const find = (root: typeof r.rootBefore) => root.modules.find(row => row.object === r.applicationBefore.id)!
  check(before.semanticHash === toHex(find(r.rootBefore).semantic_hash) && after.semanticHash === toHex(find(r.rootAfter).semantic_hash), 'STANDARD_SEMANTIC_HASH')
  signal.throwIfAborted()
  return { ...evidence, nestedSemantic: { before, after, bothOriginalStandardSemanticHashesMatched: true as const,
    requiresOriginalCustodyGasAllEffectsAndSourceQualificationForEquipmentOutcome: true as const, requiresQualifiedRendererAndAssetContentForDisplay: true as const }, completeBusinessOutputVerified: false as const }
}
