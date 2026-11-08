import { bcs } from '@mysten/sui/bcs'
import { deriveDynamicFieldID, toBase64, toHex } from '@mysten/sui/utils'
import { sha256 } from '@noble/hashes/sha2.js'
import { readHistoricalMoveObject } from '../../sui/historical-object'
import { ManagementPartBcs, ManagementStoredBindingBcs, ManagementLayoutBcs, ManagementAdapterBcs } from './application-bcs'
import { parseFormsManagementRecord } from './application-forms-record'
import { readFormsHistoricalCompositionMembership } from './application-forms-historical-composition-membership'
function check(v: unknown, code: string): asserts v { if (!v) throw Error(`APPLICATION_FORMS_SLOTS_${code}`) }
/** Qualified Character ACTIVATE removes every old binding before installing
 * selections. Thus original effects must contain every old slot input; metadata
 * cardinality closes enumeration. This code invariant must remain qualified.
 * Ref/Bound source inventories and actual Item bodies remain separate proofs. */
export async function readFormsHistoricalSlots(input: Parameters<typeof readFormsHistoricalCompositionMembership>[0]) {
  const record = parseFormsManagementRecord(input.record), p = record.plan
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(60000)])
  const evidence = await readFormsHistoricalCompositionMembership({ ...input, record, signal })
  if (evidence.status !== 'HISTORICAL_COMPOSITION_MEMBERSHIP_EVIDENCE') return evidence
  const before = evidence.compositionBefore, after = evidence.compositionAfter
  check(BigInt(before.slots.size) <= 512n, 'BOUND')
  const partType = `${p.target.model.originalPackageId}::assembly::PartKey`, type = `0x2::dynamic_field::Field<${partType},${p.target.application.originalPackageId}::character::StoredBinding>`
  const Field = bcs.struct('Field', { id: bcs.Address, name: ManagementPartBcs, value: ManagementStoredBindingBcs })
  const inputs: Array<{ part: ReturnType<typeof ManagementPartBcs.parse>; binding: ReturnType<typeof ManagementStoredBindingBcs.parse> }> = [], outputs: typeof inputs = []
  const locations = new Set<string>()
  for (let i = 0; i < before.assembly.parts.length; i++) {
    const part = before.assembly.parts[i], partBytes = ManagementPartBcs.serialize(part).toBytes()
    const id = deriveDynamicFieldID(before.slots.id, partType, partBytes)
    const changes = evidence.effects.V2!.changedObjects.filter(([objectId]) => objectId === id)
    check(changes.length <= 1, 'EFFECTS_ALIAS')
    const change = changes[0]?.[1]
    const args = { client: input.client, effects: evidence.effects, transactionDigest: evidence.transactionDigest,
      objectId: id, type, signal, maxBytes: 256 * 1024 }
    async function read(mode: 'input' | 'written') {
      const object = await readHistoricalMoveObject({ ...args, mode }), row = Field.parse(object.bytes)
      check(Field.serialize(row).toBase64() === toBase64(object.bytes) && row.id === id
        && object.object.owner.ObjectOwner === before.slots.id && ManagementPartBcs.serialize(row.name).toBase64() === toBase64(partBytes), 'FIELD')
      check([row.value.reference, row.value.bound, row.value.item].filter(value => value !== null).length === 1, 'RIGHTS_POINTER')
      return row.value
    }
    if (change?.inputState.Exist) {
      const binding = await read('input'), key = binding.item !== null ? `item:${binding.item}` : binding.bound !== null ? `bound:${binding.bound}` : `reference:${binding.reference}`
      check(!locations.has(key), 'INPUT_ALIAS'); locations.add(key); inputs.push({ part, binding })
    }
    const choice = evidence.captured.selections[i].selection, source = evidence.captured.sources[i].binding
    if (choice.$kind === 'Empty') { check(!change || change.outputState.$kind === 'NotExist', 'EMPTY_OUTPUT'); continue }
    const binding = await read('written'), selected = choice.Free ?? choice.Bound ?? choice.Reference
    check(selected && source && ManagementLayoutBcs.serialize(binding.layout).toBase64() === ManagementLayoutBcs.serialize(selected.layout).toBase64()
      && binding.item === (choice.Free?.id ?? null) && binding.bound === (choice.Bound?.index ?? null)
      && binding.reference === (choice.Reference?.index ?? null)
      && (binding.adapter === null ? source.adapter === null : toHex(sha256(ManagementAdapterBcs.serialize(binding.adapter).toBytes())) === toHex(source.adapter ?? new Uint8Array())), 'OUTPUT_BINDING')
    outputs.push({ part, binding })
  }
  check(String(inputs.length) === before.slots.size && String(outputs.length) === after.slots.size, 'INCOMPLETE')
  signal.throwIfAborted()
  return { ...evidence, status: 'HISTORICAL_SLOT_BINDINGS_EVIDENCE' as const, slotInputs: inputs, slotOutputs: outputs,
    originalSoulItemIds: inputs.flatMap(row => row.binding.item === null ? [] : [row.binding.item]),
    slotBindingsVerified: true as const, requiresQualifiedAllSlotsTouchedInvariant: true as const,
    requiresItemConservationProof: true as const, completeBusinessOutputVerified: false as const }
}
