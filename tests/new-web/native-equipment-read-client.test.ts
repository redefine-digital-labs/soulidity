import { beforeEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { Inputs, Transaction } from '@mysten/sui/transactions'
import { EncryptedObject } from '../../web/node_modules/@mysten/seal/dist/index.mjs'
import { assertNativeEquipmentReadTarget, decryptNativeEquipmentLayer } from '../../web/lib/animacraft/native-equipment-read-client'
import type { NativeEquipmentReadTarget } from '../../web/lib/animacraft/native-equipment-read-types'

const mocks = vi.hoisted(() => ({ decrypt: vi.fn(), keys: vi.fn(), create: vi.fn(), signature: vi.fn(), options: vi.fn() }))
vi.mock('../../web/node_modules/@mysten/seal/dist/index.mjs', async importOriginal => ({
  ...await importOriginal<any>(),
  SealClient: class { constructor(options: unknown) { mocks.options(options) }; getKeyServers = mocks.keys; decrypt = mocks.decrypt },
  SessionKey: { create: mocks.create },
}))
const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
const client = { core: { getChainIdentifier: async () => ({ chainIdentifier: '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S' }),
  resolveTransactionPlugin: () => async (data: any, _opts: any, next: () => Promise<void>) => {
    data.inputs = data.inputs.map((input: any) => input.UnresolvedObject ? Inputs.SharedObjectRef({
      objectId: input.UnresolvedObject.objectId, initialSharedVersion: '1', mutable: false }) : input)
    await next()
  } } } as any
const deferred = <T,>() => { let resolve!: (v: T) => void
  const promise = new Promise<T>(yes => { resolve = yes }); return { promise, resolve } }
function setup(kind: NativeEquipmentReadTarget['kind'] = 'base') {
  const aad = new TextEncoder().encode('fixture exact equipment AAD; canonical derivation belongs to server reader')
  const target: NativeEquipmentReadTarget = { schema: 'native-equipment-read-v1', soulId: id(1), stateId: id(2),
    owner: id(3), ownershipEpoch: '4', bindingId: id(4), rootId: id(5), protocolConfigId: id(6), catalogId: id(7),
    releaseConfigId: id(8), sealRegistryId: id(9), sealPolicyId: id(10), paymentCoinType: '0x2::sui::SUI',
    loadoutId: id(11), loadoutRevision: '7', loadoutCommitment: 'aa'.repeat(32), runtimeDefinitionsId: id(12),
    baseRegistryId: id(13), packRegistryId: id(14), makerAccessId: id(15), selectionIndex: 3,
    slot: { partKey: 'body', itemKey: 'coat', styleKey: 'blue', colorChannelKey: 'coat-tint', swatchKey: 'red',
      layerTrackKey: 'body', sourceClass: kind === 'pack' ? 1 : 0, sourceDefinitionId: kind === 'pack' ? id(16) : id(5),
      sourceSemanticId: kind === 'pack' ? 'first-pack' : '', accessSubject: kind === 'pack' ? id(17) : kind === 'owned-base' ? id(18) : id(15),
      sourceEpoch: kind === 'owned-base' ? '2' : '0', pricingCommitment: 'bb'.repeat(32),
      assetContentCommitment: 'cc'.repeat(32), sealBindingCommitment: 'dd'.repeat(32) },
    release: { originalPackageId: id(19), callablePackageId: id(20), callableDigest: '1'.repeat(32) },
    ciphertext: { blobId: Buffer.alloc(32, 21).toString('base64url'), sha256: '', sealId: [...createHash('sha256').update(aad).digest()],
      aadBase64: Buffer.from(aad).toString('base64'), ciphertextBlobCommitment: 'ee'.repeat(32), certificationCommitment: 'ff'.repeat(32) },
    policy: { keyServers: [{ objectId: id(22), weight: 2 }, { objectId: id(23), weight: 1 }], threshold: 2,
      maxPlaintextBytes: 1024, cipherSuite: 'BonehFranklinBLS12381DemCCA/AesGcm256',
      keyDerivation: 'SHA3-256:SUI-SEAL-IBE-BLS12381-H2-00:SUI-SEAL-IBE-BLS12381-H3-00', ciphertextFormat: 'Seal/EncryptedObject/BCS/v0' },
    ...(kind === 'pack' ? { kind, packReleaseId: id(16), packPassId: id(17) }
      : kind === 'owned-base' ? { kind, ownedBaseItemId: id(18) } : { kind }),
  }
  const encoded = { version: 0, packageId: target.release.originalPackageId, id: sha(aad),
    services: [[id(22), 1], [id(22), 2], [id(23), 3]] as [string, number][], threshold: 2,
    encryptedShares: { BonehFranklinBLS12381: { nonce: new Uint8Array(96),
      encryptedShares: [new Uint8Array(32), new Uint8Array(32), new Uint8Array(32)], encryptedRandomness: new Uint8Array(32) } },
    ciphertext: { Aes256Gcm: { blob: new Uint8Array(20), aad } } }
  const bytes = EncryptedObject.serialize(encoded).toBytes(); target.ciphertext.sha256 = sha(bytes)
  const read = vi.fn(async () => structuredClone(target)); const sign = vi.fn(async () => 'signature')
  const fetcher = vi.fn(async () => new Response(new Uint8Array(bytes)))
  const controller = new AbortController(); let owner: string | null = target.owner
  const params = { soulId: target.soulId, owner: target.owner, selectionIndex: target.selectionIndex,
    expectedEquipment: { loadoutId: target.loadoutId, loadoutRevision: target.loadoutRevision,
      loadoutCommitment: target.loadoutCommitment, ownershipEpoch: target.ownershipEpoch },
    client, signal: controller.signal, getAddress: () => owner, signPersonalMessage: sign, read, fetcher: fetcher as typeof fetch }
  return { target, encoded, bytes, read, sign, fetcher, controller, params, setOwner: (v: string | null) => { owner = v } }
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.keys.mockResolvedValue(new Map()); mocks.signature.mockResolvedValue(undefined)
  mocks.decrypt.mockImplementation(async () => new Uint8Array([255, 216, 255, 217]))
  mocks.create.mockResolvedValue({ getPersonalMessage: () => new Uint8Array([1]), setPersonalMessageSignature: mocks.signature })
})

