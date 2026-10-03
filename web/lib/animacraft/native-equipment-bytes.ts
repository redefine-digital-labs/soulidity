import { fromBase64, toBase64 } from '@mysten/sui/utils'

export const equipmentUtf8 = (text: string) => new TextEncoder().encode(text)
export const equipmentBytesEqual = (left: Uint8Array, right: Uint8Array) => left.length === right.length
  && left.every((byte, index) => byte === right[index])
/** Same canonical padded Base64 boundary as the original read API. */
export function validEquipmentCursor(cursor: string): boolean {
  if (typeof cursor !== 'string' || cursor.length === 0 || cursor.length > 4096) return false
  try { return toBase64(fromBase64(cursor)) === cursor } catch { return false }
}
