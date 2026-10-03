import { describe, expect, it, vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import type { SuiClientTypes } from '@mysten/sui/client'
import { deriveDynamicFieldID, fromHex, normalizeStructTag, toBase58, toBase64 } from '@mysten/sui/utils'
import {
  assertPublicProfileMetadataRef, buildCreateWalletProfileTx, buildUpdateWalletProfileTx,
  normalizeWalletProfileHandle, ProfileRegistryV1Bcs, WalletProfileV1Bcs,
  readMyWalletProfile, readWalletProfile, readWalletProfileByHandle, readWalletProfileDirectory,
} from '../../packages/soulidity-sdk/src/wallet-profile'
import { encodePublicWalletProfileMetadata, publicWalletProfileMetadataHash, readPublicWalletProfile,
  ProfileWalrusBlobBcs, validatePublicWalletProfileMetadata } from '../../packages/soulidity-sdk/src/public-profile-metadata'
import { preparePublicProfileSave, PublicProfileReceiptPersistenceError, type PublicProfileSaveIntent, type PublicProfileUploadReceipt } from '../../packages/soulidity-sdk/src/public-profile-save'
import { createPublicProfileOperationClient } from '../../web/lib/profile/profile-operation-client'
import type { PublicProfileOperation } from '../../packages/soulidity-sdk/src/public-profile-operation'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const digest = toBase58(new Uint8Array(32).fill(1))
const deployment = { originalPackageId: id(1), callablePackageId: id(2), registryId: id(3), chainIdentifier: '01010101' }
const metadata = { blobObjectId: id(70), blobId: toBase64(new Uint8Array(32).fill(2)).replace(/=$/, ''),
  sha256: '03'.repeat(32), byteLength: 256 }
const md = { blob_object_id: metadata.blobObjectId, blob_id: new Array(32).fill(2),
  sha256: new Array(32).fill(3), byte_length: '256' }
type ReadObject = SuiClientTypes.Object<{ content: true }>
function fixture(count = 2) {
  const registry = { id: id(3), version: '1', profile_count: String(count),
    by_owner: { id: id(4), size: String(count) }, by_handle: { id: id(5), size: String(count) },
    by_index: { id: id(6), size: String(count) } }
  const rows = Array.from({ length: count }, (_, i) => ({ id: id(100 + i), version: '1', registry_id: id(3),
    owner: id(200 + i), revision: '0', handle: `user_${i}`, metadata: md, created_at_ms: '10', updated_at_ms: '10' }))
  const objects = new Map<string, ReadObject>()
  function put(objectId: string, type: string, owner: ReadObject['owner'], content: Uint8Array) {
    objects.set(objectId, { objectId, type, owner, version: '1', digest, content: new Uint8Array(content),
      json: undefined, objectBcs: undefined, previousTransaction: undefined, display: undefined })
  }
  function putRegistry() { put(id(3), `${id(1)}::profile::ProfileRegistryV1`,
    { $kind: 'Shared', Shared: { initialSharedVersion: '1' } }, ProfileRegistryV1Bcs.serialize(registry).toBytes()) }
  function putProfile(index: number) {
    const row = rows[index]
    put(row.id, `${id(1)}::profile::WalletProfileV1`, { $kind: 'AddressOwner', AddressOwner: row.owner },
      WalletProfileV1Bcs.serialize(row).toBytes())
  }
  function field(parentId: string, keyType: string, key: Uint8Array, value: string) {
    const fieldId = deriveDynamicFieldID(parentId, keyType, key)
    const bytes = new Uint8Array(64 + key.length)
    bytes.set(bcs.Address.serialize(fieldId).toBytes()); bytes.set(key, 32)
    bytes.set(bcs.Address.serialize(value).toBytes(), 32 + key.length)
    put(fieldId, normalizeStructTag(`0x2::dynamic_field::Field<${keyType},0x2::object::ID>`),
      { $kind: 'ObjectOwner', ObjectOwner: parentId }, bytes)
    return fieldId
  }
  putRegistry()
  rows.forEach((row, i) => {
    putProfile(i)
    field(id(4), 'address', bcs.Address.serialize(row.owner).toBytes(), row.id)
    field(id(5), normalizeStructTag('0x1::string::String'), bcs.string().serialize(row.handle).toBytes(), row.id)
    field(id(6), 'u64', bcs.u64().serialize(i).toBytes(), row.id)
  })
  // Use the actual SDK Core getObject implementation over exact BCS objects.
  // Field integrity is checked against raw owner/UID/name, not projected names.
  const grpc = new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://unused.invalid' })
  const client = grpc.core
  vi.spyOn(client, 'getChainIdentifier').mockResolvedValue({ chainIdentifier: digest })
  const getObjects = vi.spyOn(client, 'getObjects').mockImplementation(async args => ({
    objects: args.objectIds.map(objectId => objects.get(objectId) ?? new Error('Object not found')),
  }) as never)
  vi.spyOn(client, 'listOwnedObjects').mockImplementation(async args => ({ hasNextPage: false, cursor: null,
    objects: rows.filter(row => row.owner === args.owner).map(row => objects.get(row.id)!),
  }) as never)
  return { client, grpc, objects, rows, registry, put, putRegistry, putProfile, field, getObjects }
}

describe('public chain profile builders', () => {
  it('preserves handle normalization and clear semantics', () => {
    expect(normalizeWalletProfileHandle('  Alice_1  ')).toBe('alice_1')
    expect(normalizeWalletProfileHandle(null)).toBe('')
    expect(normalizeWalletProfileHandle('')).toBe('')
    for (const value of ['ADMIN', 'a', 'alice/bob', 'a'.repeat(31), '钱包名']) {
      expect(() => normalizeWalletProfileHandle(value)).toThrow()
    }
  })
  it('builds exact ABI with explicit owner, canonical handle and detached metadata', () => {
    const input = { deployment: structuredClone(deployment), owner: id(200), handle: ' Alice ', metadata: { ...metadata } }
    const tx = buildCreateWalletProfileTx(input)
    input.metadata.sha256 = '04'.repeat(32)
    input.deployment.callablePackageId = id(99)
    const data = tx.getData(), call = data.commands[0].MoveCall!
    expect(data.sender).toBe(id(200))
    expect(call).toMatchObject({ package: id(2), module: 'profile', function: 'create_profile', typeArguments: [] })
    expect(call.arguments).toHaveLength(7)
    const pure = (i: number) => data.inputs[(call.arguments[i] as { Input: number }).Input].Pure!.bytes
    expect(bcs.string().fromBase64(pure(1))).toBe('alice')
    expect(bcs.Address.fromBase64(pure(2))).toBe(metadata.blobObjectId)
    expect(bcs.vector(bcs.u8()).fromBase64(pure(4))).toEqual(new Array(32).fill(3))
    expect(bcs.u64().fromBase64(pure(5))).toBe('256')
  })
  it('binds update to a profile and exact lossless revision', () => {
    const tx = buildUpdateWalletProfileTx({ deployment, owner: id(200), profileId: id(100),
      expectedRevision: '9007199254740993', handle: null, metadata })
    const data = tx.getData(), call = data.commands[0].MoveCall!
    expect(call.function).toBe('update_profile')
    expect(call.arguments).toHaveLength(9)
    expect(bcs.u64().fromBase64(data.inputs[(call.arguments[2] as { Input: number }).Input].Pure!.bytes)).toBe('9007199254740993')
    for (const expectedRevision of ['-1', '01', '1.1', '18446744073709551615', 1]) {
      expect(() => buildUpdateWalletProfileTx({ deployment, owner: id(200), profileId: id(100),
        expectedRevision: expectedRevision as string, handle: null, metadata })).toThrow()
    }
  })
  it.each([
    { blobObjectId: id(0) }, { blobId: 'not-a-blob' }, { sha256: 'FF'.repeat(32) },
    { byteLength: 0 }, { byteLength: 65537 }, { byteLength: 1.5 },
  ])('rejects malformed public reference %o before building', patch => {
    expect(() => assertPublicProfileMetadataRef({ ...metadata, ...patch })).toThrow()
  })
})

describe('public profile cold metadata read', () => {
  const document = { schema: 'soulidity.public-profile.v1', displayName: 'Alice 艾丽丝', avatar: '🦊',
    bio: 'Public profile', coverImageUrl: null, twitterUrl: null, websiteUrl: 'https://example.com/' }
  const storage = { blobType: `${id(777)}::blob::Blob`, aggregatorUrl: 'https://storage.example.com' }
  async function coldFixture() {
    const f = fixture()
    const bytes = encodePublicWalletProfileMetadata(document)
    f.rows[0].metadata = { ...md, sha256: [...fromHex(await publicWalletProfileMetadataHash(bytes))], byte_length: String(bytes.length) }
    f.putProfile(0)
    const blob = { id: id(70), registered_epoch: 1, blob_id: bcs.u256().parse(new Uint8Array(32).fill(2)),
      size: String(bytes.length), encoding_type: 1, certified_epoch: 2 as number | null,
      storage: { id: id(71), start_epoch: 1, end_epoch: 10, storage_size: '4096' }, deletable: true }
    const putBlob = () => f.put(id(70), storage.blobType, { $kind: 'AddressOwner', AddressOwner: id(200) },
      ProfileWalrusBlobBcs.serialize(blob).toBytes())
    putBlob()
    const fetcher = vi.fn(async () => new Response(new Uint8Array(bytes), {
      headers: { 'content-type': 'application/json', 'content-length': String(bytes.length) },
    }))
    const read = (patch = {}) => readPublicWalletProfile({ client: f.client, deployment, profileId: id(100), storage, fetcher, ...patch })
    return { ...f, bytes, blob, putBlob, fetcher, read }
  }
  it('uses exact public chain pointer, verified Blob and digest with no credentials', async () => {
    const f = await coldFixture()
    const result = await f.read()
    expect(result.metadata).toEqual(document)
    expect(result.storageEndEpoch).toBe(10)
    expect(f.fetcher).toHaveBeenCalledWith(`${storage.aggregatorUrl}/v1/blobs/${metadata.blobId}`, expect.objectContaining({
      credentials: 'omit', redirect: 'error', cache: 'no-store', signal: expect.any(AbortSignal),
    }))
  })
  it.each([
    { apiKey: 'must never be published' }, { privateLoadouts: [] }, { deviceSecret: 'private' },
    { avatar: 'unknown' }, { displayName: 'x'.repeat(51) }, { bio: 'x'.repeat(161) },
    { websiteUrl: 'javascript:alert(1)' }, { websiteUrl: 'https://user:secret@example.com/' },
  ])('rejects invalid/private metadata fields %o', patch => {
    expect(() => validatePublicWalletProfileMetadata({ ...document, ...patch })).toThrow()
  })
  it.each(['blob-id', 'object-id', 'type', 'size', 'uncertified', 'certification-range', 'trailing-bytes'])('rejects invalid Blob %s before HTTP', async mutation => {
    const f = await coldFixture()
    if (mutation === 'blob-id') f.blob.blob_id = '999'
    if (mutation === 'object-id') f.blob.id = id(999)
    if (mutation === 'size') f.blob.size = '999'
    if (mutation === 'uncertified') f.blob.certified_epoch = null
    if (mutation === 'certification-range') f.blob.certified_epoch = 11
    f.putBlob()
    const raw = f.objects.get(id(70))!
    if (mutation === 'type') raw.type = `${id(888)}::blob::Blob`
    if (mutation === 'trailing-bytes') raw.content = new Uint8Array([...raw.content, 0])
    await expect(f.read()).rejects.toThrow()
    expect(f.fetcher).not.toHaveBeenCalled()
  })
  it.each(['digest', 'declared-length', 'short-body', 'long-body', 'malformed-schema'])('rejects invalid downloaded %s', async mutation => {
    const f = await coldFixture()
    if (mutation === 'digest') {
      const changed = new Uint8Array(f.bytes); changed[changed.length - 2] ^= 1
      f.fetcher.mockImplementation(async () => new Response(changed))
    }
    if (mutation === 'declared-length') f.fetcher.mockImplementation(async () => new Response(new Uint8Array(f.bytes), { headers: { 'content-length': '999' } }))
    if (mutation === 'short-body') f.fetcher.mockImplementation(async () => new Response(new Uint8Array(f.bytes.subarray(0, -1))))
    if (mutation === 'long-body') f.fetcher.mockImplementation(async () => new Response(new Uint8Array([...f.bytes, 0])))
    if (mutation === 'malformed-schema') {
      const bytes = new TextEncoder().encode(JSON.stringify({ ...document, apiKey: 'private' }))
      f.rows[0].metadata = { ...md, sha256: [...fromHex(await publicWalletProfileMetadataHash(bytes))], byte_length: String(bytes.length) }
      f.putProfile(0); f.blob.size = String(bytes.length); f.putBlob()
      f.fetcher.mockImplementation(async () => new Response(bytes))
    }
    await expect(f.read()).rejects.toThrow()
  })
  it('cancels a stalled HTTP body and rejects the pending profile read', async () => {
    const f = await coldFixture(), abort = new AbortController(), cancel = vi.fn()
    let enter!: () => void
    const entered = new Promise<void>(resolve => { enter = resolve })
    f.fetcher.mockImplementation(async () => new Response(new ReadableStream<Uint8Array>({
      pull() { enter(); return new Promise(() => {}) }, cancel,
    })))
    const pending = expect(f.read({ signal: abort.signal })).rejects.toThrow('wallet changed')
    await entered
    abort.abort(new Error('wallet changed'))
    await pending
    expect(cancel).toHaveBeenCalled()
  })
  it.each([429, 503])('cancels unfinished HTTP %s response bodies', async status => {
    const f = await coldFixture(), cancel = vi.fn()
    f.fetcher.mockImplementation(async () => new Response(new ReadableStream<Uint8Array>({
      pull() { return new Promise(() => {}) }, cancel,
    }), { status }))
    await expect(f.read()).rejects.toThrow('PROFILE_METADATA_STORAGE_UNAVAILABLE')
    expect(cancel).toHaveBeenCalledOnce()
  })
  async function saveFixture() {
    const f = await coldFixture(), signal = new AbortController()
    const intent: PublicProfileSaveIntent = { deployment: { ...deployment }, owner: id(200),
      expected: { profileId: id(100), revision: '0' }, handle: ' Alice ', metadata: { ...document, bio: 'Updated profile' } }
    const bytes = encodePublicWalletProfileMetadata(intent.metadata)
    const reference = { ...metadata, blobObjectId: id(72), sha256: await publicWalletProfileMetadataHash(bytes), byteLength: bytes.length }
    f.put(id(72), storage.blobType, { $kind: 'AddressOwner', AddressOwner: id(200) },
      ProfileWalrusBlobBcs.serialize({ ...f.blob, id: id(72), size: String(bytes.length) }).toBytes())
    const upload = vi.fn(async () => ({ ...reference })), persistReceipt = vi.fn(async (_receipt: PublicProfileUploadReceipt) => {})
    const fetcher = vi.fn(async () => new Response(new Uint8Array(bytes)))
    const save = (patch = {}) => preparePublicProfileSave({ intent, client: f.client, storage, signal: signal.signal,
      upload, persistReceipt, fetcher, ...patch })
    return { ...f, signal, intent, bytes, reference, upload, persistReceipt, fetcher, save }
  }
  it('prepares one revision-bound profile update after certified upload and durable receipt', async () => {
    const f = await saveFixture(), result = await f.save()
    expect(result.status).toBe('prepared')
    expect(f.upload).toHaveBeenCalledWith(f.bytes, f.signal.signal)
    expect(f.persistReceipt).toHaveBeenCalledOnce()
    expect(result.transaction?.getData().commands[0].MoveCall).toMatchObject({ module: 'profile', function: 'update_profile' })
    expect(f.persistReceipt.mock.invocationCallOrder[0]).toBeLessThan(f.fetcher.mock.invocationCallOrder[0])
  })
  it('prepares an explicit new profile, never an automatic wallet-connect write', async () => {
    const f = await saveFixture()
    f.intent.owner = id(999); f.intent.expected = null
    const result = await f.save()
    expect(result.transaction?.getData().sender).toBe(id(999))
    expect(result.transaction?.getData().commands[0].MoveCall?.function).toBe('create_profile')
  })
  it('reuses a paid upload receipt after verification failure without uploading again', async () => {
    const f = await saveFixture()
    f.fetcher.mockRejectedValueOnce(new Error('temporary storage failure'))
    await expect(f.save()).rejects.toThrow('temporary storage failure')
    const receipt = f.persistReceipt.mock.calls[0][0]
    const result = await f.save({ receipt })
    expect(result.status).toBe('prepared')
    expect(f.upload).toHaveBeenCalledOnce()
  })
  it('rejects changed-wallet/form receipt reuse before any upload', async () => {
    const f = await saveFixture(), first = await f.save()
    if (first.status !== 'prepared') throw new Error('Expected prepared')
    for (const changed of [{ owner: id(999), expected: null }, { handle: 'different' }]) {
      await expect(f.save({ intent: { ...f.intent, ...changed }, receipt: first.receipt })).rejects.toThrow('PROFILE_UPLOAD_RECEIPT_SCOPE_MISMATCH')
    }
    expect(f.upload).toHaveBeenCalledOnce()
  })
  it('rejects stale form revision before paying for upload', async () => {
    const f = await saveFixture()
    f.rows[0].revision = '1'; f.putProfile(0)
    await expect(f.save()).rejects.toThrow('PROFILE_CHANGED_RELOAD_REQUIRED')
    expect(f.upload).not.toHaveBeenCalled()
  })
  it('retains successful upload but refuses a profile changed during upload', async () => {
    const f = await saveFixture()
    f.upload.mockImplementation(async () => { f.rows[0].revision = '1'; f.putProfile(0); return f.reference })
    await expect(f.save()).rejects.toThrow('PROFILE_CHANGED_RELOAD_REQUIRED')
    expect(f.persistReceipt).toHaveBeenCalledOnce()
  })
  it('persists a late successful paid upload before wallet-switch cancellation', async () => {
    const f = await saveFixture()
    f.upload.mockImplementation(async () => { f.signal.abort(new Error('wallet changed')); return f.reference })
    await expect(f.save()).rejects.toThrow('wallet changed')
    expect(f.persistReceipt).toHaveBeenCalledOnce()
    expect(f.fetcher).not.toHaveBeenCalled()
  })
  it('refuses signing preparation when receipt persistence fails', async () => {
    const f = await saveFixture()
    f.persistReceipt.mockRejectedValue(new Error('Storage unavailable'))
    let failure: PublicProfileReceiptPersistenceError | undefined
    try { await f.save() } catch (error) {
      expect(error).toBeInstanceOf(PublicProfileReceiptPersistenceError)
      failure = error as PublicProfileReceiptPersistenceError
    }
    expect(failure?.cause).toEqual(new Error('Storage unavailable'))
    expect(f.fetcher).not.toHaveBeenCalled()
    const receipt = failure!.receipt
    receipt.reference.sha256 = '99'.repeat(32)
    expect(failure!.receipt.reference.sha256).toBe(f.reference.sha256)
    f.persistReceipt.mockResolvedValue()
    expect((await f.save({ receipt: failure!.receipt })).status).toBe('prepared')
    expect(f.upload).toHaveBeenCalledOnce()
  })
  it('rejects a substituted upload hash before a receipt is accepted', async () => {
    const f = await saveFixture()
    f.upload.mockResolvedValue({ ...f.reference, sha256: '99'.repeat(32) })
    await expect(f.save()).rejects.toThrow('PROFILE_UPLOADED_CONTENT_MISMATCH')
    expect(f.persistReceipt).not.toHaveBeenCalled()
  })
  it('snapshots form input before awaits', async () => {
    const f = await saveFixture(), pending = f.save()
    f.intent.metadata.bio = 'Later edits'; f.intent.owner = id(999)
    const result = await pending
    expect(result.transaction?.getData().sender).toBe(id(200))
    if (result.status !== 'prepared') throw new Error('Expected prepared')
    expect(result.intent.metadata.bio).toBe('Updated profile')
  })
  it('recognizes verified already-current values without another upload or transaction', async () => {
    const f = await coldFixture(), upload = vi.fn(), persistReceipt = vi.fn()
    const result = await preparePublicProfileSave({ client: f.client, storage,
      intent: { deployment, owner: id(200), expected: { profileId: id(100), revision: '0' }, handle: 'user_0', metadata: document },
      upload, persistReceipt, fetcher: f.fetcher, signal: new AbortController().signal })
    expect(result).toMatchObject({ status: 'already-current', transaction: null })
    expect(upload).not.toHaveBeenCalled(); expect(persistReceipt).not.toHaveBeenCalled()
  })
  it('rejects an already-current profile changed during content verification', async () => {
    const f = await coldFixture(), upload = vi.fn(), persistReceipt = vi.fn()
    f.fetcher.mockImplementation(async () => {
      f.rows[0].revision = '1'; f.rows[0].handle = 'changed'; f.putProfile(0)
      return new Response(new Uint8Array(f.bytes))
    })
    await expect(preparePublicProfileSave({ client: f.client, storage,
      intent: { deployment, owner: id(200), expected: { profileId: id(100), revision: '0' }, handle: 'user_0', metadata: document },
      upload, persistReceipt, fetcher: f.fetcher, signal: new AbortController().signal })).rejects.toThrow('PROFILE_CHANGED_RELOAD_REQUIRED')
    expect(upload).not.toHaveBeenCalled()
  })
  it.each([false, true])('actual signing preflight revalidates chain owner/revision and certified content; stale=%s', async stale => {
    const f = await saveFixture(), save = await f.save()
    if (save.status !== 'prepared') throw new Error('Expected prepared')
    const data = save.transaction.getData()
    const tx = Transaction.from(JSON.stringify({ ...data, inputs: data.inputs.map(input => {
      if (!input.UnresolvedObject) return input
      const objectId = input.UnresolvedObject.objectId
      return objectId === id(100) ? { Object: { ImmOrOwnedObject: { objectId, version: '1', digest } } }
        : { Object: { SharedObject: { objectId, initialSharedVersion: '1', mutable: objectId === id(3) } } }
    }) }))
    tx.setGasOwner(id(200)); tx.setGasBudget('1000000'); tx.setGasPrice('1000')
    tx.setGasPayment([{ objectId: id(900), version: '1', digest }]); tx.setExpiration({ Epoch: '10' })
    const bytes = await tx.build()
    const record: PublicProfileOperation = { schema: 'soulidity.public-profile-operation.v1', intent: save.intent, receipt: save.receipt,
      bytes: toBase64(bytes), digest: TransactionDataBuilder.getDigestFromBytes(bytes), expirationEpoch: '10', phase: 'PREPARED', signature: null }
    vi.spyOn(f.grpc.ledgerService, 'getEpoch').mockImplementation(async () => ({ response: { epoch: { epoch: 9n } } }) as never)
    const sign = vi.fn(), broadcast = vi.spyOn(f.client, 'executeTransaction')
    const { adapter } = createPublicProfileOperationClient({ client: f.grpc, deployment, storage, fetcher: f.fetcher,
      writesEnabled: () => true, getAddress: () => id(200), sign })
    if (stale) { f.rows[0].revision = '1'; f.putProfile(0) }
    if (stale) await expect(adapter.preflight(record, true)).rejects.toThrow('PROFILE_CHANGED_RELOAD_REQUIRED')
    else await expect(adapter.preflight(record, true)).resolves.toBeUndefined()
    expect(f.upload).toHaveBeenCalledOnce(); expect(sign).not.toHaveBeenCalled(); expect(broadcast).not.toHaveBeenCalled()
  })
})

describe('actual Core BCS profile reader', () => {
  it('reads profile, wallet and handle without SQL/auth/fetch endpoints', async () => {
    const f = fixture()
    const profile = await readWalletProfile({ client: f.client, deployment, profileId: id(100) })
    expect(profile).toMatchObject({ id: id(100), owner: id(200), registryId: id(3), revision: '0', handle: 'user_0', metadata })
    expect(await readMyWalletProfile({ client: f.client, deployment, owner: id(200) })).toEqual(profile)
    expect(await readWalletProfileByHandle({ client: f.client, deployment, handle: ' User_0 ' })).toEqual(profile)
    expect(await readMyWalletProfile({ client: f.client, deployment, owner: id(999) })).toBeNull()
  })
  it('never converts a network failure into an empty/new profile', async () => {
    const f = fixture()
    vi.spyOn(f.client, 'listOwnedObjects').mockRejectedValue(new Error('unavailable'))
    await expect(readMyWalletProfile({ client: f.client, deployment, owner: id(200) })).rejects.toThrow('unavailable')
  })
  it('rejects another chain before any object request', async () => {
    const f = fixture()
    await expect(readWalletProfile({ client: f.client, deployment: { ...deployment, chainIdentifier: '00000000' },
      profileId: id(100) })).rejects.toThrow('PROFILE_WRONG_CHAIN')
    expect(f.getObjects).not.toHaveBeenCalled()
  })
  it.each(['type', 'owner', 'registry', 'version', 'id', 'handle', 'trailing-bytes', 'length'])('rejects forged %s', async mutation => {
    const f = fixture(), row = f.rows[0], object = f.objects.get(row.id)!
    if (mutation === 'type') object.type = `${id(9)}::profile::WalletProfileV1`
    if (mutation === 'owner') object.owner = { $kind: 'AddressOwner', AddressOwner: id(999) }
    if (mutation === 'registry') { row.registry_id = id(9); f.putProfile(0) }
    if (mutation === 'version') { row.version = '2'; f.putProfile(0) }
    if (mutation === 'id') { row.id = id(99); object.content = WalletProfileV1Bcs.serialize(row).toBytes() }
    if (mutation === 'handle') { row.handle = 'UPPER'; f.putProfile(0) }
    if (mutation === 'trailing-bytes') object.content = new Uint8Array([...object.content, 0])
    if (mutation === 'length') { row.metadata = { ...row.metadata, byte_length: '65537' }; f.putProfile(0) }
    await expect(readWalletProfile({ client: f.client, deployment, profileId: id(100) })).rejects.toThrow()
  })
  it('verifies the owner index instead of trusting profile fields alone', async () => {
    const f = fixture()
    f.field(id(4), 'address', bcs.Address.serialize(id(200)).toBytes(), id(101))
    await expect(readWalletProfile({ client: f.client, deployment, profileId: id(100) })).rejects.toThrow('PROFILE_OWNER_INDEX_MISMATCH')
  })
  it.each(['uid', 'name', 'owner', 'trailing-bytes'])('rejects corrupt raw index %s even at its derived object ID', async mutation => {
    const f = fixture()
    const fieldId = deriveDynamicFieldID(id(4), 'address', bcs.Address.serialize(id(200)).toBytes())
    const field = f.objects.get(fieldId)!
    if (mutation === 'uid') field.content.set(bcs.Address.serialize(id(999)).toBytes(), 0)
    if (mutation === 'name') field.content.set(bcs.Address.serialize(id(999)).toBytes(), 32)
    if (mutation === 'owner') field.owner = { $kind: 'ObjectOwner', ObjectOwner: id(999) }
    if (mutation === 'trailing-bytes') field.content = new Uint8Array([...field.content, 0])
    await expect(readWalletProfile({ client: f.client, deployment, profileId: id(100) })).rejects.toThrow('PROFILE_INDEX_FIELD_MISMATCH')
  })
  it('rejects corrupt registry table counts', async () => {
    const f = fixture()
    f.registry.by_owner.size = '1'; f.putRegistry()
    await expect(readWalletProfile({ client: f.client, deployment, profileId: id(100) })).rejects.toThrow('PROFILE_REGISTRY_INDEX_MISMATCH')
  })
  it('does not infer profile identity from a handle that changed during reads', async () => {
    const f = fixture()
    f.rows[0].handle = 'renamed'; f.putProfile(0)
    await expect(readWalletProfileByHandle({ client: f.client, deployment, handle: 'user_0' })).rejects.toThrow('PROFILE_HANDLE_CHANGED_RETRY')
  })
  it('reports bounded ordered directory pages and their completeness', async () => {
    const f = fixture(10)
    const first = await readWalletProfileDirectory({ client: f.client, deployment, limit: 3 })
    expect(first.profiles.map(row => row.id)).toEqual([id(100), id(101), id(102)])
    expect(first).toMatchObject({ nextIndex: '3', observedCount: '10' })
    const final = await readWalletProfileDirectory({ client: f.client, deployment, startIndex: '3', limit: 50 })
    expect(final.profiles).toHaveLength(7)
    expect(final.nextIndex).toBeNull()
    await expect(readWalletProfileDirectory({ client: f.client, deployment, limit: 51 })).rejects.toThrow('PROFILE_INVALID_PAGE_LIMIT')
    await expect(readWalletProfileDirectory({ client: f.client, deployment, startIndex: '11' })).rejects.toThrow('PROFILE_PAGE_OUT_OF_RANGE')
  })
  it('rejects duplicate directory entries instead of presenting a partial catalog', async () => {
    const f = fixture()
    f.field(id(6), 'u64', bcs.u64().serialize(1).toBytes(), id(100))
    await expect(readWalletProfileDirectory({ client: f.client, deployment })).rejects.toThrow('PROFILE_DUPLICATE_DIRECTORY_ENTRY')
  })
  it('cancels before reads and snapshots caller configuration before awaits', async () => {
    const f = fixture(), abort = new AbortController()
    abort.abort(new Error('wallet changed'))
    await expect(readMyWalletProfile({ client: f.client, deployment, owner: id(200), signal: abort.signal })).rejects.toThrow('wallet changed')
    expect(f.getObjects).not.toHaveBeenCalled()
    const target = { ...deployment }
    const promise = readWalletProfile({ client: f.client, deployment: target, profileId: id(100) })
    target.registryId = id(999)
    expect((await promise).id).toBe(id(100))
  })
  it.each(['chain', 'object', 'owned'])('cancels in-flight %s even when transport ignores the signal', async phase => {
    const f = fixture(), abort = new AbortController()
    let entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    let rejectTransport!: (error: Error) => void
    const stalled = () => { entered(); return new Promise<never>((_, reject) => { rejectTransport = reject }) }
    if (phase === 'chain') vi.spyOn(f.client, 'getChainIdentifier').mockImplementation(stalled)
    if (phase === 'object') vi.spyOn(f.client, 'getObject').mockImplementation(stalled)
    if (phase === 'owned') vi.spyOn(f.client, 'listOwnedObjects').mockImplementation(stalled)
    const pending = readMyWalletProfile({ client: f.client, deployment, owner: id(200), signal: abort.signal })
    const observed = expect(pending).rejects.toThrow('wallet changed')
    await started
    abort.abort(new Error('wallet changed'))
    await observed
    rejectTransport(new Error('late network failure'))
    await new Promise(resolve => setTimeout(resolve, 0))
  })
})