it('reuses renderer ciphertext only after exact envelope verification, without downloading it again', async () => {
  const s = setup(); const ciphertextBytes = new Uint8Array(s.bytes)
  const pending = decryptNativeEquipmentLayer({ ...s.params, ciphertextBytes })
  ciphertextBytes.fill(0) // caller mutation cannot alter the snapshotted envelope
  const result = await pending
  expect(s.fetcher).not.toHaveBeenCalled()
  expect(s.sign).toHaveBeenCalledTimes(1)
  expect(mocks.decrypt.mock.calls[0][0].data).toEqual(s.bytes)
  result.bytes.fill(0)
})
it('rejects supplied renderer ciphertext drift before any wallet prompt or fallback download', async () => {
  const s = setup(); const ciphertextBytes = new Uint8Array(s.bytes); ciphertextBytes[0] ^= 1
  await expect(decryptNativeEquipmentLayer({ ...s.params, ciphertextBytes })).rejects.toThrow('hash')
  expect(s.fetcher).not.toHaveBeenCalled(); expect(s.sign).not.toHaveBeenCalled(); expect(mocks.decrypt).not.toHaveBeenCalled()
})

it.each(['base', 'owned-base', 'pack'] as const)('%s returns non-PNG layer bytes after four reads and one Input-only native Release approval', async kind => {
  const s = setup(kind); const plain = new Uint8Array([255, 216, 255, 217]); mocks.decrypt.mockResolvedValue(plain)
  const result = await decryptNativeEquipmentLayer(s.params)
  expect(result.bytes).toBe(plain); expect(result.target).toEqual(s.target); expect(result.target).not.toBe(s.target)
  expect(plain[0]).toBe(255); expect(s.read).toHaveBeenCalledTimes(4); expect(s.sign).toHaveBeenCalledTimes(1)
  expect(mocks.keys.mock.invocationCallOrder[0]).toBeLessThan(s.sign.mock.invocationCallOrder[0])
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ packageId: s.target.release.originalPackageId }))
  expect(mocks.options).toHaveBeenCalledWith(expect.objectContaining({ verifyKeyServers: true, serverConfigs: s.target.policy.keyServers }))
  const data = Transaction.fromKind(mocks.decrypt.mock.calls[0][0].txBytes).getData()
  expect(data.commands).toHaveLength(1)
  expect(data.commands[0].MoveCall).toMatchObject({ package: s.target.release.callablePackageId,
    module: 'release_v8', function: `seal_approve_equipped_${kind.replace('-', '_')}_v8` })
  expect(data.commands[0].MoveCall!.arguments).toHaveLength({ base: 19, 'owned-base': 21, pack: 23 }[kind])
  expect(data.commands[0].MoveCall!.arguments.every(arg => arg.$kind === 'Input')).toBe(true)
  result.bytes.fill(0)
})

