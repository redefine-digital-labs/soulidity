import { bcs } from '@mysten/sui/bcs'
import { deriveDynamicFieldID, toBase64 } from '@mysten/sui/utils'
import { MAINNET_GENESIS_DIGEST } from '../../animacraft/mainnet-chain'
import { readHistoricalMoveObject } from '../../sui/historical-object'
import { readHistoricalParentTransaction } from '../../sui/historical-parent-lineage'
import { MoveEmptyStructBcs, moveEmptyStructBytes } from '../../sui/move-empty-struct'
import { captureAccountOriginalReadClientV155 } from './account-original-readers-v155'
import { parseEquipmentManagementRecord } from './equipment-record'
import { readApplicationContainedHistoricalChild } from './application-historical-contained-child'
import { readOriginalOptionalDirectChildV154 } from './application-original-optional-child-v154'
import { readEquipmentHistoricalSourcesV154 } from './equipment-historical-sources-v154'
import { ManagementCompositionBcs, ManagementRootVisualBcs, ManagementProfileBcs, ManagementScopeBcs,
  ManagementColorBcs, ManagementActiveVariantsBcs, ManagementVariantBcs } from './application-bcs'

function check(value: unknown, code: string): asserts value { if (!value) throw Error(`MANAGEMENT_EQUIPMENT_MODEL_V154_${code}`) }
const scopeKey = (scope: ReturnType<typeof ManagementScopeBcs.parse>) => ManagementScopeBcs.serialize(scope).toBase64()
/** Actual original RootVisual, admitted Profiles, palette values and optional
 * active Variant tree. Both snapshots are compared, never today's preferences.
 * Absence requires history to creation. Pure recipe/scene/render and full
 * nested Application semantic/gas/source qualification follow in the pipeline. */
