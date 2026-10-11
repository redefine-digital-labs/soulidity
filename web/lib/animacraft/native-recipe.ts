import { bcs } from '@mysten/sui/bcs'
import { nativeArtworkHex } from './native-artwork-bytes'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, normalizeStructTag } from '@mysten/sui/utils'
import { readNativeArtworkOutput } from './native-artwork'
import { EquipmentSelectionBcs, EquipmentDefinitionSlotBcs, EquipmentAttachedPackDefinitionBcs, equipmentCommitment } from './native-equipment'
import { decodeNativeBcs, NativeReceiveError, type NativeReceiveTarget } from './native-receive'

export const CompleteRecipeKeyBcs = bcs.struct('CompleteRecipeKeyV8', { dummy_field: bcs.bool() })
export const CompleteRecipeSnapshotBcs = bcs.struct('CompleteRecipeSnapshotV8', {
  version: bcs.u64(), attached_pack_definitions: bcs.vector(EquipmentAttachedPackDefinitionBcs),
  definition_slots: bcs.vector(EquipmentDefinitionSlotBcs), selections: bcs.vector(bcs.option(EquipmentSelectionBcs)),
})
export const CompleteRecipeFieldBcs = bcs.struct('Field', {
  id: bcs.Address, name: CompleteRecipeKeyBcs, value: CompleteRecipeSnapshotBcs,
})
function check(value: unknown, message: string): asserts value {
  if (!value) throw new NativeReceiveError('NATIVE_RECIPE_INVALID', message)
}

/** Historical facts only. These rows do not grant current equipment or decrypt
 * authority. Never fetch a live Player loadout to reconstruct a completed OC. */
export async function readNativeRecipe(client: SuiGrpcClient, target: NativeReceiveTarget,
  input: { soulId: string; stateId: string }) {
  const { proof, output, types } = await readNativeArtworkOutput(client, target, input, { completedRecipe: true })
  check(types.recipeTypes, 'Exact completed recipe type origins required')
  const fieldId = deriveDynamicFieldID(output.id, types.recipeTypes.key, CompleteRecipeKeyBcs.serialize({ dummy_field: false }).toBytes())
  const { response } = await client.ledgerService.batchGetObjects({ requests: [{ objectId: fieldId }],
    readMask: { paths: ['object_id', 'version', 'owner', 'object_type', 'contents'] } })
  check(response.objects.length === 1, 'Missing completed recipe response')
  const result = response.objects[0].result
  if (result.oneofKind === 'error') {
    if (result.error.code === 5) return { status: 'MISSING' as const, artwork: proof }
    throw new NativeReceiveError('NATIVE_RECIPE_UNAVAILABLE', 'Completed recipe lookup failed', 503)
  }
  check(result.oneofKind === 'object', 'Malformed completed recipe response')
  const object = result.object
  const fieldType = `0x2::dynamic_field::Field<${types.recipeTypes.key},${types.recipeTypes.snapshot}>`
  check(object.objectId === fieldId && object.version !== undefined && object.version > 0n
    && object.owner?.kind === 2 && object.owner.address === output.id
    && object.objectType && normalizeStructTag(object.objectType) === normalizeStructTag(fieldType),
  'Completed recipe field identity/type/custody mismatch')
  const field = decodeNativeBcs(CompleteRecipeFieldBcs, object.contents?.value)
  check(field.id === fieldId && field.name.dummy_field === false && field.value.version === '8'
    && field.value.selections.length > 0 && field.value.selections.length <= 500, 'Completed recipe version/slots mismatch')
  field.value.selections.forEach((selection, index) => {
    if (selection === null) return
    check(selection.selection_index === String(index) && [0, 1, 2].includes(selection.source_class),
      'Completed recipe slot/source mismatch')
  })
  const recipe = { version: field.value.version, root_id: output.root_id, root_version: output.maker_version,
    root_content_commitment: output.root_content_commitment, attached_pack_definitions: field.value.attached_pack_definitions,
    definition_slots: field.value.definition_slots, selections: field.value.selections }
  const attached = new Set<string>()
  check(recipe.attached_pack_definitions.length <= 500, 'Completed recipe attachment count mismatch')
  for (const entry of recipe.attached_pack_definitions) {
    check(entry.release_id !== output.root_id && !attached.has(entry.release_id)
      && entry.definition_commitment.length === 32, 'Completed recipe attachment identity mismatch')
    attached.add(entry.release_id)
  }
  let end = 0n
  const keys = new Set<string>()
  for (const slot of recipe.definition_slots) {
    const capacity = BigInt(slot.capacity)
    const slotKey = `${slot.source_definition_id}/${slot.part_key}`
    check((slot.source_definition_id === output.root_id || attached.has(slot.source_definition_id))
      && slot.part_key.length > 0 && !keys.has(slotKey)
      && slot.profile_commitment.length === 32 && BigInt(slot.start) === end && capacity > 0n && capacity <= 64n
      && end + capacity <= BigInt(recipe.selections.length), 'Completed recipe definition slot mismatch')
    for (let index = Number(end); index < Number(end + capacity); index++) {
      const selection = recipe.selections[index]
      check(!selection || selection.part_key === slot.part_key && (slot.source_definition_id === output.root_id
        || selection.source_class === 1 && selection.source_definition_id === slot.source_definition_id),
        'Completed recipe selection definition mismatch')
    }
    keys.add(slotKey); end += capacity
  }
  check(end === BigInt(recipe.selections.length), 'Completed recipe definition slot coverage mismatch')
  check(output.loadout_commitment.length === 32
    && equipmentCommitment(recipe) === nativeArtworkHex(output.loadout_commitment), 'Completed recipe commitment mismatch')
  return { status: 'AVAILABLE' as const, artwork: proof, output, recipe }
}
