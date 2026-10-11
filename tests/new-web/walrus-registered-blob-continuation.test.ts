import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { fromBase64, toBase58, toBase64 } from '@mysten/sui/utils'
import { singleSigner, singleUploadFixture, uid } from './fixtures/walrus-single-upload'
import { SystemStateInnerV1 } from '../../web/node_modules/@mysten/walrus/dist/contracts/walrus/system_state_inner.mjs'
import { Field } from '../../web/node_modules/@mysten/walrus/dist/utils/bcs.mjs'
import { readWalrusSingleRecord, writeWalrusSingleRecord } from '../../web/lib/upload/walrus-single-operation'
import { continueRegisteredWalrusBlob } from '../../web/lib/upload/walrus-single-upload'

// Actual Walrus SDK resume/certify graphs, canonical Sui BCS, signatures and
// evidence readers. Relay/quorum/RPC are controlled fixture boundaries, not
// real network execution. Shared fixtures and production code remain unchanged.
const BlobBcs = bcs.struct('Blob', { id: bcs.Address, registered_epoch: bcs.u32(), blob_id: bcs.u256(), size: bcs.u64(),
  encoding_type: bcs.u8(), certified_epoch: bcs.option(bcs.u32()), storage: bcs.struct('Storage', {
    id: bcs.Address, start_epoch: bcs.u32(), end_epoch: bcs.u32(), storage_size: bcs.u64(),
  }), deletable: bcs.bool() })
