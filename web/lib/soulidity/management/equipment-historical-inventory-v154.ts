import { bcs } from '@mysten/sui/bcs'
import { deriveDynamicFieldID, fromBase64, toBase64 } from '@mysten/sui/utils'
import { MAINNET_GENESIS_DIGEST } from '../../animacraft/mainnet-chain'
import { readHistoricalMoveObject } from '../../sui/historical-object'
import { readHistoricalChildThroughOwnedParent } from '../../sui/historical-owned-parent'
import { moveEmptyStructBytes } from '../../sui/move-empty-struct'
import { ManagementCompositionBcs, ManagementPartBcs, ManagementStoredBindingBcs } from './application-bcs'
import { parseEquipmentManagementRecord } from './equipment-record'
import { captureAccountOriginalReadClientV155 } from './account-original-readers-v155'
import { readEquipmentHistoricalSlot } from './equipment-historical-slot'

type Binding = ReturnType<typeof ManagementStoredBindingBcs.parse>
type Row = { partBcs: string; part: ReturnType<typeof ManagementPartBcs.parse>; binding: Binding }
function check(value: unknown, code: string): asserts value { if (!value) throw Error(`MANAGEMENT_EQUIPMENT_INVENTORY_V154_${code}`) }
const encoded = (binding: Binding) => ManagementStoredBindingBcs.serialize(binding).toBase64()
/** Complete occupied-slot relation at original input/output snapshots, conditional
 * on canonical Table cardinality and source-qualified parent-commit invariants.
 * Candidate names never grant membership. Source bodies and eligibility, gas
 * and remaining effects are NOT proved, so this cannot produce SUCCEEDED. */
