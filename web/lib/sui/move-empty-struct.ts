import { bcs } from '@mysten/sui/bcs'

/** Current pinned Sui Move compiler represents an empty struct using a false
 * dummy_field. Native Content/Authorization/Paid/Configuration keys were
 * independently checked in the actual local Native VM, not a JS fixture.
 * This is a layout codec, not authority or a legacy-schema conversion. */
export const MoveEmptyStructBcs = bcs.struct('EmptyStruct', {
  dummy_field: bcs.bool().transform({
    input: (value: false) => value,
    output: value => { if (value) throw Error('MOVE_EMPTY_STRUCT_NONZERO_DUMMY'); return false as const },
  }),
})
export function moveEmptyStructBytes(): Uint8Array {
  return MoveEmptyStructBcs.serialize({ dummy_field: false }).toBytes()
}
