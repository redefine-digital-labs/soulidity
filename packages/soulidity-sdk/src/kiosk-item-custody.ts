import { bcs } from '@mysten/sui/bcs'
import { deriveDynamicFieldID, normalizeStructTag, toBase64 } from '@mysten/sui/utils'

// Kiosk.place/lock/list retain this dynamic-object-field relationship. The
// asset's direct ObjectOwner is the Field UID, not the logical Kiosk owner.
// Callers must verify the field's raw type/owner/version/digest in their own
// current or historical read set; these pure helpers do not perform RPC reads.
export const KIOSK_ITEM_WRAPPER_TYPE = normalizeStructTag('0x2::dynamic_object_field::Wrapper<0x2::kiosk::Item>')
export const KIOSK_ITEM_FIELD_TYPE = normalizeStructTag(`0x2::dynamic_field::Field<${KIOSK_ITEM_WRAPPER_TYPE},0x2::object::ID>`)
export const KIOSK_ITEM_FIELD_BYTES = 96
export const KioskItemBcs = bcs.struct('Item', { id: bcs.Address })
export const KioskItemWrapperBcs = bcs.struct('Wrapper', { name: KioskItemBcs })
export const KioskItemFieldBcs = bcs.struct('Field', { id: bcs.Address, name: KioskItemWrapperBcs, value: bcs.Address })

function id(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/.test(value) || /^0x0+$/.test(value))
    throw new Error('KIOSK_ITEM_CUSTODY_INVALID_ID')
}
export function deriveKioskItemFieldId(kioskId: string, itemId: string): string {
  id(kioskId); id(itemId)
  if (kioskId === itemId) throw new Error('KIOSK_ITEM_CUSTODY_OBJECT_ALIAS')
  return deriveDynamicFieldID(kioskId, KIOSK_ITEM_WRAPPER_TYPE, KioskItemWrapperBcs.serialize({ name: { id: itemId } }).toBytes())
}
export function assertKioskItemField(bytes: Uint8Array, kioskId: string, itemId: string): string {
  const fieldId = deriveKioskItemFieldId(kioskId, itemId)
  if (!(bytes instanceof Uint8Array) || bytes.length !== KIOSK_ITEM_FIELD_BYTES)
    throw new Error('KIOSK_ITEM_CUSTODY_INVALID_BCS')
  const field = KioskItemFieldBcs.parse(bytes)
  if (field.id !== fieldId || field.name.name.id !== itemId || field.value !== itemId
    || toBase64(KioskItemFieldBcs.serialize(field).toBytes()) !== toBase64(bytes))
    throw new Error('KIOSK_ITEM_CUSTODY_FIELD_MISMATCH')
  return fieldId
}