it.each(['soulId', 'owner', 'selectionIndex', 'loadoutId', 'loadoutRevision', 'loadoutCommitment', 'ownershipEpoch',
  'kind', 'sourceClass', 'accessSubject', 'sourceDefinitionId', 'sourceEpoch', 'sourceSemanticId', 'assetContentCommitment',
  'ciphertextBlobCommitment', 'callableDigest', 'threshold', 'profile', 'policy-size'])(
  'rejects invalid or changed %s before download/prompt', async field => {
    const s = setup(); const v = s.target as any
    if (['soulId', 'owner', 'loadoutId'].includes(field)) v[field] = id(99)
    else if (field === 'selectionIndex') v[field] = 4
    else if (field === 'loadoutRevision' || field === 'ownershipEpoch') v[field] = '8'
    else if (field === 'loadoutCommitment') v[field] = '12'.repeat(32)
    else if (field === 'kind') v.kind = 'external'
    else if (field === 'sourceClass') v.slot.sourceClass = 1
    else if (field === 'accessSubject' || field === 'sourceDefinitionId') v.slot[field] = id(99)
    else if (field === 'sourceEpoch') v.slot.sourceEpoch = '1'
    else if (field === 'sourceSemanticId') v.slot.sourceSemanticId = 'unexpected-pack'
    else if (field === 'assetContentCommitment') v.slot.assetContentCommitment = 'ff'
    else if (field === 'ciphertextBlobCommitment') v.ciphertext.ciphertextBlobCommitment = 'ff'
    else if (field === 'callableDigest') v.release.callableDigest = 'fixture'
    else if (field === 'threshold') v.policy.threshold = 4
    else if (field === 'profile') v.policy.ciphertextFormat = 'unknown'
    else v.policy.maxPlaintextBytes = 3 * 1024 * 1024 + 1
    await expect(decryptNativeEquipmentLayer(s.params)).rejects.toThrow()
    expect(s.fetcher).not.toHaveBeenCalled(); expect(s.sign).not.toHaveBeenCalled()
  })

it.each(['package', 'hash', 'indices', 'shares', 'aad', 'services'])('rejects actual ciphertext %s drift before wallet interaction', async field => {
  const s = setup(); const e = s.encoded
  if (field === 'package') e.packageId = id(99)
  if (field === 'indices') e.services[1][1] = 4
  if (field === 'shares') e.encryptedShares.BonehFranklinBLS12381.encryptedShares.pop()
  if (field === 'aad') e.ciphertext.Aes256Gcm.aad = new Uint8Array([9])
  if (field === 'services') e.services[2][0] = id(99)
  const bytes = EncryptedObject.serialize(e).toBytes()
  s.target.ciphertext.sha256 = field === 'hash' ? 'ab'.repeat(32) : sha(bytes)
  s.fetcher.mockImplementation(async () => new Response(new Uint8Array(bytes)))
  await expect(decryptNativeEquipmentLayer(s.params)).rejects.toThrow()
  expect(s.sign).not.toHaveBeenCalled(); expect(mocks.decrypt).not.toHaveBeenCalled()
})

it.each([2, 3, 4])('does not expose changed slot evidence at metadata reread %s', async call => {
  const s = setup(); let reads = 0; const plain = new Uint8Array([1, 2]); mocks.decrypt.mockResolvedValue(plain)
  s.read.mockImplementation(async () => { const v = structuredClone(s.target); if (++reads === call) v.slot.swatchKey = 'green'; return v })
  await expect(decryptNativeEquipmentLayer(s.params)).rejects.toThrow('changed')
  if (call === 4) expect(plain).toEqual(new Uint8Array(2))
  else expect(mocks.decrypt).not.toHaveBeenCalled()
})
it.each([0, 1025])('zeros decrypted length %s outside the committed policy', async length => {
  const s = setup(); const plain = new Uint8Array(length).fill(1); mocks.decrypt.mockResolvedValue(plain)
  await expect(decryptNativeEquipmentLayer(s.params)).rejects.toThrow('size')
  expect(plain.every(byte => byte === 0)).toBe(true)
})
it('cancels a late decryptor and zeros its eventually returned bytes', async () => {
  const s = setup(); const started = deferred<void>(); const d = deferred<Uint8Array>()
  mocks.decrypt.mockImplementation(() => { started.resolve(); return d.promise })
  const pending = decryptNativeEquipmentLayer(s.params); await started.promise
  s.controller.abort(new Error('cancelled')); await expect(pending).rejects.toThrow('cancelled')
  const plain = new Uint8Array([1, 2]); d.resolve(plain); await new Promise(resolve => setTimeout(resolve, 0))
  expect(plain).toEqual(new Uint8Array(2))
})
it('stops after wallet drift while personal-message approval is pending', async () => {
  const s = setup(); s.sign.mockImplementation(async () => { s.setOwner(null); return 'late signature' })
  await expect(decryptNativeEquipmentLayer(s.params)).rejects.toThrow('wallet changed')
  expect(mocks.signature).not.toHaveBeenCalled(); expect(mocks.decrypt).not.toHaveBeenCalled()
})
it('captures initial UI snapshot and validated target without retaining mutable caller data', () => {
  const s = setup(); const target = assertNativeEquipmentReadTarget(s.target, s.params.soulId, s.params.owner, 3, s.params.expectedEquipment)
  s.target.slot.swatchKey = 'green'; expect(target.slot.swatchKey).toBe('red')
  expect(() => assertNativeEquipmentReadTarget(target, s.params.soulId, s.params.owner, 3,
    { ...s.params.expectedEquipment, loadoutRevision: '8' })).toThrow('snapshot changed')
})
