import { afterEach, expect, it, vi } from 'vitest'
import { EncryptedObject } from '../../web/node_modules/@mysten/seal/dist/index.mjs'
import { decryptPrivateBookmarkLibrary, encryptPrivateBookmarkLibrary, privateBookmarkAad,
  PrivateBookmarkEnvelopeBcs, validatePrivateBookmarkEnvelope } from '../../web/lib/bookmarks/private-bookmark-crypto'
import { bookmarkCryptoFixture as fixture, bid, bhash } from './fixtures/private-bookmark-crypto'

afterEach(() => vi.restoreAllMocks())
it('roundtrips actual AES/weighted Seal while exposing no bookmark ID, count or operation in public AAD', async () => {
  const f = await fixture(), bytes = await f.encryptBytes()
  expect(await f.decryptBytes(bytes)).toEqual(f.library)
  const aad = new TextDecoder().decode(privateBookmarkAad(f.context))
  expect(aad).not.toContain(f.soulId); expect(aad).not.toMatch(/entries|bookmarked|requestHash|createdAt|count|action/)
  expect(new TextDecoder().decode(bytes)).not.toContain(f.soulId)
  expect(f.verify).toHaveBeenCalledTimes(4)
  for (const key of f.keys) expect(key.every(v => v === 0)).toBe(true)
})
it('uses a fresh key and IV for each preparation, never deterministic plaintext hashes', async () => {
  const f = await fixture(), first = await f.encryptBytes(), second = await f.encryptBytes()
  expect(first).not.toEqual(second)
  expect(PrivateBookmarkEnvelopeBcs.parse(first).iv).not.toEqual(PrivateBookmarkEnvelopeBcs.parse(second).iv)
})
it.each(['owner', 'registryId', 'originalPackageId', 'chainIdentifier', 'revision', 'requestId'] as const)(
  'rejects %s transplantation before asking for a decrypted key', async field => {
    const f = await fixture(), bytes = await f.encryptBytes(), context = structuredClone(f.context)
    if (field === 'owner' || field === 'registryId') context.scope[field] = bid(999)
    else context[field] = field === 'chainIdentifier' ? '00000001' : field === 'revision' ? '2' : field === 'requestId' ? bhash(99) : bid(999)
    await expect(decryptPrivateBookmarkLibrary({ bytes, context, sealConfig: f.sealConfig, signal: f.controller.signal,
      unwrap: f.unwrap, verify: f.verify })).rejects.toThrow()
    expect(f.unwrap).not.toHaveBeenCalled()
  })
