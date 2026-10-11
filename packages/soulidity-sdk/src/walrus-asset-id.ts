import { fromBase64, toBase64 } from '@mysten/sui/utils'

const url64 = (bytes: Uint8Array) => toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** An asset may address a raw Blob or a version-1 Quilt patch. Contract-backed
 * Soul bundle proofs still require raw Blob IDs and must not use this parser. */
export function parseWalrusAssetId(value: unknown): { kind: 'blob' | 'quilt-patch'; id: string; blobId: string } | null {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9_-]{43}|[A-Za-z0-9_-]{50})$/.test(value)) return null
  try {
    const bytes = fromBase64(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4))
    if (url64(bytes) !== value) return null
    if (bytes.length === 32) return { kind: 'blob', id: value, blobId: value }
    if (bytes.length !== 37) return null
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    if (view.getUint8(32) !== 1 || view.getUint16(33, true) === 0
      || view.getUint16(35, true) <= view.getUint16(33, true)) return null
    return { kind: 'quilt-patch', id: value, blobId: url64(bytes.subarray(0, 32)) }
  } catch { return null }
}
