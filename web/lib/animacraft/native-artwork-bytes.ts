import { sha256 } from '@noble/hashes/sha2.js'
import { fromBase64, toBase64, toHex } from '@mysten/sui/utils'
import { equipmentUtf8 } from './native-equipment-bytes'

export const nativeArtworkHex = (bytes: Uint8Array | readonly number[]) => toHex(Uint8Array.from(bytes))
export const nativeArtworkHash = (bytes: Uint8Array | string) => sha256(typeof bytes === 'string' ? equipmentUtf8(bytes) : bytes)
export function nativeArtworkBlobId(value: string): boolean {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return false
  try {
    const bytes = fromBase64(value.replace(/-/g, '+').replace(/_/g, '/') + '=')
    return bytes.length === 32 && toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') === value
  } catch { return false }
}
export function nativeArtworkConcat(chunks: readonly Uint8Array[], length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  if (offset !== length) throw new Error('Artwork byte length mismatch')
  return bytes
}
