import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { Inputs } from '@mysten/sui/transactions'
import { EncryptedObject } from '../../web/node_modules/@mysten/seal/dist/index.mjs'
import { assertNativeCompleteCiphertext, assertNativeCompleteReadTarget, completeReadStep,
  decryptNativeCompleteArtwork } from '../../web/lib/animacraft/native-complete-read-client'
import type { NativeCompleteReadTarget } from '../../web/lib/animacraft/native-complete-read-types'

const mocks = vi.hoisted(() => ({ decrypt: vi.fn(), keys: vi.fn(), create: vi.fn(), signature: vi.fn(), options: vi.fn() }))
vi.mock('../../web/node_modules/@mysten/seal/dist/index.mjs', async importOriginal => ({
  ...await importOriginal<any>(),
  SealClient: class {
    constructor(options: unknown) { mocks.options(options) }
    getKeyServers = mocks.keys
    decrypt = mocks.decrypt
  },
  SessionKey: { create: mocks.create },
}))
const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
function fixture() {
  const aad = new TextEncoder().encode('exact fixture AAD; chain derivation tested by server reader')
  const target: NativeCompleteReadTarget = { schema: 'native-complete-read-v1', soulId: id(1), stateId: id(2),
    owner: id(3), ownershipEpoch: '1', bindingId: id(4), outputId: id(5), receiptId: id(6), rootId: id(7),
    protocolConfigId: id(8), catalogId: id(9), releaseConfigId: id(10), sealRegistryId: id(11), sealPolicyId: id(12),
    paymentCoinType: '0x2::sui::SUI', release: { originalPackageId: id(13), callablePackageId: id(14), callableDigest: '1'.repeat(32) },
    ciphertext: { blobId: Buffer.alloc(32, 15).toString('base64url'), sha256: '',
      sealId: [...createHash('sha256').update(aad).digest()], aadBase64: Buffer.from(aad).toString('base64') },
    policy: { keyServers: [{ objectId: id(16), weight: 2 }, { objectId: id(17), weight: 1 }], threshold: 2,
      maxPlaintextBytes: 1024, cipherSuite: 'BonehFranklinBLS12381DemCCA/AesGcm256',
      keyDerivation: 'SHA3-256:SUI-SEAL-IBE-BLS12381-H2-00:SUI-SEAL-IBE-BLS12381-H3-00', ciphertextFormat: 'Seal/EncryptedObject/BCS/v0' } }
  const encoded = { version: 0, packageId: target.release.originalPackageId, id: sha(aad),
    services: [[id(16), 1], [id(16), 2], [id(17), 3]] as [string, number][], threshold: 2,
    encryptedShares: { BonehFranklinBLS12381: { nonce: new Uint8Array(96),
      encryptedShares: [new Uint8Array(32), new Uint8Array(32), new Uint8Array(32)], encryptedRandomness: new Uint8Array(32) } },
    ciphertext: { Aes256Gcm: { blob: new Uint8Array(60), aad } } }
  const bytes = EncryptedObject.serialize(encoded).toBytes(); target.ciphertext.sha256 = sha(bytes)
  return { target, bytes, encoded }
}
const png = () => {
  const bytes = new Uint8Array(33); bytes.set([137,80,78,71,13,10,26,10]); const v = new DataView(bytes.buffer)
  v.setUint32(8, 13); bytes.set(new TextEncoder().encode('IHDR'), 12); v.setUint32(16, 1); v.setUint32(20, 1)
  return bytes
}
const deferred = <T,>() => { let resolve!: (v: T) => void; let reject!: (e: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const client = { core: { getChainIdentifier: async () => ({ chainIdentifier: '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S' }),
  resolveTransactionPlugin: () => async (data: any, _opts: any, next: () => Promise<void>) => {
  data.inputs = data.inputs.map((input: any) => input.UnresolvedObject ? Inputs.SharedObjectRef({
    objectId: input.UnresolvedObject.objectId, initialSharedVersion: '1', mutable: false }) : input)
  await next()
} } } as any
beforeEach(() => {
  vi.clearAllMocks(); mocks.keys.mockResolvedValue(new Map()); mocks.signature.mockResolvedValue(undefined)
  mocks.decrypt.mockImplementation(async () => png()); mocks.create.mockResolvedValue({
    getPersonalMessage: () => new TextEncoder().encode('exact Seal session message'), setPersonalMessageSignature: mocks.signature,
  })
})
afterEach(() => vi.restoreAllMocks())
function setup() {
  const f = fixture(); const controller = new AbortController(); let owner: string | null = f.target.owner
  const read = vi.fn(async () => structuredClone(f.target)); const sign = vi.fn(async () => 'fixture-wallet-signature')
  const fetcher = vi.fn(async () => new Response(new Uint8Array(f.bytes)))
  const params = { soulId: f.target.soulId, owner: f.target.owner, client, signal: controller.signal,
    getAddress: () => owner, signPersonalMessage: sign, read, fetcher: fetcher as typeof fetch }
  return { ...f, params, read, sign, fetcher, controller, setOwner: (v: string | null) => { owner = v } }
}
it('validates the actual weighted Seal BCS envelope and uses one fresh original-package session without broadcast', async () => {
  const s = setup(); const plain = png(); mocks.decrypt.mockResolvedValue(plain)
  const blob = await decryptNativeCompleteArtwork(s.params)
  expect(blob.type).toBe('image/png'); expect(blob.size).toBe(33); expect([...plain].every(b => b === 0)).toBe(true)
  expect(s.read).toHaveBeenCalledTimes(4); expect(s.sign).toHaveBeenCalledTimes(1)
  expect(mocks.create).toHaveBeenCalledWith({ address: s.target.owner, packageId: s.target.release.originalPackageId, ttlMin: 10, suiClient: client })
  expect(mocks.options).toHaveBeenCalledWith({ suiClient: client, serverConfigs: s.target.policy.keyServers, verifyKeyServers: true, timeout: 10000 })
  expect(mocks.decrypt).toHaveBeenCalledWith(expect.objectContaining({ data: s.bytes, txBytes: expect.any(Uint8Array), checkShareConsistency: true }))
  expect(s.fetcher).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ credentials: 'omit', redirect: 'error', cache: 'no-store' }))
})
it.each(['owner', 'soulId', 'stateId', 'sealPolicyId'])('rejects invalid target %s before download or signing', async key => {
  const s = setup(); (s.target as any)[key] = key === 'owner' || key === 'soulId' ? id(99) : '0x0'
  await expect(decryptNativeCompleteArtwork(s.params)).rejects.toThrow()
  expect(s.fetcher).not.toHaveBeenCalled(); expect(s.sign).not.toHaveBeenCalled()
})
it.each(['package', 'id', 'threshold', 'services', 'indices', 'out-of-range-index', 'aad', 'trailing', 'plain', 'hmac', 'shares'])('rejects ciphertext %s tampering even with its recomputed blob hash', async kind => {
  const { target, encoded } = fixture(); const modified: any = structuredClone(encoded)
  if (kind === 'package') modified.packageId = id(99)
  if (kind === 'id') modified.id = 'aa'.repeat(32)
  if (kind === 'threshold') modified.threshold = 1
  if (kind === 'services') modified.services[2][0] = id(99)
  if (kind === 'indices') modified.services[1][1] = 1
  if (kind === 'out-of-range-index') modified.services[1][1] = 4
  if (kind === 'aad') modified.ciphertext.Aes256Gcm.aad = new Uint8Array([1])
  if (kind === 'plain') modified.ciphertext = { Plain: {} }
  if (kind === 'hmac') modified.ciphertext = { Hmac256Ctr: { ...modified.ciphertext.Aes256Gcm, mac: new Uint8Array(32) } }
  if (kind === 'shares') modified.encryptedShares.BonehFranklinBLS12381.encryptedShares.pop()
  let bytes = EncryptedObject.serialize(modified).toBytes()
  if (kind === 'trailing') bytes = new Uint8Array([...bytes, 0])
  target.ciphertext.sha256 = sha(bytes)
  await expect(assertNativeCompleteCiphertext(bytes, target)).rejects.toThrow()
})
it('rejects incomplete encrypted shares before asking for wallet authorization', async () => {
  const s = setup(); s.encoded.encryptedShares.BonehFranklinBLS12381.encryptedShares.pop()
  const bytes = EncryptedObject.serialize(s.encoded).toBytes(); s.target.ciphertext.sha256 = sha(bytes)
  s.fetcher.mockImplementation(async () => new Response(new Uint8Array(bytes)))
  await expect(decryptNativeCompleteArtwork(s.params)).rejects.toThrow('shares are incomplete')
  expect(s.sign).not.toHaveBeenCalled(); expect(mocks.keys).not.toHaveBeenCalled()
})
it('rejects ciphertext hash mismatch before obtaining keys or signing', async () => {
  const s = setup(); s.target.ciphertext.sha256 = 'ff'.repeat(32)
  await expect(decryptNativeCompleteArtwork(s.params)).rejects.toThrow('hash mismatch')
  expect(mocks.keys).not.toHaveBeenCalled(); expect(s.sign).not.toHaveBeenCalled()
})
it('rejects the wrong RPC network before download or signing', async () => {
  const s = setup(); vi.spyOn(client.core, 'getChainIdentifier').mockResolvedValue({ chainIdentifier: 'wrong' })
  await expect(decryptNativeCompleteArtwork(s.params)).rejects.toThrow('mainnet')
  expect(s.fetcher).not.toHaveBeenCalled(); expect(s.sign).not.toHaveBeenCalled()
})
it.each(['11111111111111111111111111111111','35834a8a'])('rejects wrong full chain digest or short ID %s before key access', async chainIdentifier => {
  const s=setup();vi.spyOn(client.core,'getChainIdentifier').mockResolvedValue({chainIdentifier})
  await expect(decryptNativeCompleteArtwork(s.params)).rejects.toThrow('mainnet')
  expect(s.read).not.toHaveBeenCalled();expect(s.fetcher).not.toHaveBeenCalled()
  expect(s.sign).not.toHaveBeenCalled();expect(mocks.keys).not.toHaveBeenCalled()
})
it('rejects a misconfigured key service before opening a wallet prompt', async () => {
  const s = setup(); mocks.keys.mockRejectedValueOnce(new Error('Missing aggregator URL'))
  await expect(decryptNativeCompleteArtwork(s.params)).rejects.toThrow('aggregator')
  expect(s.sign).not.toHaveBeenCalled()
})
it('rejecting the personal message stops decryption, and a later attempt can retry', async () => {
  const s = setup(); s.sign.mockRejectedValueOnce(new Error('User rejected'))
  await expect(decryptNativeCompleteArtwork(s.params)).rejects.toThrow('User rejected')
  expect(mocks.decrypt).not.toHaveBeenCalled()
  await expect(decryptNativeCompleteArtwork(s.params)).resolves.toBeInstanceOf(Blob)
  expect(mocks.create).toHaveBeenCalledTimes(2)
})
it.each([2, 3, 4])('does not publish when exact ownership/policy changes at read %s', async call => {
  const s = setup(); let n = 0
  s.read.mockImplementation(async () => { const v = structuredClone(s.target); if (++n === call) v.ownershipEpoch = '2'; return v })
  const plain = png(); mocks.decrypt.mockResolvedValue(plain)
  await expect(decryptNativeCompleteArtwork(s.params)).rejects.toThrow('changed')
  if (call < 4) expect(mocks.decrypt).not.toHaveBeenCalled()
  else expect([...plain].every(b => b === 0)).toBe(true)
})
it('wallet switch while awaiting approval discards the signature and never decrypts', async () => {
  const s = setup(); s.sign.mockImplementation(async () => { s.setOwner(id(99)); return 'late' })
  await expect(decryptNativeCompleteArtwork(s.params)).rejects.toThrow('wallet changed')
  expect(mocks.signature).not.toHaveBeenCalled(); expect(mocks.decrypt).not.toHaveBeenCalled()
})
it('clears plaintext when wallet changes during decrypt even without a transport abort', async () => {
  const s = setup(); const plain = png(); mocks.decrypt.mockImplementation(async () => { s.setOwner(null); return plain })
  await expect(decryptNativeCompleteArtwork(s.params)).rejects.toThrow('wallet changed')
  expect([...plain].every(b => b === 0)).toBe(true)
})
it('observes and zeroes a late plaintext from a decryptor that ignores cancellation', async () => {
  const controller = new AbortController(); const d = deferred<Uint8Array>(); const bytes = png()
  const pending = completeReadStep(controller.signal, () => d.promise, v => v.fill(0))
  await Promise.resolve(); controller.abort(new Error('cancelled'))
  await expect(pending).rejects.toThrow('cancelled'); d.resolve(bytes)
  await new Promise(resolve => setTimeout(resolve, 0)); expect([...bytes].every(b => b === 0)).toBe(true)
})
it('rejects unbounded or inconsistent committee weights and captures an immutable target snapshot', () => {
  const { target } = fixture(); const copy = assertNativeCompleteReadTarget(target, target.soulId, target.owner)
  target.policy.keyServers[0].weight = 254
  expect(copy.policy.keyServers[0].weight).toBe(2)
  expect(() => assertNativeCompleteReadTarget(target, target.soulId, target.owner)).toThrow('threshold')
})
