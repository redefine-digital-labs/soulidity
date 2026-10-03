import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { EncryptedObject, SealClient } from '../../web/node_modules/@mysten/seal/dist/index.mjs'
import { fromHex } from '@mysten/sui/utils'
import { captureNamedLoadout } from '../../web/lib/animacraft/named-loadout'
import { emptyPrivateLoadoutLibrary, preparePrivateLoadoutMutation } from '../../web/lib/animacraft/private-loadout-library'
import { assertPrivateLoadoutWrappedKey, decryptPrivateLoadoutLibrary, encryptPrivateLoadoutLibrary,
  PrivateLoadoutEnvelopeBcs, validatePrivateLoadoutSealPolicy } from '../../web/lib/animacraft/private-loadout-crypto'
import { NATIVE_SEAL_ENCRYPTION_PROFILE } from '../../web/lib/animacraft/native-seal-profile'
import { nativeEquipmentSourceFixture } from './fixtures/native-equipment-source'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const hash = (n: number) => n.toString(16).padStart(64, '0')
let cryptography: any
beforeAll(async () => {
  // Actual installed Seal BLS/IBE implementation with local test keys; not live
  // key-server authorization. No mocked ciphertext or mocked AES cryptography.
  const paths = ['bls12381', 'kdf', 'utils', 'decrypt'].map(name => `../../web/node_modules/@mysten/seal/dist/${name}.mjs`)
  const [bls, kdf, utils, decrypt] = await Promise.all(paths.map(path => import(path)))
  cryptography = { ...bls, ...kdf, ...utils, ...decrypt }
})
afterEach(() => vi.restoreAllMocks())
async function setup() {
  const snapshot = await nativeEquipmentSourceFixture().readBase(), content = captureNamedLoadout(snapshot)
  const scope = { soulId: content.soulId, stateId: content.stateId, owner: content.capturedOwner, ownershipEpoch: content.capturedOwnershipEpoch }
  const library = preparePrivateLoadoutMutation(emptyPrivateLoadoutLibrary(scope), { action: 'save', scope, requestId: hash(1), expectedRevision: '0',
    at: '2026-09-11T12:00:00.000Z', loadoutId: '00000000-0000-0000-0000-000000000001', name: 'My secret outfit', content,
    capture: { equipmentId: content.capturedEquipmentId, revision: content.capturedEquipmentRevision, commitment: hash(2) } }).library
  const context = { scope, revision: '1', requestId: hash(1), originalPackageId: id(123) }
  const policy = { ...NATIVE_SEAL_ENCRYPTION_PROFILE, threshold: 2, maxPlaintextBytes: 32,
    keyServers: [{ objectId: id(700), weight: 2 }, { objectId: id(701), weight: 1 }] }
  const seal = new SealClient({ suiClient: { core: { getObject: async () => ({ object: { version: '1' } }) } } as any,
    serverConfigs: policy.keyServers, verifyKeyServers: true })
  vi.spyOn(seal, 'getKeyServers').mockResolvedValue(new Map(policy.keyServers.map(row => [row.objectId, {
    objectId: row.objectId, name: 'local key', url: 'https://key.example', keyType: 0, serverType: 'Independent' as const,
    pk: cryptography.G2Element.generator().toBytes(),
  }])))
  const controller = new AbortController(), verify = vi.fn(async () => {})
  let inputDek: Uint8Array | undefined, outputDem: Uint8Array | undefined, unwrapped: Uint8Array | undefined
  const encrypt = seal.encrypt.bind(seal)
  vi.spyOn(seal, 'encrypt').mockImplementation(async args => {
    inputDek = args.data; const result = await encrypt(args); outputDem = result.key; return result
  })
  const unwrap = vi.fn(async (bytes: Uint8Array): Promise<Uint8Array> => {
    const parsed = EncryptedObject.parse(bytes), fullId = cryptography.createFullId(parsed.packageId, parsed.id)
    const secret = cryptography.hashToG1(fromHex(fullId)) // test master scalar = 1
    unwrapped = await cryptography.decrypt({ encryptedObject: parsed,
      keys: new Map(policy.keyServers.map(row => [`${fullId}:${row.objectId}`, secret])),
      publicKeys: parsed.services.map(() => cryptography.G2Element.generator()), checkLEEncoding: false })
    return unwrapped!
  })
  const encryptParams = { library, context, policy, seal, signal: controller.signal, verify }
  const encryptBytes = () => encryptPrivateLoadoutLibrary(encryptParams)
  const decryptBytes = (bytes: Uint8Array) => decryptPrivateLoadoutLibrary({ bytes, context, policy, signal: controller.signal, unwrap, verify })
  return { library, context, policy, seal, controller, verify, unwrap, encryptParams, encryptBytes, decryptBytes,
    secrets: () => ({ inputDek, outputDem, unwrapped }) }
}
it('roundtrips real AES + weighted Seal BLS shares, applying the 32-byte policy to DEK only', async () => {
  const s = await setup(), bytes = await s.encryptBytes()
  expect(bytes.length).toBeGreaterThan(32)
  expect(new TextDecoder().decode(bytes)).not.toContain('My secret outfit')
  expect(await s.decryptBytes(bytes)).toEqual(s.library)
  expect(s.verify).toHaveBeenCalledTimes(4)
  for (const secret of Object.values(s.secrets())) expect(secret?.every(n => n === 0)).toBe(true)
})
it('uses fresh keys and IVs for identical private documents', async () => {
  const s = await setup(), first = await s.encryptBytes(), second = await s.encryptBytes()
  expect(first).not.toEqual(second)
  expect(PrivateLoadoutEnvelopeBcs.parse(first).iv).not.toEqual(PrivateLoadoutEnvelopeBcs.parse(second).iv)
  expect(await s.decryptBytes(second)).toEqual(s.library)
})
it.each(['owner', 'ownershipEpoch', 'revision', 'requestId', 'originalPackageId'])('rejects %s transplantation before unwrap', async key => {
  const s = await setup(), bytes = await s.encryptBytes()
  const context: any = structuredClone(s.context)
  if (key === 'owner') context.scope.owner = id(999)
  else if (key === 'ownershipEpoch') context.scope.ownershipEpoch = '999'
  else context[key] = key === 'revision' ? '2' : key === 'requestId' ? hash(99) : id(999)
  await expect(decryptPrivateLoadoutLibrary({ bytes, context, policy: s.policy, signal: s.controller.signal, unwrap: s.unwrap, verify: s.verify })).rejects.toThrow()
  expect(s.unwrap).not.toHaveBeenCalled()
})
it.each(['ciphertext', 'iv', 'aad', 'trailing', 'version'])('rejects tampered outer %s', async kind => {
  const s = await setup(), bytes = await s.encryptBytes(), value = PrivateLoadoutEnvelopeBcs.parse(bytes)
  if (kind === 'ciphertext') value.ciphertext[20] ^= 1
  if (kind === 'iv') value.iv[0] ^= 1
  if (kind === 'aad') value.aad[0] ^= 1
  if (kind === 'version') value.version = 2
  const encoded = PrivateLoadoutEnvelopeBcs.serialize(value).toBytes()
  await expect(s.decryptBytes(kind === 'trailing' ? new Uint8Array([...encoded, 0]) : encoded)).rejects.toThrow()
  const unwrapped = s.secrets().unwrapped
  if (unwrapped) expect(unwrapped.every(n => n === 0)).toBe(true)
})
it.each(['package', 'id', 'threshold', 'services', 'indices', 'aad', 'size', 'shares'])('rejects tampered wrapped DEK %s before unwrap', async kind => {
  const s = await setup(), value = PrivateLoadoutEnvelopeBcs.parse(await s.encryptBytes())
  const key: any = EncryptedObject.parse(new Uint8Array(value.wrapped_dek))
  if (kind === 'package') key.packageId = id(999)
  if (kind === 'id') key.id = hash(999)
  if (kind === 'threshold') key.threshold = 1
  if (kind === 'services') key.services[0][0] = id(999)
  if (kind === 'indices') key.services[0][1] = 0
  if (kind === 'aad') key.ciphertext.Aes256Gcm.aad[0] ^= 1
  if (kind === 'size') key.ciphertext.Aes256Gcm.blob = new Uint8Array(49)
  if (kind === 'shares') key.encryptedShares.BonehFranklinBLS12381.encryptedShares.pop()
  await expect(assertPrivateLoadoutWrappedKey(EncryptedObject.serialize(key).toBytes(), s.context, s.policy)).rejects.toThrow()
})
it('zeros encryption keys when final owner/head verification fails', async () => {
  const s = await setup(); s.verify.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('owner changed'))
  await expect(s.encryptBytes()).rejects.toThrow('owner changed')
  expect(s.secrets().inputDek?.every(n => n === 0)).toBe(true)
  expect(s.secrets().outputDem?.every(n => n === 0)).toBe(true)
})
it('rejects failed final authorization and zeros the unwrapped key', async () => {
  const s = await setup(), bytes = await s.encryptBytes()
  s.verify.mockReset().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('owner changed'))
  await expect(s.decryptBytes(bytes)).rejects.toThrow('owner changed')
  expect(s.secrets().unwrapped?.every(n => n === 0)).toBe(true)
})
it('observes a late Seal unwrap and wipes its returned secret after cancellation', async () => {
  const s = await setup(), bytes = await s.encryptBytes(); let resolve!: (key: Uint8Array) => void
  s.unwrap.mockImplementation(() => new Promise<Uint8Array>(r => { resolve = r }))
  const pending = s.decryptBytes(bytes)
  await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
  s.controller.abort(new Error('cancelled'))
  await expect(pending).rejects.toThrow('cancelled')
  const key = new Uint8Array(32).fill(12); resolve(key)
  await vi.waitFor(() => expect(key.every(n => n === 0)).toBe(true))
})
it('forbids secret-bearing service configuration and invalid thresholds', async () => {
  const s = await setup()
  for (const policy of [{ ...s.policy, threshold: 4 }, { ...s.policy, maxPlaintextBytes: 31 },
    { ...s.policy, keyServers: [{ ...s.policy.keyServers[0], apiKey: 'no' }] },
    { ...s.policy, keyServers: [{ ...s.policy.keyServers[0], aggregatorUrl: 'https://user:pass@key.example' }] }])
    expect(() => validatePrivateLoadoutSealPolicy(policy as any)).toThrow()
})