export async function readEquipmentHistoricalInventoryV154(input: Parameters<typeof readEquipmentHistoricalSlot>[0] & {
  originalOccupiedPartBcs: readonly string[]
}) {
  const record = parseEquipmentManagementRecord(input.record), p = record.plan, client = captureAccountOriginalReadClientV155(input.client, input.signal)
  const standardTypeOrigin = input.standardTypeOrigin, compositionId = input.compositionId, maxHops = input.maxHops
  check(Array.isArray(input.originalOccupiedPartBcs) && input.originalOccupiedPartBcs.length <= 512, 'CANDIDATE_BOUND')
  const candidates = [...input.originalOccupiedPartBcs]
  check(candidates.every(value => typeof value === 'string' && value.length > 0 && value.length <= 8192), 'PART_BOUND')
  for (const value of candidates) check(ManagementPartBcs.serialize(ManagementPartBcs.parse(fromBase64(value))).toBase64() === value, 'PART_CANONICAL')
  check(new Set(candidates).size === candidates.length, 'CANDIDATE_ALIAS')
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(120000)])
  signal.throwIfAborted()
  const evidence = await readEquipmentHistoricalSlot({ client, record, standardTypeOrigin, compositionId, maxHops, signal })
  if (!evidence.slot) return { ...evidence, inventory: null }
  const execution = evidence.execution
  check(execution.status === 'FINALIZED_EXECUTION', 'FINALITY')
  const slot = evidence.slot, before = slot.compositionBefore, after = slot.compositionAfter
  const parts = before.assembly.parts.map(part => ManagementPartBcs.serialize(part).toBase64())
  check(candidates.every(part => parts.includes(part)) && BigInt(candidates.length) === BigInt(before.slots.size), 'ORIGINAL_COVERAGE')
  check(candidates.includes(p.partBcs) === (p.action.kind !== 'ATTACH'), 'TARGET_INPUT_MEMBERSHIP')
  const app = p.target.application.originalPackageId, partType = `${p.target.model.originalPackageId}::assembly::PartKey`
  const fieldType = `0x2::dynamic_field::Field<${partType},${app}::character::StoredBinding>`
  const Field = bcs.struct('Field', { id: bcs.Address, name: ManagementPartBcs, value: ManagementStoredBindingBcs })
  const rootOwnerId = deriveDynamicFieldID(p.applicationId, `0x2::dynamic_object_field::Wrapper<${app}::character::CompositionKey>`, moveEmptyStructBytes())
  const common = { client, effects: execution.effects, transactionDigest: record.packet.digest, signal, maxBytes: 256 * 1024 }
  const histories: Array<{ partBcs: string; snapshot: 'input' | 'written'; proof: Awaited<ReturnType<typeof readHistoricalChildThroughOwnedParent>> }> = []
  async function binding(partBcs: string, mode: 'input' | 'written') {
    const id = deriveDynamicFieldID(before.slots.id, partType, fromBase64(partBcs))
    const changes = execution.effects.V2!.changedObjects.filter(([objectId]) => objectId === id)
    check(changes.length <= 1, 'SLOT_EFFECT_ALIAS')
    let bytes: Uint8Array
    if (changes.length) {
      const row = await readHistoricalMoveObject({ ...common, objectId: id, type: fieldType, mode: mode === 'input' ? 'input' : 'mutated' })
      check(row.object.owner.ObjectOwner === before.slots.id, 'FIELD_OWNER'); bytes = row.bytes
    } else {
      const proof = await readHistoricalChildThroughOwnedParent({ client, anchorEffects: execution.effects, anchorTransactionDigest: record.packet.digest,
        anchorCheckpoint: execution.checkpoint, anchorMode: mode, rootId: before.id, rootType: `${app}::character::Composition`, rootOwnerId,
        childId: id, childType: fieldType, chainIdentifier: p.target.chainIdentifier, genesisDigest: MAINNET_GENESIS_DIGEST, signal, maxHops,
        nestedParent: { uid: before.slots.id, assertContainsParent(bytes, uid) {
          const value = ManagementCompositionBcs.parse(bytes)
          check(ManagementCompositionBcs.serialize(value).toBase64() === toBase64(bytes) && value.id === before.id && value.slots.id === uid, 'CONTAINMENT')
        } }, assertRoot(bytes) {
          const value = ManagementCompositionBcs.parse(bytes), limit = mode === 'input' ? before.revision : after.revision
          check(ManagementCompositionBcs.serialize(value).toBase64() === toBase64(bytes) && value.id === before.id
            && BigInt(value.revision) <= BigInt(limit) && value.assembly.parts.some(part => ManagementPartBcs.serialize(part).toBase64() === partBcs), 'COMPOSITION_HISTORY')
        } })
      histories.push({ partBcs, snapshot: mode, proof }); bytes = proof.bytes
    }
    const row = Field.parse(bytes)
    check(Field.serialize(row).toBase64() === toBase64(bytes) && row.id === id && ManagementPartBcs.serialize(row.name).toBase64() === partBcs
      && [row.value.reference, row.value.bound, row.value.item].filter(value => value !== null).length === 1, 'FIELD_BINDING')
    return row.value
  }
  const inputs: Row[] = [], outputs: Row[] = []
  for (const partBcs of parts) {
    if (partBcs === p.partBcs) {
      if (slot.inputBinding) inputs.push({ partBcs, part: ManagementPartBcs.parse(fromBase64(partBcs)), binding: slot.inputBinding })
      if (slot.outputBinding) outputs.push({ partBcs, part: ManagementPartBcs.parse(fromBase64(partBcs)), binding: slot.outputBinding })
    } else if (candidates.includes(partBcs)) {
      const old = await binding(partBcs, 'input'), next = await binding(partBcs, 'written')
      check(encoded(old) === encoded(next), 'UNRELATED_BINDING_CHANGED')
      const part = ManagementPartBcs.parse(fromBase64(partBcs)); inputs.push({ partBcs, part, binding: old }); outputs.push({ partBcs, part, binding: next })
    }
  }
  function pointers(rows: Row[]) {
    const keys = rows.map(({ binding: value }) => value.item !== null ? `ITEM:${value.item}` : value.bound !== null ? `BOUND:${value.bound}` : `REFERENCE:${value.reference}`)
    check(new Set(keys).size === keys.length, 'RIGHTS_POINTER_ALIAS')
    return keys
  }
  check(String(inputs.length) === before.slots.size && String(outputs.length) === after.slots.size, 'SNAPSHOT_CARDINALITY')
  const inputPointers = pointers(inputs), outputPointers = pointers(outputs)
  signal.throwIfAborted()
  return { ...evidence, inventory: { status: 'ORIGINAL_EQUIPMENT_OCCUPIED_SLOT_INVENTORY_VERIFIED' as const,
    transactionDigest: record.packet.digest, checkpoint: execution.checkpoint, inputs, outputs, inputPointers, outputPointers, histories,
    untouchedBindingsPreserved: true as const, occupiedSlotCardinalityVerified: true as const,
    requiresQualifiedTableCardinalityInvariant: true as const, requiresQualifiedParentCommitInvariant: true as const,
    requiresAllReferenceBoundItemSources: true as const, requiresSourceAdapterSemanticEligibility: true as const,
    requiresGasAndAllEffectsConservation: true as const, completeBusinessOutputVerified: false as const }, completeBusinessOutputVerified: false as const }
}
