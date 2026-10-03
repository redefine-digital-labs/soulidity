import { afterEach, expect, it, vi } from 'vitest'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { fromBase64, fromHex, toHex } from '@mysten/sui/utils'
import { EncryptedObject, SealClient } from '../../web/node_modules/@mysten/seal/dist/index.mjs'
import { isContentDocumentIdForVersion } from '../../packages/soulidity-sdk/src/content-document-id'
import { MAINNET_GENESIS_DIGEST } from '../../web/lib/animacraft/mainnet-chain'
import { contentAppendPreparationMessage, prepareContentAppend, rewrapContentAppendPreparation,
  unlockContentAppendPreparation, verifyContentAppendPreparation, type ContentAppendPreparationScope } from '../../web/lib/soulidity/content-append-preparation'

// Real AES-GCM, Seal encrypt/decrypt, local BLS keys, and Ed25519 personal-message
// signatures. Only discovery/RPC and the remote decryption transport are replaced;
// the latter delegates to Seal's actual cryptographic decrypt implementation.
const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
afterEach(() => vi.restoreAllMocks())
async function fixture() {
  const signer = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(29)), controller = new AbortController()
  let address: string | null = signer.toSuiAddress()
  const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://sui.example.com' })
  vi.spyOn(client.core, 'getObject').mockResolvedValue({ object: { version: '1' } } as any)
  vi.spyOn(client.core, 'getChainIdentifier').mockResolvedValue({ chainIdentifier: MAINNET_GENESIS_DIGEST })
  const resolver = await import('../../web/node_modules/@mysten/sui/dist/client/core-resolver.mjs')
  vi.spyOn(client.core, 'resolveTransactionPlugin').mockReturnValue(resolver.coreClientResolveTransactionPlugin)
  vi.spyOn(client.core, 'getMoveFunction').mockResolvedValue({ function: { parameters: [{ body: { vector: 'u8' }, reference: null }] } } as any)
  const paths = ['bls12381', 'utils', 'decrypt', 'kdf'].map(n => `../../web/node_modules/@mysten/seal/dist/${n}.mjs`)
  const [bls, utils, decrypt, kdf] = await Promise.all(paths.map(p => import(p)))
  const servers = [{ objectId: id(50), weight: 1, aggregatorUrl: 'https://seal.example.com/' }]
  const keys = servers.map(s => ({ objectId: s.objectId, name: 'local', url: s.aggregatorUrl, keyType: 0,
    serverType: 'Independent', pk: bls.G2Element.generator().toBytes() }))
  const keyServers = vi.spyOn(SealClient.prototype, 'getKeyServers').mockResolvedValue(new Map(keys.map(k => [k.objectId, k])) as any)
  const localDecrypt = async (bytes: Uint8Array) => {
    const parsed = EncryptedObject.parse(bytes), fullId = utils.createFullId(parsed.packageId, parsed.id)
    return await decrypt.decrypt({ encryptedObject: parsed,
      keys: new Map(keys.map(k => [`${fullId}:${k.objectId}`, kdf.hashToG1(fromHex(fullId))])),
      publicKeys: parsed.services.map(() => bls.G2Element.generator()), checkLEEncoding: false }) as Uint8Array
  }
  const decrypted: Uint8Array[] = []
  const decryptCall = vi.spyOn(SealClient.prototype, 'decrypt').mockImplementation(async args => {
    expect(args.checkShareConsistency).toBe(true)
    expect((await args.sessionKey.getCertificate()).user).toBe(signer.toSuiAddress())
    const raw = await localDecrypt(args.data); decrypted.push(raw); return raw
  })
  const encryptCall = vi.spyOn(SealClient.prototype, 'encrypt')
  const sign = vi.fn(async (message: Uint8Array) => (await signer.signPersonalMessage(message)).signature)
  const plaintext = new TextEncoder().encode('Original paid ciphertext must remain exactly unchanged on rewrap.')
  const scope: ContentAppendPreparationScope = { author: signer.toSuiAddress(), originalPackageId: id(1), callablePackageId: id(10),
    contentObjectId: id(4), kind: 3, name: 'sprite', versionIndex: '9007199254740993', intentJson: '{"attempt":"original"}' }
  const sealConfig = { threshold: 1, ttlMin: 5, serverConfigs: servers }
  const wallet = { client, sealClient: client, signal: controller.signal, getAddress: () => address, signPersonalMessage: sign }
  const record = await prepareContentAppend({ scope, sealConfig, plaintext, mimeType: 'text/plain', fileName: 'sprite.txt', wallet })
  sign.mockClear(); encryptCall.mockClear(); keyServers.mockClear()
  const nextScope = { ...scope, versionIndex: '9007199254740994', intentJson: '{"attempt":"rebased"}' }
  return { signer, client, controller, wallet, sealConfig, plaintext, record, nextScope, sign, decryptCall, decrypted, encryptCall,
    keyServers, localDecrypt, setAddress: (value: string | null) => { address = value } }
}

