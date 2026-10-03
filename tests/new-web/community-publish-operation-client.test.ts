import { afterEach, expect, it, vi } from 'vitest'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { bcs } from '@mysten/sui/bcs'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { profileId as id, profileSigner as signer, profileDigest as digest } from './fixtures/public-profile-operation'
import { buildCreatePublicCommunityPostTx, buildCreatePublicCommunityCommentTx } from '../../packages/soulidity-sdk/src/community-posts-write'
import { publicCommunityPublishCommitment, type PublicCommunityPublishIntent } from '../../packages/soulidity-sdk/src/community-publish-intent'
import { runPublicCommunityPublishOperation, publicCommunityPublishOperationKey, type PublicCommunityPublishOperation } from '../../packages/soulidity-sdk/src/community-publish-operation'
import { createPublicCommunityPublishOperationClient, browserPublicCommunityPublishOperationStore } from '../../web/lib/community/publish-operation-client'
const mocks = vi.hoisted(() => ({ ready: vi.fn() }))
vi.mock('../../web/lib/community/publication-preflight', () => ({ assertCommunityPublicationReady: mocks.ready }))
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); mocks.ready.mockReset() })

async function fixture(kind: 'post' | 'comment' = 'post', maximumDocument = false) {
  const common = { deployment: { profile: { originalPackageId: id(1), callablePackageId: id(2), registryId: id(3),
    chainIdentifier: '01010101' }, registryId: id(100) }, owner: signer.toSuiAddress(), authorId: id(4), operationId: 'a'.repeat(32) }
  const intent: PublicCommunityPublishIntent = kind === 'post'
    ? { ...common, kind, postType: 1, channel: 1, document: { schema: 'soulidity.public-post.v1', title: 'Question', content: 'Body', tags: [] } }
    : { ...common, kind, postId: id(5), document: { schema: 'soulidity.public-comment.v1', content: 'Reply' } }
  if (maximumDocument && intent.document.schema === 'soulidity.public-post.v1') {
    intent.document.tags = ['']
    intent.document.tags = ['x'.repeat(1024 * 1024 - JSON.stringify(intent.document).length)]
  }
  const c = await publicCommunityPublishCommitment(intent)
  const receipt = { schema: 'soulidity.community-upload.v1' as const, intentHash: c.intentHash,
    reference: { blobObjectId: id(7), blobId: 'A'.repeat(43), sha256: c.contentHash, byteLength: String(c.bytes.length) } }
  const mutableId = intent.kind === 'post' ? intent.deployment.registryId : intent.postId
  const resolve = (tx: Transaction) => {
    const data = tx.getData(), result = Transaction.from(JSON.stringify({ ...data, inputs: data.inputs.map(input => input.UnresolvedObject
      ? { Object: { SharedObject: { objectId: input.UnresolvedObject.objectId, initialSharedVersion: '1', mutable: input.UnresolvedObject.objectId === mutableId } } } : input) }))
    result.setGasOwner(intent.owner); result.setGasBudget('10000000'); result.setGasPrice('1000')
    result.setGasPayment([{ objectId: id(60), version: '1', digest }]); return result
  }
  const tx = resolve(intent.kind === 'post'
    ? buildCreatePublicCommunityPostTx({ ...intent, document: receipt.reference, postType: 'question', channel: 'questions' })
    : buildCreatePublicCommunityCommentTx({ ...intent, document: receipt.reference }))
  tx.setExpiration({ Epoch: '10' }); const bytes = await tx.build()
  const record: PublicCommunityPublishOperation = { schema: 'soulidity.community-publish-operation.v1', intent, receipt,
    bytes: toBase64(bytes), digest: TransactionDataBuilder.getDigestFromBytes(bytes), expirationEpoch: '10', phase: 'PREPARED', signature: null }
  const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://not-called.invalid' })
  const chain = vi.spyOn(client.core, 'getChainIdentifier').mockResolvedValue({ chainIdentifier: digest })
  const epoch = vi.spyOn(client.ledgerService, 'getEpoch').mockResolvedValue({ response: { epoch: { epoch: 9n } } } as any)
  const execute = vi.spyOn(client.core, 'executeTransaction').mockResolvedValue({} as any)
  const effects = bcs.TransactionEffects.serialize({ V2: { status: { Success: true }, executedEpoch: '9', gasUsed: { computationCost: '1', storageCost: '0', storageRebate: '0', nonRefundableStorageFee: '0' }, transactionDigest: record.digest,
    gasObjectIndex: null, eventsDigest: null, dependencies: [], lamportVersion: '3', changedObjects: [], unchangedConsensusObjects: [], auxDataDigest: null } }).toBytes()
  const ledger = { digest: record.digest, transaction: { digest: record.digest, bcs: { value: bytes } },
    effects: { transactionDigest: record.digest, bcs: { value: effects }, status: { success: true } }, checkpoint: 0n as bigint | undefined }
  const query = vi.spyOn(client.ledgerService, 'getTransaction').mockResolvedValue({ response: { transaction: ledger } } as any)
  const original = Transaction.prototype.build
  vi.spyOn(Transaction.prototype, 'build').mockImplementation(async function(this: Transaction, options) {
    return options?.client === client ? original.call(resolve(this)) : original.call(this, options)
  })
  mocks.ready.mockResolvedValue(undefined)
  let enabled = true, address: string | null = intent.owner
  const sign = vi.fn(async (transaction: Transaction) => signer.signTransaction(await transaction.build()))
  const config = { deployment: intent.deployment, storage: { chainIdentifier: '01010101', blobType: `${id(22)}::blob::Blob`, aggregatorUrl: 'https://not-called.invalid' } }
  const real = createPublicCommunityPublishOperationClient({ client, config, writesEnabled: () => enabled, getAddress: () => address, sign })
  return { intent, receipt, record, client, real, sign, query, ledger, epoch, execute, config, chain,
    disable: () => { enabled = false; address = null }, disconnect: () => { address = null } }
}
// Only the separately tested publication preflight is mocked. Transactions,
// commitment hashes, signatures and effects use actual SDK encodings.
it.each(['post', 'comment'] as const)('prepares exact %s bytes after certified publication preflight', async kind => {
  const f = await fixture(kind)
  expect(await f.real.prepare(f.intent, f.receipt)).toEqual(f.record)
  expect(mocks.ready).toHaveBeenCalledWith(expect.objectContaining({ client: f.client, config: f.config, intent: f.intent, receipt: f.receipt }))
  expect(f.sign).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled()
})
it.each([true, false])('rechecks actual publication authority for signing=%s', async signing => {
  const f = await fixture()
  mocks.ready.mockRejectedValueOnce(new Error('certified content expired'))
  await expect(f.real.adapter.preflight(f.record, signing)).rejects.toThrow('certified content expired')
  expect(f.sign).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled()
})
it('queries saved chain evidence with no wallet, writes, storage or certified document availability', async () => {
  const f = await fixture(); f.disable(); mocks.ready.mockRejectedValue(new Error('storage offline'))
  expect(await f.real.adapter.query(f.record)).toBe('SUCCEEDED')
  expect(mocks.ready).not.toHaveBeenCalled()
  await expect(f.real.prepare(f.intent, f.receipt)).rejects.toThrow('WRITES_DISABLED')
})
it.each(['bytes', 'digest', 'status', 'checkpoint', 'effects', 'effectsDigest'])('rejects substituted query %s', async field => {
  const f = await fixture()
  if (field === 'bytes') f.ledger.transaction.bcs.value = new Uint8Array([0])
  if (field === 'digest') f.ledger.digest = digest
  if (field === 'status') f.ledger.effects.status.success = false
  if (field === 'checkpoint') f.ledger.checkpoint = -1n
  if (field === 'effects') f.ledger.effects.bcs.value = new Uint8Array([...f.ledger.effects.bcs.value, 0])
  if (field === 'effectsDigest') f.ledger.effects.transactionDigest = digest
  await expect(f.real.adapter.query(f.record)).rejects.toThrow()
})
it('distinguishes missing, pending and unavailable evidence', async () => {
  const f = await fixture(); f.ledger.checkpoint = undefined
  expect(await f.real.adapter.query(f.record)).toBe('PENDING')
  f.query.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'NOT_FOUND' }))
  expect(await f.real.adapter.query(f.record)).toBe('MISSING')
  f.query.mockRejectedValueOnce(new Error('NOT_FOUND'))
  await expect(f.real.adapter.query(f.record)).rejects.toThrow('NOT_FOUND')
})
it('rejects changed release, wrong chain, disconnected owner and expired PTB', async () => {
  const f = await fixture()
  await expect(f.real.adapter.query({ ...f.record, intent: { ...f.intent, deployment: { ...f.intent.deployment, registryId: id(99) } } })).rejects.toThrow()
  f.chain.mockResolvedValueOnce({ chainIdentifier: toBase64(new Uint8Array(32)) })
  await expect(f.real.adapter.query(f.record)).rejects.toThrow()
  f.epoch.mockResolvedValue({ response: { epoch: { epoch: 11n } } } as any)
  await expect(f.real.adapter.preflight(f.record, false)).rejects.toThrow('EXPIRED_QUERY_ONLY')
  f.disconnect(); await expect(f.real.adapter.sign(f.record)).rejects.toThrow('RECONNECT_PREPARING_WALLET')
})
it('verifies owner signatures and sends only saved exact bytes', async () => {
  const f = await fixture(), signed = { ...f.record, phase: 'SIGNED' as const, signature: (await signer.signTransaction(fromBase64(f.record.bytes))).signature }
  await f.real.adapter.verifySignature(signed); await f.real.adapter.broadcast(signed)
  expect(f.execute).toHaveBeenCalledWith({ transaction: fromBase64(signed.bytes), signatures: [signed.signature] })
  const foreign = await Ed25519Keypair.generate().signTransaction(fromBase64(f.record.bytes))
  await expect(f.real.adapter.verifySignature({ ...signed, signature: foreign.signature })).rejects.toThrow()
})
it('recovers an uncertain send by saved digest without another prompt or send', async () => {
  const f = await fixture(); let saved: PublicCommunityPublishOperation | null = null, submitted = false
  f.query.mockImplementation(async () => {
    if (!submitted) throw Object.assign(new Error('missing'), { code: 'NOT_FOUND' })
    return { response: { transaction: f.ledger } } as any
  })
  f.execute.mockImplementation(async () => { submitted = true; throw new Error('connection lost after submit') })
  const store = { exclusive: async (_key: string, work: () => Promise<any>) => work(), read: () => structuredClone(saved),
    write: (_key: string, record: PublicCommunityPublishOperation) => { saved = structuredClone(record) } }
  await expect(runPublicCommunityPublishOperation({ intent: f.intent, prepared: f.record, store, adapter: f.real.adapter })).rejects.toThrow('connection lost')
  expect(saved!.phase).toBe('SIGNED'); expect(mocks.ready).toHaveBeenCalledTimes(2)
  f.disable()
  expect((await runPublicCommunityPublishOperation({ intent: f.intent, store, adapter: f.real.adapter, queryOnly: true })).phase).toBe('SUCCEEDED')
  expect(f.sign).toHaveBeenCalledTimes(1); expect(f.execute).toHaveBeenCalledTimes(1)
})
it('bounds hanging chain calls without starting a wallet operation', async () => {
  const f = await fixture(); vi.useFakeTimers()
  f.chain.mockImplementation(() => new Promise(() => {}))
  // Native AbortSignal.timeout uses real clocks; inject its deadline into fake timers.
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
    const controller = new AbortController(); setTimeout(() => controller.abort(new Error('timeout')), ms); return controller.signal
  })
  const pending = expect(f.real.prepare(f.intent, f.receipt)).rejects.toThrow()
  await vi.waitFor(() => expect(f.chain).toHaveBeenCalled())
  await vi.advanceTimersByTimeAsync(16000); await pending
  expect(f.sign).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled()
})
it.each(['sign', 'broadcast'] as const)('bounds a hanging %s without changing saved bytes', async action => {
  const f = await fixture(), signed = { ...f.record, phase: 'SIGNED' as const,
    signature: (await signer.signTransaction(fromBase64(f.record.bytes))).signature }
  vi.useFakeTimers()
  const called = action === 'sign' ? f.sign : f.execute
  called.mockImplementation(() => new Promise(() => {}))
  const saved = structuredClone(action === 'sign' ? f.record : signed)
  const pending = expect(f.real.adapter[action](saved)).rejects.toThrow('TIMEOUT_QUERY_SAVED_TRANSACTION')
  await vi.waitFor(() => expect(called).toHaveBeenCalledTimes(1))
  await vi.advanceTimersByTimeAsync(action === 'sign' ? 120001 : 30001); await pending
  expect(saved).toEqual(action === 'sign' ? f.record : signed)
})
it('screens store records synchronously, verifies durable writes and respects cross-tab locks', async () => {
  const f = await fixture(), rows = new Map<string, string>()
  const setItem = vi.fn((key: string, value: string) => { rows.set(key, value) })
  vi.stubGlobal('window', { localStorage: { getItem: (key: string) => rows.get(key) ?? null, setItem } })
  const request = vi.fn(async (_key: string, _options: any, work: any) => work({ name: 'lock' }))
  vi.stubGlobal('navigator', { locks: { request } })
  const store = browserPublicCommunityPublishOperationStore(), key = publicCommunityPublishOperationKey(f.intent)
  await store.exclusive(key, async () => { store.write(key, f.record) })
  expect(store.read(key)).toEqual(f.record)
  expect(() => store.write(key + 'wrong', f.record)).toThrow('SCOPE_MISMATCH')
  request.mockImplementation(async (_key, _options, work) => work(null))
  await expect(store.exclusive(key, async () => undefined)).rejects.toThrow('BUSY_IN_ANOTHER_TAB')
  setItem.mockImplementation(() => {})
  expect(() => store.write(key, { ...f.record, phase: 'SIGNING' })).toThrow('PERSISTENCE_FAILED')
  rows.set(key, ' '.repeat(2 * 1024 * 1024 + 131073)); expect(() => store.read(key)).toThrow('RECORD_TOO_LARGE')
})
it('does not authorize tampered receipts merely because synchronous storage accepted their shape', async () => {
  const f = await fixture(), altered = { ...f.record, receipt: { ...f.receipt, intentHash: '0'.repeat(64) } }
  const key = publicCommunityPublishOperationKey(f.intent), rows = new Map<string, string>()
  vi.stubGlobal('window', { localStorage: { getItem: (k: string) => rows.get(k) ?? null, setItem: (k: string, v: string) => rows.set(k, v) } })
  vi.stubGlobal('navigator', { locks: { request: async (_key: string, _options: unknown, work: any) => work({}) } })
  const store = browserPublicCommunityPublishOperationStore(); store.write(key, altered)
  await expect(runPublicCommunityPublishOperation({ intent: f.intent, store, adapter: f.real.adapter, queryOnly: true })).rejects.toThrow('RECEIPT_SCOPE_MISMATCH')
  expect(f.query).not.toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled()
})
it('persists a valid maximum 1 MiB document together with PTB and signature envelope', async () => {
  const f = await fixture('post', true), rows = new Map<string, string>()
  vi.stubGlobal('window', { localStorage: { getItem: (k: string) => rows.get(k) ?? null, setItem: (k: string, v: string) => rows.set(k, v) } })
  vi.stubGlobal('navigator', { locks: { request: async (_key: string, _options: unknown, work: any) => work({}) } })
  const prepared = await f.real.prepare(f.intent, f.receipt)
  expect(new TextEncoder().encode(JSON.stringify(prepared.intent.document))).toHaveLength(1024 * 1024)
  const signed = { ...prepared, phase: 'SIGNED' as const, signature: (await signer.signTransaction(fromBase64(prepared.bytes))).signature }
  const store = browserPublicCommunityPublishOperationStore(), key = publicCommunityPublishOperationKey(f.intent)
  store.write(key, signed); expect(store.read(key)).toEqual(signed)
  expect((await runPublicCommunityPublishOperation({ intent: f.intent, store, adapter: f.real.adapter, queryOnly: true })).phase).toBe('SUCCEEDED')
})
