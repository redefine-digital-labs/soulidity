import { afterEach, expect, it, vi } from 'vitest'
import { toHex } from '@mysten/sui/utils'
import { sha256 } from '@noble/hashes/sha2.js'
import { contentUploadMaterialCommitment, wrapContentUploadMaterial, unlockContentUploadMaterial,
  validateContentUploadMaterial } from '../../web/lib/soulidity/content-append-preparation'
import { contentAppendPreparationFixture } from './fixtures/content-append-preparation'

afterEach(() => vi.restoreAllMocks())
async function fixture(empty = false) {
  const f = await contentAppendPreparationFixture(empty), dek = new Uint8Array(32).fill(7), iv = new Uint8Array(12).fill(9)
  const key = await crypto.subtle.importKey('raw', dek, 'AES-GCM', false, ['encrypt'])
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, f.params.plaintext))
  const params = { ...f.params, ciphertext, dek, iv, contentHash: toHex(sha256(f.params.plaintext)),
    plaintextByteLength: f.params.plaintext.length }
  return { ...f, params }
}
it.each([false, true])('wraps existing AES bytes without a signature or re-encryption (empty=%s)', async empty => {
  const f = await fixture(empty), original = new Uint8Array(f.params.ciphertext)
  const record = await wrapContentUploadMaterial(f.params), commitment = contentUploadMaterialCommitment(record)
  expect(f.sign).not.toHaveBeenCalled(); expect(f.decryptCall).not.toHaveBeenCalled()
  expect(record.ciphertext).toEqual(original); expect(record.ciphertext).not.toBe(f.params.ciphertext)
  expect(record).not.toHaveProperty('dek'); expect(record).not.toHaveProperty('authorSignature')
  expect(validateContentUploadMaterial(structuredClone(record))).toEqual(record)
  // Caller-owned inputs survive; the low-level function erases only its copies.
  expect(f.params.dek).toEqual(new Uint8Array(32).fill(7))
  const recovered = await unlockContentUploadMaterial(structuredClone(record), commitment, f.params.wallet)
  expect(f.sign).toHaveBeenCalledOnce()
  expect(recovered.plaintext).toEqual(f.params.plaintext); expect(recovered.dek).toEqual(f.params.dek)
  expect(f.unwrapped.every(bytes => bytes.every(b => b === 0))).toBe(true)
  recovered.plaintext.fill(0); recovered.dek.fill(0)
})
it.each(['sidecar', 'intent', 'author', 'payload', 'recovery', 'topology', 'raw-key'])('rejects %s substitution against the parent commitment before unlock', async mutation => {
  const f = await fixture(), record = await wrapContentUploadMaterial(f.params)
  const expected = contentUploadMaterialCommitment(record), changed = structuredClone(record)
  if (mutation === 'sidecar') changed.sidecar.fileName = 'substitution.md'
  if (mutation === 'intent') changed.scope.intentJson = '{"operation":"other"}'
  if (mutation === 'author') changed.scope.author = `0x${'a'.repeat(64)}`
  if (mutation === 'payload') changed.ciphertext[0] ^= 1
  if (mutation === 'recovery') changed.recovery.encrypted = changed.sidecar.encryptedDek
  if (mutation === 'topology') changed.sealConfig.serverConfigs[0].aggregatorUrl = 'https://other.example.com/'
  if (mutation === 'raw-key') Object.assign(changed, { dek: 'secret' })
  await expect(unlockContentUploadMaterial(changed, expected, f.params.wallet)).rejects.toThrow()
  expect(f.sign).not.toHaveBeenCalled(); expect(f.decryptCall).not.toHaveBeenCalled()
})
it.each(['key', 'iv', 'hash', 'length'])('refuses incompatible pre-encrypted %s before any Seal session', async mutation => {
  const f = await fixture()
  if (mutation === 'key') f.params.dek[0] ^= 1
  if (mutation === 'iv') f.params.iv[0] ^= 1
  if (mutation === 'hash') f.params.contentHash = 'a'.repeat(64)
  if (mutation === 'length') f.params.plaintextByteLength++
  await expect(wrapContentUploadMaterial(f.params)).rejects.toThrow()
  expect(f.sign).not.toHaveBeenCalled(); expect(f.decryptCall).not.toHaveBeenCalled()
})
it('snapshots payload, key, scope and metadata before the first await', async () => {
  const f = await fixture(), ciphertext = new Uint8Array(f.params.ciphertext)
  const pending = wrapContentUploadMaterial(f.params)
  f.params.dek.fill(0); f.params.iv.fill(0); f.params.ciphertext.fill(0)
  f.params.scope.intentJson = '{"operation":"mutated"}'; f.params.fileName = 'mutated.md'
  const record = await pending
  expect(record.ciphertext).toEqual(ciphertext)
  expect(record.scope.intentJson).toBe('{"operation":"append"}')
  expect(record.sidecar.fileName).toBe('memory.md')
})
it('rejects wallet invalidation during preparation without signing', async () => {
  const f = await fixture(), pending = wrapContentUploadMaterial(f.params)
  f.controller.abort(new Error('ACCOUNT_CHANGED'))
  await expect(pending).rejects.toThrow('ACCOUNT_CHANGED')
  expect(f.sign).not.toHaveBeenCalled()
})