it.each(['iv', 'ciphertext', 'aad', 'version', 'trailing'] as const)('rejects modified outer %s', async field => {
  const f = await fixture(), value = PrivateBookmarkEnvelopeBcs.parse(await f.encryptBytes())
  if (field === 'iv' || field === 'ciphertext' || field === 'aad') value[field][0] ^= 1
  if (field === 'version') value.version = 2
  const bytes = PrivateBookmarkEnvelopeBcs.serialize(value).toBytes()
  await expect(f.decryptBytes(field === 'trailing' ? new Uint8Array([...bytes, 0]) : bytes)).rejects.toThrow()
  for (const key of f.keys) expect(key.every(v => v === 0)).toBe(true)
})
it.each(['package', 'id', 'threshold', 'services', 'indices', 'aad', 'size', 'shares'] as const)('rejects modified Seal %s before unwrap', async field => {
  const f = await fixture(), envelope = PrivateBookmarkEnvelopeBcs.parse(await f.encryptBytes())
  const wrapped = EncryptedObject.parse(new Uint8Array(envelope.wrapped_dek))
  if (field === 'package') wrapped.packageId = bid(999)
  if (field === 'id') wrapped.id = bhash(999)
  if (field === 'threshold') wrapped.threshold = 1
  if (field === 'services') wrapped.services[0][0] = bid(999)
  if (field === 'indices') wrapped.services[0][1] = 0
  if (field === 'aad') wrapped.ciphertext.Aes256Gcm!.aad![0] ^= 1
  if (field === 'size') wrapped.ciphertext.Aes256Gcm!.blob = new Uint8Array(49)
  if (field === 'shares') wrapped.encryptedShares.BonehFranklinBLS12381!.encryptedShares.pop()
  envelope.wrapped_dek = [...EncryptedObject.serialize(wrapped).toBytes()]
  await expect(f.decryptBytes(PrivateBookmarkEnvelopeBcs.serialize(envelope).toBytes())).rejects.toThrow()
  expect(f.unwrap).not.toHaveBeenCalled()
})
it.each(['before-encrypt', 'after-encrypt', 'after-decrypt'] as const)('rejects changed authority %s and zeroes all issued keys', async when => {
  const f = await fixture()
  if (when === 'before-encrypt') f.verify.mockRejectedValueOnce(new Error('changed'))
  if (when === 'after-encrypt') f.verify.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('changed'))
  if (when === 'after-decrypt') {
    const bytes = await f.encryptBytes(); f.verify.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('changed'))
    await expect(f.decryptBytes(bytes)).rejects.toThrow('changed')
  } else await expect(f.encryptBytes()).rejects.toThrow('changed')
  for (const key of f.keys) expect(key.every(v => v === 0)).toBe(true)
})
it('captures the whole input before any asynchronous authority check', async () => {
  const f = await fixture(), expected = structuredClone(f.library), context = structuredClone(f.context)
  f.verify.mockImplementationOnce(async () => {
    f.library.entries[0].soulId = bid(999); f.context.requestId = bhash(999); f.sealConfig.threshold = 1
  })
  const bytes = await f.encryptBytes()
  const config = { ...f.sealConfig, threshold: 2 }
  expect(await decryptPrivateBookmarkLibrary({ bytes, context, sealConfig: config, signal: f.controller.signal, unwrap: f.unwrap, verify: async () => {} })).toEqual(expected)
})
it('rejects extra public context fields instead of leaking a plaintext intent', async () => {
  const f = await fixture(); Object.assign(f.context, { soulId: f.soulId })
  await expect(f.encryptBytes()).rejects.toThrow('CRYPTO_CONTEXT_INVALID')
  expect(f.seal.encrypt).not.toHaveBeenCalled()
})
it('checks the encrypted intent against context before any key-server work', async () => {
  const f = await fixture(); f.context.requestId = bhash(2)
  await expect(f.encryptBytes()).rejects.toThrow('ENCRYPT_INTENT_MISMATCH')
  expect(f.seal.encrypt).not.toHaveBeenCalled()
})
it('does not let an abandoned unwrap retain a late returned key', async () => {
  const f = await fixture(), bytes = await f.encryptBytes(), lateKey = new Uint8Array(32).fill(11)
  let resolve!: (key: Uint8Array) => void
  f.unwrap.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const waiting = f.decryptBytes(bytes), rejected = expect(waiting).rejects.toThrow('wallet changed')
  await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
  f.controller.abort(new Error('wallet changed')); await rejected
  resolve(lateKey); await vi.waitFor(() => expect(lateKey.every(v => v === 0)).toBe(true))
})
it('rejects malformed secret length and wipes returned key material', async () => {
  const f = await fixture(), bytes = await f.encryptBytes(), wrong = new Uint8Array(31).fill(1)
  f.unwrap.mockResolvedValueOnce(wrong)
  await expect(f.decryptBytes(bytes)).rejects.toThrow('DEK_SIZE')
  expect(wrong.every(v => v === 0)).toBe(true)
})
it('requires explicit public key configuration and cannot accept a secret API key', async () => {
  const f = await fixture(); Object.assign(f.sealConfig.serverConfigs[0], { apiKey: 'PRIVATE' })
  await expect(f.encryptBytes()).rejects.toThrow()
  expect(f.seal.encrypt).not.toHaveBeenCalled()
})
it('validates envelope bounds before parsing huge or empty data', async () => {
  const f = await fixture()
  for (const bytes of [new Uint8Array(), new Uint8Array(16 * 1024 * 1024 + 1)]) await expect(validatePrivateBookmarkEnvelope({
    bytes, context: f.context, sealConfig: f.sealConfig })).rejects.toThrow('ENVELOPE_SIZE')
})
