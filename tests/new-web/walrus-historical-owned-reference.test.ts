import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { Inputs, Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase64, toBase58, toBase64 } from '@mysten/sui/utils'
import { contentAppendAttachment } from '../../web/lib/soulidity/content-append-operation'
import { readWalrusSingleRecord, type WalrusSingleAttachment } from '../../web/lib/upload/walrus-single-operation'
import { inspectWalrusRegisteredBlobForRebase, queryDurableWalrusBlobRecord } from '../../web/lib/upload/walrus-single-upload'
import { contentAppendOperationFixture } from './fixtures/content-append-operation'
import { singleUploadFixture, uid } from './fixtures/walrus-single-upload'

// Real pinned Walrus + Soulidity SDK command graphs, canonical TransactionData/
// effects/Blob BCS and local signatures. The resolver below models owned refs,
// shared roles and Receiving inference; it is NOT live RPC or a Move VM.
const referenceDigest = toBase58(new Uint8Array(32).fill(5))
let store: Map<string, string>
beforeEach(() => {
  store = new Map()
  vi.stubGlobal('window', { localStorage: { getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value) } })
  vi.stubGlobal('navigator', { locks: { request: async (_key: string, _opts: unknown, run: (lock: object) => unknown) => run({}) } })
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('No live network') }))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })

async function fixture(mode: 'completed' | 'failed' | 'expired' = 'completed') {
  const content = await contentAppendOperationFixture({ grantee: true, intent: { uploadConfig: {
    network: 'mainnet', relayUrl: 'https://relay.example.com', wasmUrl: '/walrus/walrus_wasm@0.0.2.wasm', storageEpochs: 3 } } })
  const attachment = contentAppendAttachment(content.record), grantId = content.intent.grantId!
  const f = await singleUploadFixture(attachment, false, { signer: content.crypto.signer, payload: content.record.ciphertext,
    contentHash: content.record.contentHash, operationScope: attachment.scope, relayUrl: content.intent.uploadConfig.relayUrl })
  vi.spyOn(f.walrus, 'getBlobType').mockReturnValue(`${uid(3)}::blob::Blob`)
  let missingGrant = false, grantVersion = '7', receivingGrant = false, sharedVersion = '1', completed = false, changedMutability = false
  const resolutions: { objectId: string; supplied: boolean }[] = []
  // Honor explicit version/digest on UnresolvedObject exactly where the real
  // resolver skips lookup. Object variants come from fixture ABI roles, not the
  // candidate packet. Shared IDs always retain independently observed refs.
  f.client.core.resolveTransactionPlugin = () => async (data: any, _options: unknown, next: () => Promise<void>) => {
    data.inputs = data.inputs.map((input: any) => {
      if (!input.UnresolvedObject) return input
      const unresolved = input.UnresolvedObject, objectId = unresolved.objectId
      const supplied = unresolved.version !== undefined && unresolved.digest !== undefined
      resolutions.push({ objectId, supplied })
      if (objectId === grantId || objectId === f.blobObjectId) {
        if (objectId === grantId && missingGrant && !supplied) throw Error('fixture-grant-not-found')
        const ref = { objectId, version: unresolved.version ?? (objectId === grantId ? grantVersion : completed ? '3' : '2'),
          digest: unresolved.digest ?? referenceDigest }
        return objectId === grantId && receivingGrant ? Inputs.ReceivingRef(ref) : Inputs.ObjectRef(ref)
      }
      const mutable = objectId === content.intent.stateId && changedMutability ? false : objectId !== content.intent.kindRegistryId && objectId !== uid(6)
      return Inputs.SharedObjectRef({ objectId, initialSharedVersion: sharedVersion, mutable })
    })
    data.gasData = { owner: f.intent.owner, budget: data.gasData.budget ?? '50000000', price: '1000',
      payment: [{ objectId: uid(90), version: '1', digest: referenceDigest }] }
    await next()
  }
  const execute = f.client.core.executeTransaction.getMockImplementation()!
  if (mode !== 'completed') f.client.core.executeTransaction.mockImplementation(async args => {
    if (!Transaction.from(args.transaction).getData().commands.some(c => c.MoveCall?.function === 'register_blob')) throw Error('fixture-stop-certify')
    return execute(args)
  })
  if (mode === 'completed') { await f.run(); completed = true }
  else await expect(f.run()).rejects.toThrow('fixture-stop-certify')
  const record = readWalrusSingleRecord(f.key)!
  const objectImpl = f.client.core.getObject.getMockImplementation()!
  f.client.core.getObject.mockImplementation(async args => {
    const { object } = await objectImpl(args)
    return { object: { ...object, version: completed ? '3' : '2', digest: referenceDigest,
      owner: { $kind: 'AddressOwner', ...object.owner } } }
  })
  const queryImpl = f.client.ledgerService.getTransaction.getMockImplementation()!
  if (mode === 'failed') f.client.ledgerService.getTransaction.mockImplementation(async args => {
    if (args.digest !== record.certify!.digest) return queryImpl(args)
    const packet = record.certify!, source = bcs.TransactionEffects.parse(f.records.get(record.register!.digest)!.effects).V2!
    const effects = bcs.TransactionEffects.serialize({ V2: { ...source, transactionDigest: packet.digest, changedObjects: [],
      status: { Failure: { error: { InsufficientGas: true }, command: 0 } } } }).toBytes()
    return { response: { transaction: { digest: packet.digest, transaction: { digest: packet.digest, bcs: { value: fromBase64(packet.bytes) } },
      effects: { status: { success: false }, bcs: { value: effects } }, checkpoint: 1n } } }
  })
  if (mode === 'expired') f.client.ledgerService.getEpoch.mockResolvedValue({ response: { epoch: { epoch: BigInt(record.certify!.expirationEpoch) + 1n } } })
  const readonly = { client: f.execution.client, getAddress: vi.fn(() => { throw Error('readonly cannot ask wallet') }),
    sign: vi.fn(async () => { throw Error('readonly cannot sign') }), beforeWrite: vi.fn(async () => { throw Error('readonly cannot preflight write') }) }
  const query = (selected: WalrusSingleAttachment = attachment) => queryDurableWalrusBlobRecord({ record,
    operationScope: attachment.scope, attachment: selected, execution: readonly, createClient: f.createClient })
  const inspect = (selected: WalrusSingleAttachment = attachment) => inspectWalrusRegisteredBlobForRebase({ record,
    operationScope: attachment.scope, attachment: selected, execution: readonly, createClient: f.createClient })
  const old = Transaction.from(fromBase64(record.certify!.bytes)).getData()
  const sdk = old.commands.find(c => c.MoveCall?.function === 'certify_blob')!.MoveCall!
  const sdkSelf = old.inputs[sdk.arguments[0].Input!].Object!.SharedObject!.objectId
  async function changeInput(objectId: string, variant: 'owned' | 'receiving') {
    const data = TransactionDataBuilder.fromBytes(fromBase64(record.certify!.bytes))
    data.inputs = data.inputs.map(input => {
      const actual = input.Object?.SharedObject?.objectId ?? input.Object?.ImmOrOwnedObject?.objectId
      if (actual !== objectId) return input
      const ref = { objectId, version: '7', digest: referenceDigest }
      return variant === 'owned' ? Inputs.ObjectRef(ref) : Inputs.ReceivingRef(ref)
    })
    const bytes = data.build(), signed = await content.crypto.signer.signTransaction(bytes)
    record.certify = { ...record.certify!, bytes: toBase64(bytes), digest: TransactionDataBuilder.getDigestFromBytes(bytes), signature: signed.signature }
  }
  f.sign.mockClear(); f.approve.mockClear(); f.write.mockClear(); f.client.core.executeTransaction.mockClear(); resolutions.length = 0
  return { ...f, content, attachment, grantId, record, readonly, query, inspect, resolutions, sdkSelf, changeInput,
    missing: () => { missingGrant = true }, receiving: () => { receivingGrant = true },
    newGrantVersion: () => { grantVersion = '8' }, changedSharedVersion: () => { sharedVersion = '2' },
    changedSharedMutability: () => { changedMutability = true } }
}