it('unlocks the old author recovery and signs a new envelope while preserving exact ciphertext, DEK, IV and hashes', async () => {
  const f = await fixture(), before = structuredClone(f.record)
  const oldMaterial = await f.localDecrypt(fromBase64(f.record.sidecar.encryptedDek))
  const next = await rewrapContentAppendPreparation(f)
  const newMaterial = await f.localDecrypt(fromBase64(next.sidecar.encryptedDek))
  try {
    expect(f.sign).toHaveBeenCalledTimes(2); expect(f.decryptCall).toHaveBeenCalledOnce()
    expect(f.sign.mock.calls[1][0]).toEqual(contentAppendPreparationMessage(next))
    expect(next.ciphertext).toEqual(before.ciphertext); expect(next.payloadHash).toBe(before.payloadHash); expect(next.contentHash).toBe(before.contentHash)
    expect(next.sidecar.iv).toBe(before.sidecar.iv); expect(next.plaintextByteLength).toBe(before.plaintextByteLength)
    expect(newMaterial).toEqual(oldMaterial); expect(toHex(newMaterial.slice(32))).toBe(next.contentHash)
    expect(next.sidecar.documentId).not.toBe(before.sidecar.documentId); expect(next.recovery.documentId).not.toBe(before.recovery.documentId)
    expect(next.authorSignature).not.toBe(before.authorSignature); expect(f.record).toEqual(before)
    expect(isContentDocumentIdForVersion(next.sidecar.documentId, { contentObjectId: next.scope.contentObjectId,
      kind: next.scope.kind, name: next.scope.name, versionIndex: BigInt(f.nextScope.versionIndex) })).toBe(true)
    const key = await crypto.subtle.importKey('raw', new Uint8Array(newMaterial.slice(0, 32)), 'AES-GCM', false, ['decrypt'])
    const plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(fromBase64(next.sidecar.iv)) }, key, new Uint8Array(next.ciphertext)))
    expect(plaintext).toEqual(f.plaintext); plaintext.fill(0)
    const cold = await verifyContentAppendPreparation(structuredClone(next), f.client)
    const unlocked = await unlockContentAppendPreparation(cold, f.wallet)
    expect(unlocked.plaintext).toEqual(f.plaintext); expect(unlocked.dek).toEqual(oldMaterial.slice(0, 32))
    unlocked.plaintext.fill(0); unlocked.dek.fill(0)
    expect(f.sign).toHaveBeenCalledTimes(3); expect(f.decrypted.every(bytes => bytes.every(v => v === 0))).toBe(true)
    expect(f.encryptCall.mock.calls.every(([args]) => args.data.every(v => v === 0))).toBe(true)
  } finally { oldMaterial.fill(0); newMaterial.fill(0) }
})
it('allows a same-version retry only when the canonical intent changes, with a new stamp and recovery nonce', async () => {
  const f = await fixture(), nextScope = { ...f.record.scope, intentJson: '{"attempt":"nonce-retry"}' }
  const next = await rewrapContentAppendPreparation({ ...f, nextScope })
  expect(next.scope.versionIndex).toBe(f.record.scope.versionIndex); expect(next.scope.intentJson).toBe(nextScope.intentJson)
  expect(next.ciphertext).toEqual(f.record.ciphertext); expect(next.sidecar.iv).toBe(f.record.sidecar.iv)
  expect(next.recovery.nonce).not.toBe(f.record.recovery.nonce); expect(next.authorSignature).not.toBe(f.record.authorSignature)
  expect(f.sign).toHaveBeenCalledTimes(2); expect(f.decrypted.every(bytes => bytes.every(v => v === 0))).toBe(true)
})
it.each(['author', 'originalPackageId', 'callablePackageId', 'contentObjectId', 'kind', 'name', 'rollback', 'unchanged'])(
  'rejects rewrap %s scope changes before requesting unlock or another author signature', async field => {
    const f = await fixture(), nextScope = { ...f.nextScope }
    if (['author', 'originalPackageId', 'callablePackageId', 'contentObjectId'].includes(field)) (nextScope as any)[field] = id(99)
    if (field === 'kind') nextScope.kind = 2
    if (field === 'name') nextScope.name = 'other'
    if (field === 'rollback') nextScope.versionIndex = '9007199254740992'
    if (field === 'unchanged') Object.assign(nextScope, f.record.scope)
    await expect(rewrapContentAppendPreparation({ ...f, nextScope })).rejects.toThrow(field === 'unchanged' ? 'ATTEMPT_UNCHANGED' : 'SCOPE_MISMATCH')
    expect(f.sign).not.toHaveBeenCalled(); expect(f.decryptCall).not.toHaveBeenCalled(); expect(f.encryptCall).not.toHaveBeenCalled()
  },
)
it('cannot substitute the prior preparation stamp for the new author signature', async () => {
  const f = await fixture(), realSign = f.sign.getMockImplementation()!
  f.sign.mockImplementationOnce(realSign).mockResolvedValueOnce(f.record.authorSignature)
  await expect(rewrapContentAppendPreparation(f)).rejects.toThrow()
  expect(f.sign).toHaveBeenCalledTimes(2); expect(f.decryptCall).toHaveBeenCalledOnce()
  expect(f.decrypted.every(bytes => bytes.every(v => v === 0))).toBe(true)
  expect(f.encryptCall.mock.calls.every(([args]) => args.data.every(v => v === 0))).toBe(true)
})
it('does not authorize an invalid old author stamp even before recovery unlock', async () => {
  const f = await fixture(), record = { ...f.record, authorSignature: (await Ed25519Keypair.generate().signPersonalMessage(new Uint8Array([1]))).signature }
  await expect(rewrapContentAppendPreparation({ ...f, record })).rejects.toThrow()
  expect(f.sign).not.toHaveBeenCalled(); expect(f.decryptCall).not.toHaveBeenCalled(); expect(f.encryptCall).not.toHaveBeenCalled()
})
it('freezes the next scope, public config, source record and wallet callback references across the unlock await', async () => {
  const f = await fixture(), expectedScope = structuredClone(f.nextScope), original = structuredClone(f.record)
  const sealConfig = structuredClone(f.sealConfig), wallet = { ...f.wallet }, record = structuredClone(f.record), nextScope = { ...f.nextScope }
  let release!: () => void, entered!: () => void
  const ready = new Promise<void>(resolve => { entered = resolve }), pause = new Promise<void>(resolve => { release = resolve })
  const realSign = f.sign.getMockImplementation()!
  f.sign.mockImplementationOnce(async message => { entered(); await pause; return realSign(message) })
  const pending = rewrapContentAppendPreparation({ record, nextScope, sealConfig, wallet }); await ready
  nextScope.versionIndex = '1'; nextScope.intentJson = '{"changed":true}'; record.ciphertext.fill(0)
  sealConfig.serverConfigs[0].aggregatorUrl = 'https://changed.example.com/'; sealConfig.threshold = 2
  wallet.signPersonalMessage = async () => { throw Error('Changed callback used') }; wallet.client = {} as any; wallet.sealClient = {} as any
  release(); const next = await pending
  expect(next.scope).toEqual(expectedScope); expect(next.sealConfig).toEqual(f.record.sealConfig); expect(next.ciphertext).toEqual(original.ciphertext)
  expect(f.sign).toHaveBeenCalledTimes(2); expect(f.decrypted.every(bytes => bytes.every(v => v === 0))).toBe(true)
})
it.each(['address', 'abort'])('rejects a late new-author signature after %s invalidation and wipes unwrapped private buffers', async mode => {
  const f = await fixture(), realSign = f.sign.getMockImplementation()!
  f.sign.mockImplementationOnce(realSign).mockImplementationOnce(async message => {
    if (mode === 'address') f.setAddress(id(99)); else f.controller.abort()
    return realSign(message)
  })
  await expect(rewrapContentAppendPreparation(f)).rejects.toThrow()
  expect(f.decryptCall).toHaveBeenCalledOnce(); expect(f.sign).toHaveBeenCalledTimes(2)
  expect(f.decrypted.every(bytes => bytes.every(v => v === 0))).toBe(true)
  expect(f.encryptCall.mock.calls.every(([args]) => args.data.every(v => v === 0))).toBe(true)
})
it('discards and wipes recovery plaintext returned after wallet invalidation during Seal decrypt', async () => {
  const f = await fixture(), realDecrypt = f.decryptCall.getMockImplementation()!
  f.decryptCall.mockImplementationOnce(async args => { const raw = await realDecrypt(args); f.setAddress(null); return raw })
  await expect(rewrapContentAppendPreparation(f)).rejects.toThrow('WALLET_CHANGED')
  expect(f.sign).toHaveBeenCalledOnce(); expect(f.encryptCall).not.toHaveBeenCalled()
  expect(f.decrypted).toHaveLength(1); expect(f.decrypted[0].every(v => v === 0)).toBe(true)
})
it('wipes private material if the new preparation signature is refused after a successful old unlock', async () => {
  const f = await fixture(), realSign = f.sign.getMockImplementation()!
  f.sign.mockImplementationOnce(realSign).mockRejectedValueOnce(Error('User rejected new stamp'))
  await expect(rewrapContentAppendPreparation(f)).rejects.toThrow('User rejected new stamp')
  expect(f.decrypted).toHaveLength(1); expect(f.decrypted.every(bytes => bytes.every(v => v === 0))).toBe(true)
  expect(f.encryptCall).toHaveBeenCalledTimes(2); expect(f.encryptCall.mock.calls.every(([args]) => args.data.every(v => v === 0))).toBe(true)
})
