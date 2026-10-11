import { afterEach, expect, it, vi } from 'vitest'
import { fromBase64, fromHex, toBase58 } from '@mysten/sui/utils'
import { EncryptedObject, SealClient } from '../../web/node_modules/@mysten/seal/dist/index.mjs'
import { blobIdFromInt } from '../../web/node_modules/@mysten/walrus/dist/index.mjs'
import { deriveMintContentObjectId, SOUL_PUBLIC_USDC_TYPE } from '../../packages/soulidity-sdk/src/index'
import { prepareSoulAuthoring } from '../../web/lib/soulidity/soul-authoring-preparation'
import { soulAuthoringPreparationHash, soulAuthoringStoreKey,
  type SoulAuthoringPreparation, type SoulAuthoringStore } from '../../web/lib/soulidity/soul-authoring-store'
import type { SoulAuthoringRequest } from '../../web/lib/soulidity/soul-authoring-manifest'
import { walrusBatchHash } from '../../web/lib/upload/walrus-batch-preparation'
import { contentAppendPreparationFixture, contentAppendFixtureId as id } from './fixtures/content-append-preparation'

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })
async function fixture() {
  const f = await contentAppendPreparationFixture(), author = f.signer.toSuiAddress(), mintNonce = '4'.repeat(32)
  const target = { chainIdentifier: '35834a8a', originalPackageId: id(1), callablePackageId: id(10),
    callableDigest: toBase58(new Uint8Array(32).fill(7)), marketConfigId: id(11), kioskRegistryId: id(12),
    personalKioskTypePackageId: id(13), paymentCoinType: SOUL_PUBLIC_USDC_TYPE, collectionTransferPolicyId: id(14),
    kioskPackageId: id(15), kindRegistryId: id(16), soulTransferPolicyId: id(17), blobBaseUrl: 'https://aggregator.example.com' }
  const request: SoulAuthoringRequest = { schema: 'soulidity.soul-authoring-request.v1', target, author,
    operationId: '1'.repeat(32), storageEpochs: 5, collection: null, bindCollectionId: null, mints: [{ kind: 'ORDINARY', mintNonce,
      contentObjectId: deriveMintContentObjectId({ ...target, author, mintNonce: fromHex(mintNonce) }), name: 'Saved creation',
      description: 'Original description', creatorRoyaltyBps: 100, image: { kind: 'URL', url: 'https://images.example.com/soul.png' },
      originRef: null, source: null, slots: [0, 1].map(kind => ({ fileIndex: kind, kind, name: kind ? 'default' : 'soul',
        versionIndex: '0', readModeMask: 3, downloadPolicy: 'public', setActive: false })),
      publicPreview: { tags: [], previewImages: [] }, stateConfig: [], listingPriceAtomic: null }] }
  let stored: SoulAuthoringPreparation | null = null, locked = false
  const store: SoulAuthoringStore = {
    exclusive: async (_key, work) => { if (locked) throw Error('BUSY'); locked = true; try { return await work() } finally { locked = false } },
    read: vi.fn(async () => structuredClone(stored)),
    create: vi.fn(async (_key, value) => { if (stored) throw Error('UNRESOLVED'); stored = structuredClone(value) }),
  }
  const client = { reset: vi.fn(), systemState: vi.fn(async () => ({ committee: { epoch: 10, n_shards: 4 } })),
    encodeBlob: vi.fn(async (bytes: Uint8Array) => ({ blobId: blobIdFromInt(BigInt(`0x${walrusBatchHash(bytes)}`)),
      rootHash: new Uint8Array(32).fill(6), metadata: { V1: { unencoded_length: String(bytes.length), encoding_type: 'RS2' } } })) }
  const params: Parameters<typeof prepareSoulAuthoring>[0] = { request,
    files: [0, 1].map(i => ({ file: new File([f.params.plaintext], `content-${i}.md`, { type: 'text/markdown' }),
      kind: 'soul-content', uploadType: 'encrypted' })),
    client: client as any, store, wallet: f.params.wallet, sealConfig: f.params.sealConfig, recoveryNonce: '3'.repeat(32),
    lifetime: { signal: f.controller.signal, getAddress: f.params.wallet.getAddress, isCurrent: () => true } }
  return { ...f, request, params, plaintext: f.params.plaintext, store, walrus: client, stored: () => stored }
}
it('persists identity, initial Seal envelopes and exact encrypted payloads before returning; cold retry does no crypto or signing', async () => {
  const f = await fixture(), first = await prepareSoulAuthoring(f.params), key = soulAuthoringStoreKey(f.request)
  expect(f.store.create).toHaveBeenCalledWith(key, first)
  expect(first.manifest.request.mints[0].contentObjectId).toBe(f.request.mints[0].contentObjectId)
  expect(first.manifest.sidecars).toHaveLength(2)
  expect(first.preparation.privateRecovery).not.toBeNull()
  for (const { sidecar } of first.manifest.sidecars) {
    expect(sidecar.sealPackageId).toBe(f.request.target.originalPackageId)
    expect(EncryptedObject.parse(fromBase64(sidecar.encryptedDek)).packageId).toBe(f.request.target.originalPackageId)
  }
  expect(EncryptedObject.parse(fromBase64(first.preparation.privateRecovery!.encrypted)).packageId)
    .toBe(f.request.target.originalPackageId)
  first.preparation.payloads.forEach(bytes => expect(Buffer.from(bytes).includes(Buffer.from(f.plaintext))).toBe(false))
  expect(JSON.stringify(first)).not.toContain('private memory: not in any public recovery journal')
  f.walrus.encodeBlob.mockClear(); f.walrus.systemState.mockClear()
  const second = await prepareSoulAuthoring({ ...f.params, files: [], recoveryNonce: '5'.repeat(32) })
  expect(soulAuthoringPreparationHash(second)).toBe(soulAuthoringPreparationHash(first))
  expect(second.preparation.payloads).toEqual(first.preparation.payloads)
  expect(f.walrus.encodeBlob).not.toHaveBeenCalled(); expect(f.walrus.systemState).not.toHaveBeenCalled()
  expect(f.store.create).toHaveBeenCalledTimes(1); expect(f.sign).not.toHaveBeenCalled()
  first.preparation.payloads[0].fill(0)
  expect(soulAuthoringPreparationHash(second)).toBe(soulAuthoringPreparationHash(f.stored()!))
})
it.each([1, 2, 3])('rejects callable-namespace Seal output at encryption %s before persistence or signing', async wrongCall => {
  const f = await fixture(), encrypt = SealClient.prototype.encrypt
  // Two initial content envelopes, then the private batch recovery envelope.
  let calls = 0
  vi.spyOn(SealClient.prototype, 'encrypt').mockImplementation(function (args) {
    calls += 1
    return encrypt.call(this, { ...args,
      packageId: calls === wrongCall ? f.request.target.callablePackageId : args.packageId })
  })
  await expect(prepareSoulAuthoring(f.params)).rejects.toThrow('Content encrypted key identity is invalid')
  expect(calls).toBe(wrongCall)
  expect(f.store.create).not.toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled()
})
it.each(['nonce', 'metadata', 'upgrade', 'operation'])('a pending authoring record cannot be bypassed by changing %s', async variant => {
  const f = await fixture(); await prepareSoulAuthoring(f.params)
  const changed = structuredClone(f.request), mint = changed.mints[0]
  if (variant === 'nonce') { mint.mintNonce = '6'.repeat(32); mint.contentObjectId = deriveMintContentObjectId({ ...changed.target,
    author: changed.author, mintNonce: fromHex(mint.mintNonce) }) }
  if (variant === 'metadata') mint.name = 'Another creation'
  if (variant === 'upgrade') changed.target.callablePackageId = id(66)
  if (variant === 'operation') changed.operationId = '6'.repeat(32)
  expect(soulAuthoringStoreKey(changed)).toBe(soulAuthoringStoreKey(f.request))
  f.walrus.encodeBlob.mockClear()
  await expect(prepareSoulAuthoring({ ...f.params, request: changed })).rejects.toThrow('UNRESOLVED_OPERATION')
  expect(f.store.create).toHaveBeenCalledTimes(1); expect(f.walrus.encodeBlob).not.toHaveBeenCalled()
})
it.each(['write', 'missing-readback', 'corrupt-readback'])('does not release prepared authoring after %s failure', async variant => {
  const f = await fixture()
  if (variant === 'write') vi.mocked(f.store.create).mockRejectedValue(Error('disk full'))
  else vi.mocked(f.store.read).mockResolvedValueOnce(null).mockImplementationOnce(async () => {
    if (variant === 'missing-readback') return null
    const value = structuredClone(f.stored()!); value.preparation.payloads[0][0] ^= 1; return value
  })
  await expect(prepareSoulAuthoring(f.params)).rejects.toThrow()
  expect(f.sign).not.toHaveBeenCalled()
})
it('checks wallet generation after persistence and can recover the retained record without recreating it', async () => {
  const f = await fixture(); let current = true
  const create = f.store.create
  f.store.create = vi.fn(async (key, value) => { await create(key, value); current = false })
  await expect(prepareSoulAuthoring({ ...f.params, lifetime: { ...f.params.lifetime, isCurrent: () => current } })).rejects.toThrow('LIFETIME_CHANGED')
  expect(f.stored()).not.toBeNull()
  f.walrus.encodeBlob.mockClear()
  await prepareSoulAuthoring(f.params)
  expect(f.walrus.encodeBlob).not.toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled()
})
it('serializes concurrent prepares and does not overwrite the first identity', async () => {
  const f = await fixture(), first = prepareSoulAuthoring(f.params)
  await expect(prepareSoulAuthoring(f.params)).rejects.toThrow('BUSY')
  await first; expect(f.store.create).toHaveBeenCalledTimes(1)
})
it('snapshots the request and upload client before asynchronous recovery reads', async () => {
  const f = await fixture()
  let release!: (value: null) => void, entered!: () => void
  const gate = new Promise<null>(resolve => { release = resolve }), reading = new Promise<void>(resolve => { entered = resolve })
  vi.mocked(f.store.read).mockImplementationOnce(() => { entered(); return gate })
  const pending = prepareSoulAuthoring(f.params)
  await reading
  const replacement = { ...f.walrus, encodeBlob: vi.fn(async () => { throw Error('Changed upload client') }) }
  f.params.client = replacement as any; f.params.request.mints[0].name = 'Later UI change'
  release(null)
  const saved = await pending
  expect(saved.manifest.request.mints[0].name).toBe('Saved creation')
  expect(f.walrus.encodeBlob).toHaveBeenCalledTimes(2); expect(replacement.encodeBlob).not.toHaveBeenCalled()
})
it('does not release the author lock while durable recovery reads are still pending', async () => {
  const f = await fixture()
  let release!: (value: null) => void, entered!: () => void, settled = false
  const gate = new Promise<null>(resolve => { release = resolve }), reading = new Promise<void>(resolve => { entered = resolve })
  vi.mocked(f.store.read).mockImplementationOnce(() => { entered(); return gate })
  vi.useFakeTimers()
  const pending = prepareSoulAuthoring(f.params).finally(() => { settled = true })
  const observed = pending.catch(error => error)
  await reading; await vi.advanceTimersByTimeAsync(31000)
  expect(settled).toBe(false)
  await expect(prepareSoulAuthoring(f.params)).rejects.toThrow('BUSY')
  vi.useRealTimers(); release(null)
  expect((await observed).schema).toBe('soulidity.soul-authoring-preparation.v1')
})
it('supports an empty Collection with a public URL without uploads or Seal', async () => {
  const f = await fixture(), request = structuredClone(f.request)
  request.collection = { name: 'Empty', description: 'Empty collection', image: request.mints[0].image, extraRoyaltyBps: 0,
    tradeable: true, maxSupply: null, floorPriceAtomic: null, listingPriceAtomic: null }; request.mints = []
  const result = await prepareSoulAuthoring({ ...f.params, request, files: [] })
  expect(result.manifest.sealContext).toBeNull(); expect(result.preparation.payloads).toEqual([])
  expect(f.walrus.systemState).not.toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled()
})