it('queries the real certify+grantee append graph after old Grant deletion without local WAL or wallet use', async () => {
  const f = await fixture(); f.missing()
  vi.stubGlobal('window', undefined); vi.stubGlobal('navigator', undefined)
  const result = await f.query()
  expect(result.status).toBe('CERTIFIED')
  expect(f.resolutions.some(row => row.objectId === f.grantId && row.supplied)).toBe(true)
  const commands = Transaction.from(fromBase64(f.record.certify!.bytes)).getData().commands
  expect(commands.some(c => c.MoveCall?.function === 'certify_blob')).toBe(true)
  expect(commands.some(c => c.MoveCall?.function === 'append_version_as_granted_agent')).toBe(true)
  for (const mock of [f.readonly.sign, f.readonly.getAddress, f.readonly.beforeWrite, f.sign, f.approve, f.write, f.client.core.executeTransaction]) expect(mock).not.toHaveBeenCalled()
})
it.each(['failed', 'expired'] as const)('inspects a %s old packet after Grant deletion without signing or changing its WAL', async mode => {
  const f = await fixture(mode), saved = [...store.entries()]; f.missing()
  const result = await f.inspect()
  expect(result.status).toBe('REBASE_AVAILABLE')
  if (result.status === 'REBASE_AVAILABLE') expect(result.retirement.kind).toBe(mode.toUpperCase())
  expect([...store.entries()]).toEqual(saved)
  expect(f.resolutions.some(row => row.objectId === f.grantId && row.supplied)).toBe(true)
  for (const mock of [f.readonly.sign, f.readonly.getAddress, f.readonly.beforeWrite, f.sign, f.approve, f.write, f.client.core.executeTransaction]) expect(mock).not.toHaveBeenCalled()
})
it('does not revive a deleted Grant that is absent from the trusted historical allowlist', async () => {
  const f = await fixture(); f.missing()
  await expect(f.query({ ...f.attachment, historicalOwnedObjectIds: [] })).rejects.toThrow('fixture-grant-not-found')
})
it.each(['State', 'Content', 'Registry', 'Clock', 'Walrus system'])(
  'rejects candidate shared-as-owned %s even when expired and never executed', async role => {
    const f = await fixture('expired'), ids: Record<string, string> = { State: f.content.intent.stateId,
      Content: f.content.scope.contentObjectId, Registry: f.content.intent.kindRegistryId, Clock: uid(6), 'Walrus system': f.sdkSelf }
    await f.changeInput(ids[role], 'owned'); f.missing()
    await expect(f.inspect()).rejects.toThrow('WALRUS_CERTIFY_ATTACHMENT_TEMPLATE_MISMATCH')
    expect(f.resolutions.filter(row => row.objectId === ids[role]).every(row => !row.supplied)).toBe(true)
  })
