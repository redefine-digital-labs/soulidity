import { expect, it, vi, afterEach } from 'vitest'
import { nativeAssetStorageId, nativeAssetStorageUrl } from '../../web/lib/animacraft/native-asset-storage'
import { nativeArtworkBlobId } from '../../web/lib/animacraft/native-artwork-bytes'
const raw = Buffer.alloc(32, 42).toString('base64url')
const patchBytes = () => {
  const b = new Uint8Array(37); b.set(Buffer.from(raw, 'base64url')); b[32] = 1
  const d = new DataView(b.buffer); d.setUint16(33, 1, true); d.setUint16(35, 13, true)
  return b
}
afterEach(() => vi.unstubAllGlobals())
it('accepts canonical raw and quilt asset locations without widening Soul Blob identities', () => {
  const patch = Buffer.from(patchBytes()).toString('base64url')
  vi.stubGlobal('Buffer', undefined)
  expect(nativeAssetStorageId(raw)).toBe(true)
  expect(nativeAssetStorageId(patch)).toBe(true)
  expect(nativeArtworkBlobId(patch)).toBe(false)
  expect(nativeAssetStorageUrl(raw)).toContain(`/v1/blobs/${raw}`)
  expect(nativeAssetStorageUrl(patch)).toContain(`/v1/blobs/by-quilt-patch-id/${patch}`)
})
it.each(['version', 'zero', 'reverse', 'padding', 'url', 'trailing', 'noncanonical'])('rejects %s patch drift', mode => {
  const b = patchBytes()
  if (mode === 'version') b[32] = 2
  if (mode === 'zero') b[33] = 0
  if (mode === 'reverse') b[35] = 1
  let patch = Buffer.from(b).toString('base64url')
  if (mode === 'padding') patch += '=='
  if (mode === 'url') patch = `https://attacker.example/${patch}`
  if (mode === 'trailing') patch += 'A'
  if (mode === 'noncanonical') patch = patch.slice(0, -1) + 'B'
  vi.stubGlobal('Buffer', undefined)
  expect(nativeAssetStorageId(patch)).toBe(false)
  expect(() => nativeAssetStorageUrl(patch)).toThrow()
})