let local: Map<string, string>
beforeEach(() => {
  local = new Map()
  vi.stubGlobal('window', { localStorage: { getItem: (key: string) => local.get(key) ?? null, setItem: (key: string, value: string) => local.set(key, value) } })
  vi.stubGlobal('navigator', { locks: { request: async (_key: string, _options: unknown, work: (lock: object) => unknown) => work({}) } })
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('Unexpected network') }))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
async function fixture() {
  const attachment = { scope: 'content:original-registered-blob', append: (tx: Transaction, blob: string) => {
    tx.moveCall({ target: `${uid(7)}::content::append`, arguments: [tx.object(blob), tx.pure.u64(2)] })
  } }
  const f = await singleUploadFixture(attachment, true)
  let blobOwner = f.intent.owner, forceCertified = false
  const read = f.client.core.getObject.getMockImplementation()!
  f.client.core.getObject.mockImplementation(async params => {
    const result = await read(params), blob = BlobBcs.parse(result.object.content)
    if (forceCertified) blob.certified_epoch = 9
    return { object: { ...result.object, content: BlobBcs.serialize(blob).toBytes(), version: blob.certified_epoch === null ? '2' : '3',
      digest: toBase58(new Uint8Array(32).fill(5)), owner: { $kind: 'AddressOwner', AddressOwner: blobOwner } } } as any
  })
  // Establish actual signed/final register, then stop before relay/certify.
  f.relayWrite.mockRejectedValueOnce(Error('seed registered-only stage'))
  await expect(f.run()).rejects.toThrow('seed registered-only stage')
  const record = readWalrusSingleRecord(f.key)!
  expect(record.register?.phase).toBe('SUCCEEDED'); expect(record.certify).toBeNull(); expect(record.uploaded).toBeNull()
  const verify = vi.fn(async () => {}), beforeWrite = vi.fn(async () => {})
  const execution = { ...f.execution, beforeWrite }
  const flow = vi.spyOn(f.walrus, 'writeBlobFlow')
  f.sign.mockClear(); f.approve.mockClear(); f.relayWrite.mockClear(); f.metadata.mockClear(); f.client.core.executeTransaction.mockClear()
  const params = { record, payload: f.payload, execution, attachment, createClient: f.createClient, certifyGasBudget: 50_000_000n, verify }
  return { ...f, record, verify, beforeWrite, execution, flow, params,
    continue: () => continueRegisteredWalrusBlob(params), setBlobOwner: (owner: string) => { blobOwner = owner },
    setCertified: () => { forceCertified = true } }
}
function expectNoNewRegister(f: Awaited<ReturnType<typeof fixture>>) {
  expect(f.approve).not.toHaveBeenCalled()
  for (const [args] of f.client.core.executeTransaction.mock.calls) {
    const calls = Transaction.from(args.transaction).getData().commands.filter(c => c.MoveCall).map(c => c.MoveCall!.function)
    expect(calls).not.toContain('register_blob'); expect(calls).not.toContain('reserve_space')
  }
  expect(readWalrusSingleRecord(f.key)?.register?.bytes).toBe(f.record.register!.bytes)
}
it('continues only the paid register, resumes its exact nonce, and signs certify plus the requested attachment', async () => {
  const f = await fixture(), result = await f.continue(), saved = readWalrusSingleRecord(f.key)!
  expect(result.storageTxDigest).toBe(f.record.register!.digest); expect(result.blobObjectId).toBe(f.blobObjectId)
  expect(f.sign).toHaveBeenCalledOnce(); expect(f.client.core.executeTransaction).toHaveBeenCalledOnce(); expect(f.relayWrite).toHaveBeenCalledOnce()
  expect(f.metadata.mock.calls[0][0].nonce).toEqual(fromBase64(f.record.encoding!.nonce!))
  expect(f.relayWrite.mock.calls[0][0]).toMatchObject({ txDigest: f.record.register!.digest, blobObjectId: f.blobObjectId })
  expect(Transaction.from(fromBase64(saved.certify!.bytes)).getData().commands.filter(c => c.MoveCall).map(c => c.MoveCall!.function))
    .toEqual(['certify_blob', 'append'])
  expect(f.verify).toHaveBeenCalledTimes(5); expect(f.beforeWrite).toHaveBeenCalledTimes(5); expectNoNewRegister(f)
})
it('refuses missing durable WAL without building a flow, quoting or registering again', async () => {
  const f = await fixture(); local.delete(f.key)
  await expect(f.continue()).rejects.toThrow('DURABLE_ATTEMPT_REQUIRED')
  expect(f.flow).not.toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled(); expect(f.relayWrite).not.toHaveBeenCalled()
  expect(f.client.core.executeTransaction).not.toHaveBeenCalled(); expect(f.approve).not.toHaveBeenCalled(); expect(local.size).toBe(0)
})
it.each(['intent', 'encoding-root', 'nonce', 'approved-gas', 'quote'])('rejects durable %s replacement relative to the captured paid root', async field => {
  const f = await fixture(), changed = structuredClone(f.record)
  if (field === 'intent') changed.intent.contentHash = 'ab'.repeat(32)
  if (field === 'encoding-root') changed.encoding!.rootHash = toBase64(new Uint8Array(32).fill(8))
  if (field === 'nonce') changed.encoding!.nonce = toBase64(new Uint8Array(32).fill(9))
  if (field === 'approved-gas') changed.approved!.gasBudget = '200000000'
  if (field === 'quote') changed.approved!.quoteId = 'different quote'
  writeWalrusSingleRecord(f.key, changed)
  await expect(f.continue()).rejects.toThrow('STORAGE_ROOT_CHANGED')
  expect(f.sign).not.toHaveBeenCalled(); expect(f.relayWrite).not.toHaveBeenCalled(); expect(f.flow).not.toHaveBeenCalled()
  expectNoNewRegister(f)
})
it.each([0n, 49_999_999n, 100_000_000n, 18446744073709551616n])('rejects a certification gas budget %s not covered by the original approval', async budget => {
  const f = await fixture()
  await expect(continueRegisteredWalrusBlob({ ...f.params, certifyGasBudget: budget })).rejects.toThrow('GAS_APPROVAL_REQUIRED')
  expect(f.sign).not.toHaveBeenCalled(); expect(f.relayWrite).not.toHaveBeenCalled(); expectNoNewRegister(f)
})
it('rejects changed source bytes before relay work or any signature', async () => {
  const f = await fixture(), payload = new Uint8Array(f.payload); payload[0] ^= 1
  await expect(continueRegisteredWalrusBlob({ ...f.params, payload })).rejects.toThrow('SOURCE_BYTES_MISMATCH')
  expect(f.sign).not.toHaveBeenCalled(); expect(f.relayWrite).not.toHaveBeenCalled(); expectNoNewRegister(f)
})
it.each(['rootHash', 'nonce'])('rejects actual resumed SDK %s encoding drift even when the stored paid root is unchanged', async field => {
  const f = await fixture(), original = f.metadata.getMockImplementation()!
  f.metadata.mockImplementation(async params => ({ ...await original(params), [field]: new Uint8Array(32).fill(99) }))
  await expect(f.continue()).rejects.toThrow('ENCODING_MISMATCH')
  expect(f.relayWrite).not.toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled(); expectNoNewRegister(f)
})
it('retains paid registration across relay failure and resumes without another register or quote', async () => {
  const f = await fixture(); f.relayWrite.mockRejectedValueOnce(Error('relay unavailable'))
  await expect(f.continue()).rejects.toThrow('relay unavailable')
  expect(readWalrusSingleRecord(f.key)?.register).toEqual(f.record.register); expect(f.sign).not.toHaveBeenCalled()
  await f.continue(); expect(f.relayWrite).toHaveBeenCalledTimes(2); expect(f.sign).toHaveBeenCalledOnce()
  expect(f.relayWrite.mock.calls.map(([args]) => args.txDigest)).toEqual([f.record.register!.digest, f.record.register!.digest]); expectNoNewRegister(f)
})
it('retains exact prepared certification bytes after a lost signing response and retries only that certification', async () => {
  const f = await fixture(), actualSign = f.sign.getMockImplementation()!
  f.sign.mockImplementationOnce(async tx => { await actualSign(tx); throw Error('sign response lost') })
  await expect(f.continue()).rejects.toThrow('sign response lost'); const prior = readWalrusSingleRecord(f.key)!.certify!
  expect(prior.phase).toBe('SIGNING'); expect(f.client.core.executeTransaction).not.toHaveBeenCalled()
  await f.continue(); expect(f.sign).toHaveBeenCalledTimes(2); expect(f.relayWrite).toHaveBeenCalledOnce()
  expect(readWalrusSingleRecord(f.key)!.certify!.bytes).toBe(prior.bytes)
  expect(f.client.core.executeTransaction.mock.calls[0][0].transaction).toEqual(fromBase64(prior.bytes)); expectNoNewRegister(f)
})
it('rebroadcasts the original signed certification after an unknown broadcast without another signature or upload', async () => {
  const f = await fixture(); f.client.core.executeTransaction.mockRejectedValueOnce(Error('broadcast unknown'))
  await expect(f.continue()).rejects.toThrow('broadcast unknown'); const prior = readWalrusSingleRecord(f.key)!.certify!
  expect(prior.phase).toBe('SIGNED'); await f.continue()
  expect(f.sign).toHaveBeenCalledOnce(); expect(f.relayWrite).toHaveBeenCalledOnce()
  expect(f.client.core.executeTransaction.mock.calls.map(([args]) => toBase64(args.transaction))).toEqual([prior.bytes, prior.bytes]); expectNoNewRegister(f)
})
it('query-first recognizes a committed certification after a lost response without live wallet or verifier', async () => {
  const f = await fixture(), actualExecute = f.client.core.executeTransaction.getMockImplementation()!
  f.client.core.executeTransaction.mockImplementationOnce(async args => { await actualExecute(args); throw Error('committed response lost') })
  await expect(f.continue()).rejects.toThrow('committed response lost')
  const packet = readWalrusSingleRecord(f.key)!.certify!; f.setOwner(null)
  f.verify.mockReset().mockRejectedValue(Error('current grant gone')); f.beforeWrite.mockReset().mockRejectedValue(Error('closed writes'))
  const result = await f.continue()
  expect(result.certifyTxDigest).toBe(packet.digest); expect(f.verify).not.toHaveBeenCalled(); expect(f.beforeWrite).not.toHaveBeenCalled()
  expect(f.sign).toHaveBeenCalledOnce(); expect(f.client.core.executeTransaction).toHaveBeenCalledOnce(); expect(f.relayWrite).toHaveBeenCalledOnce(); expectNoNewRegister(f)
})
it.each([1, 2, 3, 4, 5])('stops on authority refusal at continuation write checkpoint %s', async refusal => {
  const f = await fixture(); let count = 0
  f.verify.mockImplementation(async () => { if (++count === refusal) throw Error('authority changed') })
  await expect(f.continue()).rejects.toThrow('authority changed')
  expect(f.client.core.executeTransaction).not.toHaveBeenCalled(); expect(f.sign).toHaveBeenCalledTimes(refusal === 5 ? 1 : 0)
  expect(f.relayWrite).toHaveBeenCalledTimes(refusal <= 2 ? 0 : 1); expectNoNewRegister(f)
})
it('rechecks the live wallet after external verification and never signs for a changed address', async () => {
  const f = await fixture(); f.verify.mockImplementationOnce(async () => { f.setOwner(uid(99)) })
  await expect(f.continue()).rejects.toThrow('RECONNECT_PREPARING_WALLET')
  expect(f.sign).not.toHaveBeenCalled(); expect(f.relayWrite).not.toHaveBeenCalled(); expectNoNewRegister(f)
})
it('retains a signature returned after the wallet changes but blocks broadcast until the original wallet reconnects', async () => {
  const f = await fixture(), actualSign = f.sign.getMockImplementation()!
  f.sign.mockImplementationOnce(async tx => { const signature = await actualSign(tx); f.setOwner(null); return signature })
  await expect(f.continue()).rejects.toThrow('RECONNECT_PREPARING_WALLET')
  const original = readWalrusSingleRecord(f.key)!.certify!
  expect(original.phase).toBe('SIGNED'); expect(f.client.core.executeTransaction).not.toHaveBeenCalled()
  f.setOwner(f.intent.owner); await f.continue()
  expect(f.sign).toHaveBeenCalledOnce(); expect(f.client.core.executeTransaction).toHaveBeenCalledOnce()
  expect(f.client.core.executeTransaction.mock.calls[0][0].transaction).toEqual(fromBase64(original.bytes)); expectNoNewRegister(f)
})
it.each(['expired', 'certified', 'owner'])('rejects a current Blob that is %s before relay/signing', async state => {
  const f = await fixture()
  if (state === 'expired') { const current = await f.walrus.systemState(); vi.mocked(f.walrus.systemState).mockResolvedValue({ ...current, committee: { ...current.committee, epoch: 12 } }) }
  if (state === 'certified') f.setCertified()
  if (state === 'owner') f.setBlobOwner(uid(99))
  await expect(f.continue()).rejects.toThrow(state === 'expired' ? 'STORAGE_EXPIRED' : state === 'certified' ? 'NOT_UNCERTIFIED' : 'BLOB_OWNER_MISMATCH')
  expect(f.sign).not.toHaveBeenCalled(); expect(f.relayWrite).not.toHaveBeenCalled(); expectNoNewRegister(f)
})
it('rejects a forged retained certify signature without rebroadcasting or replacing it', async () => {
  const f = await fixture(); f.client.core.executeTransaction.mockRejectedValueOnce(Error('broadcast unknown'))
  await expect(f.continue()).rejects.toThrow('broadcast unknown')
  const saved = readWalrusSingleRecord(f.key)!
  saved.certify!.signature = (await Ed25519Keypair.generate().signTransaction(fromBase64(saved.certify!.bytes))).signature
  writeWalrusSingleRecord(f.key, saved); f.client.core.executeTransaction.mockClear()
  await expect(f.continue()).rejects.toThrow()
  expect(readWalrusSingleRecord(f.key)!.certify!.signature).toBe(saved.certify!.signature)
  expect(f.client.core.executeTransaction).not.toHaveBeenCalled(); expect(f.sign).toHaveBeenCalledOnce(); expectNoNewRegister(f)
})
it.each(['FAILED', 'PENDING'])('keeps an original %s certification packet without auto replacement or write checks', async status => {
  const f = await fixture(); await f.continue(); const saved = readWalrusSingleRecord(f.key)!, original = f.client.ledgerService.getTransaction.getMockImplementation()!
  f.client.ledgerService.getTransaction.mockImplementation(async args => {
    const value = await original(args)
    if (args.digest !== saved.certify!.digest) return value
    if (status === 'PENDING') return { response: { transaction: { ...value.response.transaction, checkpoint: undefined } } } as any
    const effects = bcs.TransactionEffects.parse(value.response.transaction.effects.bcs.value)
    effects.V2!.status = { $kind: 'Failure', Failure: { error: { $kind: 'InsufficientGas', InsufficientGas: true }, command: 0 } }
    return { response: { transaction: { ...value.response.transaction,
      effects: { status: { success: false }, bcs: { value: bcs.TransactionEffects.serialize(effects).toBytes() } } } } } as any
  })
  f.verify.mockClear(); f.sign.mockClear(); f.relayWrite.mockClear(); f.client.core.executeTransaction.mockClear()
  await expect(f.continue()).rejects.toThrow(status === 'FAILED' ? 'FAILED_NO_AUTOMATIC_REPLACEMENT' : 'TRANSACTION_PENDING')
  expect(readWalrusSingleRecord(f.key)!.certify).toEqual(saved.certify); expect(f.verify).not.toHaveBeenCalled()
  expect(f.sign).not.toHaveBeenCalled(); expect(f.relayWrite).not.toHaveBeenCalled(); expect(f.client.core.executeTransaction).not.toHaveBeenCalled(); expectNoNewRegister(f)
})
it('refreshes the real SDK object-loader cache before checking a registration that expired during a wait', async () => {
  const f = await fixture(); let epoch = 9
  vi.mocked(f.walrus.systemState).mockRestore()
  vi.mocked(f.walrus.systemObject).mockResolvedValue({ id: uid(50), package_id: uid(3), version: '1' } as any)
  f.client.core.getObjects.mockClear().mockImplementation(async () => ({ objects: [{ objectId: uid(51), type: 'field',
    content: Field(bcs.u64(), SystemStateInnerV1).serialize({ id: uid(51), name: '1', value: {
      committee: { epoch, n_shards: 1, members: [], total_aggregated_key: { bytes: [] } },
      total_capacity_size: '1', used_capacity_size: '0', storage_price_per_unit_size: '1', write_price_per_unit_size: '1',
      future_accounting: { current_index: 0, length: 0, ring_buffer: [] },
      event_blob_certification_state: { latest_certified_blob: null, aggregate_weight_per_blob: { contents: [] } },
      deny_list_sizes: { id: uid(52) },
    } }).toBytes() }] }))
  expect((await f.walrus.systemState()).committee.epoch).toBe(9)
  epoch = 12
  expect((await f.walrus.systemState()).committee.epoch).toBe(9)
  expect(f.client.core.getObjects).toHaveBeenCalledOnce()
  await expect(f.continue()).rejects.toThrow('STORAGE_EXPIRED')
  expect((await f.walrus.systemState()).committee.epoch).toBe(12)
  expect(f.client.core.getObjects).toHaveBeenCalledTimes(2)
  expect(f.sign).not.toHaveBeenCalled(); expect(f.relayWrite).not.toHaveBeenCalled(); expectNoNewRegister(f)
})
it('does not rebroadcast a retained SIGNED certification after the Blob storage expires', async () => {
  const f = await fixture(); f.client.core.executeTransaction.mockRejectedValueOnce(Error('broadcast unknown'))
  await expect(f.continue()).rejects.toThrow('broadcast unknown')
  const packet = readWalrusSingleRecord(f.key)!.certify!
  const current = await f.walrus.systemState()
  vi.mocked(f.walrus.systemState).mockResolvedValue({ ...current, committee: { ...current.committee, epoch: 12 } })
  f.client.core.executeTransaction.mockClear()
  await expect(f.continue()).rejects.toThrow('STORAGE_EXPIRED')
  expect(readWalrusSingleRecord(f.key)!.certify).toEqual(packet)
  expect(f.client.core.executeTransaction).not.toHaveBeenCalled(); expect(f.sign).toHaveBeenCalledOnce(); expectNoNewRegister(f)
})
it.each(['over-budget', 'attachment'])('rejects self-consistently re-signed retained certification with changed %s bytes', async change => {
  const f = await fixture(); f.client.core.executeTransaction.mockRejectedValueOnce(Error('broadcast unknown'))
  await expect(f.continue()).rejects.toThrow('broadcast unknown')
  const saved = readWalrusSingleRecord(f.key)!, tx = Transaction.from(fromBase64(saved.certify!.bytes))
  if (change === 'over-budget') tx.setGasBudget(50_000_001n)
  else tx.moveCall({ target: `${uid(7)}::content::append`, arguments: [tx.object(f.blobObjectId), tx.pure.u64(3)] })
  const bytes = await tx.build({ client: f.execution.client })
  saved.certify = { ...saved.certify!, bytes: toBase64(bytes), digest: TransactionDataBuilder.getDigestFromBytes(bytes),
    signature: (await singleSigner.signTransaction(bytes)).signature }
  writeWalrusSingleRecord(f.key, saved); f.client.core.executeTransaction.mockClear()
  await expect(f.continue()).rejects.toThrow(change === 'over-budget' ? 'APPROVED_GAS_EXCEEDED' : 'SDK_TEMPLATE_CHANGED_QUERY_ONLY')
  expect(readWalrusSingleRecord(f.key)!.certify).toEqual(saved.certify)
  expect(f.client.core.executeTransaction).not.toHaveBeenCalled(); expect(f.sign).toHaveBeenCalledOnce(); expectNoNewRegister(f)
})
it('captures call-time payload and attachment parameters before asynchronous verification', async () => {
  const f = await fixture(), expectedPayload = new Uint8Array(f.payload), originalVerify = f.params.verify
  const metadata = f.metadata.getMockImplementation()!; let encodedPayload: Uint8Array | undefined
  f.metadata.mockImplementation(async params => { encodedPayload = new Uint8Array(params.bytes); return metadata(params) })
  f.verify.mockImplementationOnce(async () => {
    f.payload.fill(99)
    f.params.attachment.append = tx => { tx.moveCall({ target: `${uid(7)}::content::changed` }) }
    f.params.certifyGasBudget = 1n
    f.params.verify = async () => { throw Error('replacement verifier must not run') }
  })
  await f.continue()
  expect(originalVerify).toHaveBeenCalledTimes(5)
  expect(encodedPayload).toEqual(expectedPayload)
  const packet = readWalrusSingleRecord(f.key)!.certify!, data = Transaction.from(fromBase64(packet.bytes)).getData()
  expect(data.commands.filter(c => c.MoveCall).map(c => c.MoveCall!.function)).toEqual(['certify_blob', 'append'])
  expect(data.gasData.budget).toBe('50000000'); expectNoNewRegister(f)
})