it.each(['State', 'Content', 'Registry', 'Market', 'Soul', 'Clock'])(
  'rejects content Grant role alias with %s before building a transaction', async role => {
    const f = await fixture(), record = structuredClone(f.content.record), intent = JSON.parse(record.scope.intentJson)
    const ids: Record<string, string> = { State: intent.stateId, Content: record.scope.contentObjectId,
      Registry: intent.kindRegistryId, Market: intent.marketConfigId, Soul: intent.soulId, Clock: uid(6) }
    intent.grantId = ids[role]; record.scope.intentJson = JSON.stringify(intent)
    expect(() => contentAppendAttachment(record)).toThrow('GRANT_OBJECT_ROLE_ALIAS')
  })
it('rejects Grant/Blob alias at the attachment boundary', async () => {
  const f = await fixture()
  expect(() => f.attachment.append(new Transaction(), f.grantId)).toThrow('GRANT_BLOB_ROLE_ALIAS')
})
it.each(['system', 'Blob'] as const)('rejects historical allowlist alias with real expanded Walrus SDK %s parameter', async role => {
  const f = await fixture('expired')
  await expect(f.inspect({ ...f.attachment, historicalOwnedObjectIds: [role === 'system' ? f.sdkSelf : f.blobObjectId] }))
    .rejects.toThrow('WALRUS_HISTORICAL_OWNED_ROLE_ALIAS')
})
it.each([true, false])('does not inherit candidate Receiving tag (Grant deleted=%s)', async deleted => {
  const f = await fixture('expired'); await f.changeInput(f.grantId, 'receiving')
  if (deleted) f.missing()
  await expect(f.inspect()).rejects.toThrow(deleted ? 'fixture-grant-not-found' : 'WALRUS_CERTIFY_ATTACHMENT_TEMPLATE_MISMATCH')
})
it('retains resolver-derived Receiving classification rather than forcing historical owned tag', async () => {
  const f = await fixture('expired'); f.receiving(); f.missing()
  await expect(f.inspect()).rejects.toThrow('WALRUS_CERTIFY_ATTACHMENT_TEMPLATE_MISMATCH')
})
it.each(['version', 'mutability'])('does not ignore current shared %s drift', async field => {
  const f = await fixture('expired'); f.missing()
  if (field === 'version') f.changedSharedVersion(); else f.changedSharedMutability()
  await expect(f.inspect()).rejects.toThrow('WALRUS_CERTIFY_ATTACHMENT_TEMPLATE_MISMATCH')
})
it.each(['query', 'inspect'] as const)('captures the historical allowlist before asynchronous %s work', async action => {
  const f = await fixture(action === 'query' ? 'completed' : 'expired'); f.missing()
  const ids = [f.grantId], selected = { ...f.attachment, historicalOwnedObjectIds: ids }
  const pending = f[action](selected)
  ids.splice(0, 1, f.sdkSelf)
  const result = await pending
  expect(result.status).toBe(action === 'query' ? 'CERTIFIED' : 'REBASE_AVAILABLE')
})
it('does not gain an allowed historical Grant from a late caller array mutation', async () => {
  const f = await fixture(); f.missing(); const ids: string[] = []
  const pending = f.query({ ...f.attachment, historicalOwnedObjectIds: ids }); ids.push(f.grantId)
  await expect(pending).rejects.toThrow('fixture-grant-not-found')
})
it.each(['deleted', 'newVersion'] as const)('write replay still resolves current Grant and rejects %s without signing or broadcasting', async mode => {
  const f = await fixture('expired')
  f.client.ledgerService.getEpoch.mockResolvedValue({ response: { epoch: { epoch: BigInt(f.record.certify!.expirationEpoch) } } })
  if (mode === 'deleted') f.missing(); else f.newGrantVersion()
  await expect(f.run()).rejects.toThrow(mode === 'deleted' ? 'fixture-grant-not-found' : 'WALRUS_RECOVERY_SDK_TEMPLATE_CHANGED_QUERY_ONLY')
  expect(f.resolutions.some(row => row.objectId === f.grantId && !row.supplied)).toBe(true)
  expect(f.sign).not.toHaveBeenCalled(); expect(f.client.core.executeTransaction).not.toHaveBeenCalled(); expect(f.approve).not.toHaveBeenCalled()
  expect(readWalrusSingleRecord(f.key)!.register!.bytes).toBe(f.record.register!.bytes)
})