export async function readEquipmentHistoricalModelV154(input: Parameters<typeof readEquipmentHistoricalSourcesV154>[0] & { visualTypeOrigin: string }) {
  const record = parseEquipmentManagementRecord(input.record), p = record.plan, client = captureAccountOriginalReadClientV155(input.client, input.signal)
  const visualTypeOrigin = input.visualTypeOrigin, standardTypeOrigin = input.standardTypeOrigin, compositionId = input.compositionId, maxHops = input.maxHops
  check(typeof visualTypeOrigin === 'string' && /^0x[0-9a-f]{64}$/.test(visualTypeOrigin) && BigInt(visualTypeOrigin) > 0n, 'VISUAL_ORIGIN')
  const originalOccupiedPartBcs = [...input.originalOccupiedPartBcs], signal = AbortSignal.any([input.signal, AbortSignal.timeout(120000)])
  const evidence = await readEquipmentHistoricalSourcesV154({ client, record, standardTypeOrigin, compositionId, maxHops, originalOccupiedPartBcs, signal })
  if (!evidence.sources || !evidence.slot) return { ...evidence, model: null }
  const execution = evidence.execution; check(execution.status === 'FINALIZED_EXECUTION', 'FINALITY')
  const c = evidence.slot.compositionBefore, app = p.target.application.originalPackageId, model = p.target.model.originalPackageId
  const owner = deriveDynamicFieldID(p.applicationId, `0x2::dynamic_object_field::Wrapper<${app}::character::CompositionKey>`, moveEmptyStructBytes())
  const Mapping = bcs.struct('Field', { id: bcs.Address, name: bcs.struct('Wrapper', { name: MoveEmptyStructBcs }), value: bcs.Address })
  const histories: Array<{ role: string; snapshot: string; id: string; writer: string }> = []
  function composition(bytes: Uint8Array) {
    const value = ManagementCompositionBcs.parse(bytes)
    check(ManagementCompositionBcs.serialize(value).toBase64() === toBase64(bytes) && value.id === c.id
      && scopeKey(value.assembly.root) === scopeKey(c.assembly.root), 'COMPOSITION')
    return value
  }
  async function optional(key: string, snapshot: 'input' | 'written') {
    const wrapper = `0x2::dynamic_object_field::Wrapper<${app}::character::${key}>`, id = deriveDynamicFieldID(c.id, wrapper, moveEmptyStructBytes())
    const proof = await readOriginalOptionalDirectChildV154({ client, effects: execution.effects, transactionDigest: record.packet.digest, checkpoint: execution.checkpoint,
      snapshot, rootId: c.id, rootType: `${app}::character::Composition`, rootOwnerId: owner, childId: id,
      childType: `0x2::dynamic_field::Field<${wrapper},0x2::object::ID>`, chainIdentifier: p.target.chainIdentifier,
      genesisDigest: MAINNET_GENESIS_DIGEST, maxHops, signal, assertRoot: bytes => { composition(bytes) } })
    if (proof.status !== 'PRESENT') return { id, proof, mapping: null }
    const field = Mapping.parse(proof.child.bytes)
    check(Mapping.serialize(field).toBase64() === toBase64(proof.child.bytes) && field.id === id && field.name.name.dummy_field === false
      && proof.child.reference.created, 'PERMANENT_MAPPING')
    histories.push({ role: key, snapshot, id, writer: proof.writerTransactionDigest }); return { id, proof, mapping: field }
  }
  async function nested(snapshot: 'input' | 'written', parentUid: string, id: string, type: string, role: string,
    assertContainsParent: (bytes: Uint8Array, uid: string) => void) {
    const proof = await readApplicationContainedHistoricalChild({ client, anchorEffects: execution.effects, anchorTransactionDigest: record.packet.digest,
      anchorCheckpoint: execution.checkpoint, anchorMode: snapshot, rootId: c.id, rootType: `${app}::character::Composition`, rootOwnerId: owner,
      parentUid, childId: id, childType: type, chainIdentifier: p.target.chainIdentifier, genesisDigest: MAINNET_GENESIS_DIGEST,
      signal, maxHops, assertContainsParent }); histories.push({ role, snapshot, id, writer: proof.writerTransactionDigest }); return proof
  }
  const oldVisual = await optional('RootVisualKey', 'input'), nextVisual = await optional('RootVisualKey', 'written')
  check(oldVisual.mapping && nextVisual.mapping && oldVisual.proof.status === 'PRESENT' && nextVisual.proof.status === 'PRESENT'
    && Mapping.serialize(oldVisual.mapping).toBase64() === Mapping.serialize(nextVisual.mapping).toBase64(), 'ROOT_VISUAL_MAPPING')
  check(!execution.effects.V2!.changedObjects.some(([id]) => id === oldVisual.id || id === oldVisual.mapping!.value), 'IMMUTABLE_VISUAL_CHANGED')
  const writer = await readHistoricalParentTransaction({ client, transactionDigest: oldVisual.proof.writerTransactionDigest, maxCheckpoint: execution.checkpoint,
    chainIdentifier: p.target.chainIdentifier, genesisDigest: MAINNET_GENESIS_DIGEST, signal })
  check(writer.executionStatus === 'Success', 'VISUAL_WRITER')
  const visual = await readHistoricalMoveObject({ client, effects: writer.effects, transactionDigest: writer.transactionDigest,
    objectId: oldVisual.mapping.value, type: `${app}::character::RootVisual`, mode: 'created', signal, maxBytes: 256 * 1024 })
  const rootVisual = ManagementRootVisualBcs.parse(visual.bytes)
  check(ManagementRootVisualBcs.serialize(rootVisual).toBase64() === toBase64(visual.bytes) && rootVisual.id === oldVisual.mapping.value
    && visual.object.owner.ObjectOwner === oldVisual.id, 'ROOT_VISUAL')
  check(c.assembly.scopes.length <= 64 && new Set(c.assembly.scopes.map(scopeKey)).size === c.assembly.scopes.length
    && c.assembly.profiles.size === String(c.assembly.scopes.length) && c.assembly.palettes.size === String(c.assembly.scopes.length), 'PROFILE_COVERAGE')
  const profiles: ReturnType<typeof ManagementProfileBcs.parse>[] = [], palettes: ReturnType<typeof ManagementColorBcs.parse>[][] = []
  const scopeType = `${model}::assembly::Scope`, ProfileField = bcs.struct('Field', { id: bcs.Address, name: ManagementScopeBcs, value: ManagementProfileBcs })
  const PaletteField = bcs.struct('Field', { id: bcs.Address, name: ManagementScopeBcs, value: bcs.vector(ManagementColorBcs) })
  for (const scope of c.assembly.scopes) {
    const profileId = deriveDynamicFieldID(c.assembly.profiles.id, scopeType, ManagementScopeBcs.serialize(scope).toBytes())
    const paletteId = deriveDynamicFieldID(c.assembly.palettes.id, scopeType, ManagementScopeBcs.serialize(scope).toBytes())
    async function entry(id: string, uid: string, type: string, role: 'PROFILE' | 'PALETTE') {
      const before = await nested('input', uid, id, type, role, (bytes, parent) => {
        const root = composition(bytes); check((role === 'PROFILE' ? root.assembly.profiles.id : root.assembly.palettes.id) === parent
          && root.assembly.scopes.some(value => scopeKey(value) === scopeKey(scope)), 'PROFILE_PARENT')
      })
      const after = await nested('written', uid, id, type, role, (bytes, parent) => {
        const root = composition(bytes); check((role === 'PROFILE' ? root.assembly.profiles.id : root.assembly.palettes.id) === parent, 'PROFILE_PARENT')
      })
      check(toBase64(before.bytes) === toBase64(after.bytes), 'PROFILE_OR_PALETTE_CHANGED'); return before.bytes
    }
    const profileBytes = await entry(profileId, c.assembly.profiles.id, `0x2::dynamic_field::Field<${scopeType},${model}::assembly::Profile>`, 'PROFILE')
    const paletteBytes = await entry(paletteId, c.assembly.palettes.id, `0x2::dynamic_field::Field<${scopeType},vector<${visualTypeOrigin}::visual::ColorChoice>>`, 'PALETTE')
    const profile = ProfileField.parse(profileBytes), palette = PaletteField.parse(paletteBytes)
    check(ProfileField.serialize(profile).toBase64() === toBase64(profileBytes) && profile.id === profileId && scopeKey(profile.name) === scopeKey(scope)
      && scopeKey(profile.value.scope) === scopeKey(scope) && profile.value.parent && scopeKey(profile.value.parent) === scopeKey(c.assembly.root)
      && PaletteField.serialize(palette).toBase64() === toBase64(paletteBytes) && palette.id === paletteId && scopeKey(palette.name) === scopeKey(scope), 'PROFILE_FIELD')
    profiles.push(profile.value); palettes.push(palette.value)
  }
  const oldVariants = await optional('ActiveVariantsKey', 'input'), nextVariants = await optional('ActiveVariantsKey', 'written')
  check(oldVariants.proof.status === nextVariants.proof.status, 'VARIANT_KEY_PRESENCE_CHANGED')
  const variants: ReturnType<typeof ManagementVariantBcs.parse>[] = []
  let activeVariants: ReturnType<typeof ManagementActiveVariantsBcs.parse> | null = null
  if (oldVariants.mapping) {
    check(nextVariants.mapping && Mapping.serialize(oldVariants.mapping).toBase64() === Mapping.serialize(nextVariants.mapping).toBase64(), 'VARIANT_MAPPING_CHANGED')
    const states = []
    for (const snapshot of ['input', 'written'] as const) states.push(await nested(snapshot, oldVariants.id, oldVariants.mapping.value,
      `${app}::character::ActiveVariants`, 'ACTIVE_VARIANTS', bytes => { composition(bytes) }))
    check(toBase64(states[0].bytes) === toBase64(states[1].bytes), 'VARIANT_CARRIER_CHANGED')
    const active = ManagementActiveVariantsBcs.parse(states[0].bytes); activeVariants = active
    check(ManagementActiveVariantsBcs.serialize(active).toBase64() === toBase64(states[0].bytes) && active.id === oldVariants.mapping.value
      && active.scopes.length <= 65 && active.values.size === String(active.scopes.length) && new Set(active.scopes.map(scopeKey)).size === active.scopes.length, 'VARIANT_CARRIER')
    const stateWriter = await readHistoricalParentTransaction({ client, transactionDigest: states[0].writerTransactionDigest, maxCheckpoint: execution.checkpoint,
      chainIdentifier: p.target.chainIdentifier, genesisDigest: MAINNET_GENESIS_DIGEST, signal })
    check(stateWriter.executionStatus === 'Success', 'VARIANT_WRITER')
    const Field = bcs.struct('Field', { id: bcs.Address, name: ManagementScopeBcs, value: ManagementVariantBcs })
    for (const scope of active.scopes) {
      const id = deriveDynamicFieldID(active.values.id, scopeType, ManagementScopeBcs.serialize(scope).toBytes())
      const proof = await readApplicationContainedHistoricalChild({ client, anchorEffects: stateWriter.effects, anchorTransactionDigest: stateWriter.transactionDigest,
        anchorCheckpoint: stateWriter.checkpoint, anchorMode: 'written', rootId: active.id, rootType: `${app}::character::ActiveVariants`, rootOwnerId: oldVariants.id,
        parentUid: active.values.id, childId: id, childType: `0x2::dynamic_field::Field<${scopeType},${model}::assembly::Variant>`, chainIdentifier: p.target.chainIdentifier,
        genesisDigest: MAINNET_GENESIS_DIGEST, signal, maxHops, assertContainsParent(bytes, uid) {
          const value = ManagementActiveVariantsBcs.parse(bytes); check(ManagementActiveVariantsBcs.serialize(value).toBase64() === toBase64(bytes)
            && value.id === active.id && value.values.id === uid && value.scopes.some(row => scopeKey(row) === scopeKey(scope)), 'VARIANT_PARENT')
        } })
      histories.push({ role: 'VARIANT_VALUE', snapshot: 'both', id, writer: proof.writerTransactionDigest })
      const field = Field.parse(proof.bytes)
      check(Field.serialize(field).toBase64() === toBase64(proof.bytes) && field.id === id && scopeKey(field.name) === scopeKey(scope)
        && scopeKey(field.value.original.scope) === scopeKey(scope), 'VARIANT_FIELD'); variants.push(field.value)
      // Do not permit descendant changes hidden behind an unchanged carrier.
      check(!execution.effects.V2!.changedObjects.some(([objectId]) => objectId === id), 'VARIANT_FIELD_CHANGED')
    }
  }
  signal.throwIfAborted()
  return { ...evidence, model: { rootVisual, profiles, palettes, variants, activeVariants, histories,
    originalObjectIds: [...new Set([rootVisual.id, ...(activeVariants ? [activeVariants.id] : []), ...histories.map(row => row.id)])], variantInputHistory: oldVariants.proof, variantOutputHistory: nextVariants.proof,
    originalModelMetadataVerified: true as const, requiresQualifiedPermanentAndParentCommitInvariants: true as const,
    requiresPolicyRecipeSemanticAndFullApplicationCommitment: true as const, completeBusinessOutputVerified: false as const }, completeBusinessOutputVerified: false as const }
}
