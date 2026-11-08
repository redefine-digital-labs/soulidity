// Controlled chain/ABI/key-server responses; actual Seal/AES, signature and PTB codecs.
import { SealClient } from '../../web/node_modules/@mysten/seal/dist/index.mjs'
import { sha256 } from '@noble/hashes/sha2.js'
import { fromHex, toHex } from '@mysten/sui/utils'
import { nativeContentSealNamespace } from '../../web/lib/soulidity/native-creation-transaction'
import { afterEach, expect, it, vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { fromBase64, normalizeStructTag, toBase58, toBase64 } from '@mysten/sui/utils'
import { nativeAuthoringFixture } from './fixtures/native-authoring'
import { activityEvidenceFixture, aid } from './fixtures/activity-transaction-evidence'
import { openCanonicalNativeContent } from '../../web/lib/soulidity/canonical-native-content-open'
afterEach(() => vi.restoreAllMocks())
async function fixture() {
  const f = await nativeAuthoringFixture(), preparation = await f.prepare(), envelope = preparation.envelopes[0].envelope
  const pkg = await activityEvidenceFixture(), custodyId = f.request.target.custodyCallablePackageId
  pkg.deployment.originalPackageId = custodyId; pkg.deployment.callablePackageId = custodyId
  const p = pkg.packageData.data.Package!; p.id = custodyId; p.moduleMap = new Map([['account', new Uint8Array([1])]])
  p.typeOriginTable = [{ moduleName: 'account', datatypeName: 'Account', package: custodyId }]; pkg.rehashPackage()
  const client = f.params.wallet.client, file = preparation.preparation.manifest.files[0]
  vi.spyOn(client.ledgerService, 'getObject').mockResolvedValue({ response: { object: pkg.pkg } } as any)
  const dt = (name: string, reference: 'mutable' | 'immutable' | null = null) => ({ reference, body: { $kind: 'datatype', datatype: { typeName: normalizeStructTag(name), typeParameters: [] } } })
  const fn = { packageId: f.request.target.nativeCallablePackageId, moduleName: 'birth', name: 'seal_approve_content_owner', visibility: 'public', typeParameters: [], returns: [],
    parameters: [{ reference: null, body: { $kind: 'vector', vector: { $kind: 'u8' } } }, dt('0x2::kiosk::Kiosk', 'mutable'),
      dt(`${custodyId}::account::Account`, 'immutable'), dt('0x2::object::ID'), { reference: null, body: { $kind: 'u64' } }, dt('0x2::tx_context::TxContext', 'immutable')] }
  vi.mocked(client.core.getMoveFunction).mockResolvedValue({ function: fn } as any)
  vi.spyOn(client.core, 'getObjects').mockImplementation(async ({ objectIds }) => ({ objects: objectIds.map(objectId => ({ objectId, version: '4',
    digest: toBase58(new Uint8Array(32).fill(3)), owner: objectId === aid(42) ? { $kind: 'Shared', Shared: { initialSharedVersion: '1' } }
      : { $kind: 'AddressOwner', AddressOwner: f.request.author } })) }) as any)
  const pin = { originalPackageId: aid(90), callablePackageId: aid(91), callableDigest: pkg.deployment.callableDigest }
  const target = { chainIdentifier: '35834a8a', standard: pin, native: { originalPackageId: f.request.target.nativeOriginalPackageId,
    callablePackageId: f.request.target.nativeCallablePackageId, callableDigest: f.request.release.nativeCallableDigest }, content: pin,
    custody: { originalPackageId: custodyId, callablePackageId: custodyId, callableDigest: pkg.deployment.callableDigest }, registryId: f.request.target.registryId, configId: f.request.target.configId }
  const record = { index: '0', kind: 0, name: 'soul', version: '0', readMask: '3', deleted: false, purged: false, nonce: envelope.nonce,
    envelopeB64: toBase64(new TextEncoder().encode(JSON.stringify(envelope))), sealNamespaceB64: null, blobIdInteger: '1',
    blobObjectId: aid(45), byteLength: String(file.payloadByteLength), ciphertextHash: file.payloadHash, originalEndEpoch: 15 }
  const snapshot: any = { soulId: aid(44), contentId: f.request.contentId, custody: { ownerReadCandidate: true, viewerMatchesOwner: true,
    ownerAddress: f.request.author, kioskId: aid(42), accountId: aid(43) }, contentDirectory: { records: [record] } }
  const read = vi.fn(async () => structuredClone(snapshot))
  const fetcher = vi.fn(async () => new Response(new Uint8Array(preparation.preparation.payloads[0])))
  const input = { client, sealClient: client, target, soulId: aid(44), recordIndex: 0, viewerAddress: f.request.author,
    blobBaseUrl: 'https://walrus.example.com', sealConfig: f.params.sealConfig, signal: f.controller.signal,
    getAddress: f.params.wallet.getAddress, signPersonalMessage: f.sign }
  return { f, input, fn, record, snapshot, read, fetcher, run: () => openCanonicalNativeContent(input as any, { read: read as any, fetcher }) }
}
it('opens real encrypted Native preparation with actual Seal/AES and personal signature; never broadcasts a transaction', async () => {
  const f = await fixture(), result = await f.run()
  expect(result.bytes).toEqual(new Uint8Array(await f.f.params.files[0].file.arrayBuffer())); expect(f.f.sign).toHaveBeenCalledOnce()
  const tx = bcs.TransactionKind.parse(f.f.decryptCall.mock.calls[0][0].txBytes).ProgrammableTransaction!
  expect(tx.commands).toHaveLength(1)
  expect(tx.commands[0].MoveCall).toMatchObject({ package: f.input.target.native.callablePackageId, module: 'birth', function: 'seal_approve_content_owner' })
  expect(f.fetcher.mock.calls[0][0]).toContain('/v1/blobs/')
  expect(f.f.unwrapped.every(value => value.every(byte => byte === 0))).toBe(true)
  expect(f.read.mock.calls.length).toBeGreaterThan(3)
  result.bytes.fill(0)
})
it.each(['owner', 'deleted', 'namespace', 'abi', 'ciphertext', 'wallet'] as const)('refuses %s before any personal-message prompt', async mode => {
  const f = await fixture()
  if (mode === 'owner') f.snapshot.custody.ownerReadCandidate = false
  if (mode === 'deleted') f.record.deleted = true
  if (mode === 'namespace') f.record.nonce = 'ff'.repeat(16)
  if (mode === 'abi') f.fn.parameters.pop()
  if (mode === 'ciphertext') f.fetcher.mockImplementation(async () => new Response(new Uint8Array(Number(f.record.byteLength))))
  if (mode === 'wallet') f.f.setAddress(aid(99))
  await expect(f.run()).rejects.toThrow(); expect(f.f.sign).not.toHaveBeenCalled()
})
it('a source change after signing refuses decrypted content and wipes key material', async () => {
  const f = await fixture(), original = f.f.sign.getMockImplementation()!
  f.f.sign.mockImplementation(async message => { const signature = await original(message); f.snapshot.custody.accountId = aid(99); return signature })
  await expect(f.run()).rejects.toThrow('SOURCE_CHANGED')
  expect(f.f.decryptCall).not.toHaveBeenCalled()
})

it('opens an appended memory version using its actual versioned namespace', async () => {
  const f = await fixture(), version = '1', nonce = f.record.nonce
  const plaintext = new TextEncoder().encode('APPENDED MEMORY TEST'), keyBytes = new Uint8Array(32).fill(9), iv = new Uint8Array(12).fill(7)
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt'])
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)), hash = toHex(sha256(plaintext))
  const namespace = toHex(nativeContentSealNamespace(f.snapshot.contentId, 1, 'default', nonce, version))
  const seal = new SealClient({ suiClient: f.input.sealClient, serverConfigs: f.input.sealConfig.serverConfigs, verifyKeyServers: true })
  const material = new Uint8Array([...keyBytes, ...fromHex(hash)]), wrapped = await seal.encrypt({ packageId: f.input.target.native.originalPackageId,
    id: namespace, threshold: f.input.sealConfig.threshold, data: material })
  material.fill(0); keyBytes.fill(0); wrapped.key.fill(0)
  const envelope = JSON.parse(new TextDecoder().decode(fromBase64(f.record.envelopeB64)))
  Object.assign(envelope, { kind: 1, name: 'default', documentId: namespace, encryptedDek: toBase64(wrapped.encryptedObject), iv: toBase64(iv), contentHash: hash, fileName: 'memory.md' })
  Object.assign(f.record, { index: '2', kind: 1, name: 'default', version, ciphertextHash: toHex(sha256(ciphertext)), byteLength: String(ciphertext.length),
    envelopeB64: toBase64(new TextEncoder().encode(JSON.stringify(envelope))) })
  f.input.recordIndex = 2; f.fetcher.mockImplementation(async () => new Response(new Uint8Array(ciphertext)))
  const result = await f.run(); expect(result.bytes).toEqual(plaintext); result.bytes.fill(0)
})

it('rejects a stale recovered version or changed ciphertext before fetching or requesting a message signature', async () => {
  const f = await fixture()
  for (const expectedRecord of [
    { version: '9', ciphertextHash: f.record.ciphertextHash },
    { version: f.record.version, ciphertextHash: '00'.repeat(32) },
  ]) {
    await expect(openCanonicalNativeContent({ ...f.input, expectedRecord } as any,
      { read: f.read as any, fetcher: f.fetcher })).rejects.toThrow('SELECTED_RECORD_CHANGED')
  }
  expect(f.fetcher).not.toHaveBeenCalled()
  expect(f.f.sign).not.toHaveBeenCalled()
})
