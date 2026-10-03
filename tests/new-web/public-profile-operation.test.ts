import { expect, it, vi } from 'vitest'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase64, toBase58, toBase64 } from '@mysten/sui/utils'
import { verifyTransactionSignature } from '@mysten/sui/verify'
import { bcs } from '@mysten/sui/bcs'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { createPublicProfileOperationClient } from '../../web/lib/profile/profile-operation-client'
import { publicWalletProfileMetadataHash } from '../../packages/soulidity-sdk/src/public-profile-metadata'
import { publicProfileOperationFixture, profileId as id, profileSigner as signer, profileDigest as digest } from './fixtures/public-profile-operation'
import { runPublicProfileOperation, validatePublicProfileOperation, type PublicProfileOperation,
  type PublicProfileOperationAdapter, type PublicProfileOperationStore } from '../../packages/soulidity-sdk/src/public-profile-operation'

async function fixture(create = false) {
  const { intent, receipt, record, tx } = await publicProfileOperationFixture(create)
  let saved: PublicProfileOperation | null = null, locked = false, submitted = false
  const events: string[] = []
  const store: PublicProfileOperationStore = {
    exclusive: async (_key, run) => { if (locked) throw new Error('busy'); locked = true; try { return await run() } finally { locked = false } },
    read: () => structuredClone(saved), write: (_key, value) => { saved = structuredClone(value); events.push(`persist:${value.phase}`) },
  }
  const adapter: PublicProfileOperationAdapter = {
    query: vi.fn(async () => { events.push('query'); return submitted ? 'SUCCEEDED' : 'MISSING' }),
    preflight: vi.fn(async () => { events.push('preflight') }),
    sign: vi.fn(async r => { events.push('sign'); return signer.signTransaction(fromBase64(r.bytes)) }),
    verifySignature: vi.fn(async r => { await verifyTransactionSignature(fromBase64(r.bytes), r.signature!, { address: r.intent.owner }) }),
    broadcast: vi.fn(async () => { events.push('broadcast'); submitted = true }),
  }
  const run = (prepared = false, options = {}) => runPublicProfileOperation({ intent, store, adapter, ...(prepared ? { prepared: record } : {}), ...options })
  return { intent, receipt, record, tx, store, adapter, events, run, saved: () => saved }
}
it.each([true, false])('validates exact actual profile transaction bytes, create=%s', async create => {
  const f = await fixture(create)
  expect(await validatePublicProfileOperation(f.record)).toEqual(f.record)
})
it('durably persists prepared bytes and real verified signature before broadcast', async () => {
  const f = await fixture()
  expect((await f.run(true)).phase).toBe('SUCCEEDED')
  expect(f.events).toEqual(['persist:PREPARED', 'query', 'preflight', 'persist:SIGNING', 'sign', 'persist:SIGNED', 'preflight', 'broadcast', 'query', 'persist:SUCCEEDED'])
})
it('stops before signing if prepared persistence fails', async () => {
  const f = await fixture(); f.store.write = () => { throw new Error('quota') }
  await expect(f.run(true)).rejects.toThrow('quota')
  expect(f.adapter.sign).not.toHaveBeenCalled()
})
it('stops before broadcast if signed persistence fails; resumes original bytes', async () => {
  const f = await fixture(), write = f.store.write
  f.store.write = (key, r) => { if (r.phase === 'SIGNED') throw new Error('quota'); write(key, r) }
  await expect(f.run(true)).rejects.toThrow('quota')
  expect(f.adapter.broadcast).not.toHaveBeenCalled()
  expect(f.saved()?.phase).toBe('SIGNING')
  f.store.write = write
  expect((await f.run()).phase).toBe('SUCCEEDED')
  expect(f.saved()?.bytes).toBe(f.record.bytes)
})
it('queries first after unknown broadcast, never rebuilding or signing new bytes', async () => {
  const f = await fixture()
  vi.mocked(f.adapter.broadcast).mockRejectedValueOnce(new Error('timeout'))
  await expect(f.run(true)).rejects.toThrow('timeout')
  expect(f.saved()?.phase).toBe('SIGNED')
  await expect(f.run(true)).rejects.toThrow('PROFILE_OPERATION_RECOVERY_REQUIRED')
  f.events.length = 0
  expect((await f.run()).phase).toBe('SUCCEEDED')
  expect(f.events[0]).toBe('query'); expect(f.adapter.sign).toHaveBeenCalledOnce()
  expect(f.saved()?.bytes).toBe(f.record.bytes)
})
it.each(['offline', 'pending', 'query-only'])('does not sign/broadcast while %s', async condition => {
  const f = await fixture()
  if (condition === 'offline') vi.mocked(f.adapter.query).mockRejectedValueOnce(new Error('offline'))
  if (condition === 'pending') vi.mocked(f.adapter.query).mockResolvedValue('PENDING')
  if (condition === 'query-only') { f.store.write('x', f.record); await f.run(false, { queryOnly: true }) }
  else if (condition === 'offline') await expect(f.run(true)).rejects.toThrow('offline')
  else await f.run(true)
  expect(f.adapter.sign).not.toHaveBeenCalled(); expect(f.adapter.broadcast).not.toHaveBeenCalled()
})
it('rejects wallet-modified bytes and wrong signature before broadcast', async () => {
  const f = await fixture()
  vi.mocked(f.adapter.sign).mockResolvedValueOnce({ bytes: 'AAAA', signature: 'bad' })
  await expect(f.run(true)).rejects.toThrow('PROFILE_OPERATION_WALLET_CHANGED_BYTES')
  vi.mocked(f.adapter.sign).mockResolvedValueOnce({ bytes: f.record.bytes, signature: 'bad' })
  await expect(f.run()).rejects.toThrow()
  expect(f.adapter.broadcast).not.toHaveBeenCalled()
})
it('allows cancellation after explicit rejection, but never after unknown signing', async () => {
  const f = await fixture()
  const reject = Object.assign(new Error('rejected'), { name: 'WalletStandardError', context: { __code: 4001000 } })
  vi.mocked(f.adapter.sign).mockRejectedValueOnce(reject)
  await expect(f.run(true)).rejects.toThrow('rejected')
  expect((await f.run(false, { cancelUnsigned: true })).phase).toBe('CANCELLED')
  vi.mocked(f.adapter.sign).mockRejectedValueOnce(new Error('unknown'))
  await expect(f.run(true)).rejects.toThrow('unknown')
  await expect(f.run(false, { cancelUnsigned: true })).rejects.toThrow('PROFILE_OPERATION_CANNOT_DISCARD_SIGNED')
})
it('rejects forged terminal state and cross-wallet recovery', async () => {
  const f = await fixture()
  f.store.write('x', { ...f.record, phase: 'SUCCEEDED' })
  await expect(f.run()).rejects.toThrow('PROFILE_OPERATION_RESULT_UNCONFIRMED')
  await expect(runPublicProfileOperation({ intent: { ...f.intent, owner: id(999) }, store: f.store, adapter: f.adapter })).rejects.toThrow('PROFILE_OPERATION_SCOPE_MISMATCH')
})
it.each(['target', 'handle', 'extra-call', 'gas-owner', 'expiration', 'clock-mutable', 'shared-profile', 'trailing-bytes'])('rejects rehashed transaction mutation %s', async mutation => {
  const f = await fixture(), data = f.tx.getData()
  if (mutation === 'trailing-bytes') {
    const bytes = new Uint8Array([...fromBase64(f.record.bytes), 0])
    f.record.bytes = toBase64(bytes); f.record.digest = TransactionDataBuilder.getDigestFromBytes(bytes)
  } else {
    if (mutation === 'target') data.commands[0].MoveCall!.package = id(999)
    if (mutation === 'handle') f.record.intent.handle = 'changed'
    if (mutation === 'extra-call') data.commands.push(data.commands[0])
    if (mutation === 'gas-owner') data.gasData.owner = id(999)
    if (mutation === 'expiration') data.expiration = { Epoch: '11', $kind: 'Epoch' }
    if (mutation === 'clock-mutable') data.inputs.find(i => i.Object?.SharedObject?.objectId === id(6))!.Object!.SharedObject!.mutable = true
    if (mutation === 'shared-profile') {
      const entry = data.inputs.find(i => i.Object?.ImmOrOwnedObject?.objectId === id(4))!
      entry.Object = { SharedObject: { objectId: id(4), initialSharedVersion: '1', mutable: true }, $kind: 'SharedObject' }
    }
    const bytes = await Transaction.from(JSON.stringify(data)).build()
    f.record.bytes = toBase64(bytes); f.record.digest = TransactionDataBuilder.getDigestFromBytes(bytes)
  }
  await expect(validatePublicProfileOperation(f.record)).rejects.toThrow()
})
it.each(['intent-hash', 'metadata', 'metadata-rehashed'])('rejects altered recovery form commitment %s', async mutation => {
  const f = await fixture()
  if (mutation === 'intent-hash') f.record.receipt.intentHash = '99'.repeat(32)
  else f.record.intent.metadata.displayName = 'Different displayed intent'
  if (mutation === 'metadata-rehashed') f.record.receipt.intentHash = await publicWalletProfileMetadataHash(new TextEncoder().encode(JSON.stringify(f.record.intent)))
  await expect(validatePublicProfileOperation(f.record)).rejects.toThrow(/PROFILE_OPERATION_(INTENT|METADATA)_HASH_MISMATCH/)
  await expect(f.run(true)).rejects.toThrow()
  expect(f.adapter.sign).not.toHaveBeenCalled(); expect(f.adapter.query).not.toHaveBeenCalled()
})

async function clientFixture() {
  const f = await fixture(), client = new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://unused.invalid' })
  const chain = vi.spyOn(client.core, 'getChainIdentifier').mockResolvedValue({ chainIdentifier: digest })
  const epoch = vi.spyOn(client.ledgerService, 'getEpoch').mockImplementation(async () => ({ response: { epoch: { epoch: 9n } } }) as never)
  const effects = (success = true) => bcs.TransactionEffects.serialize({ V2: {
    status: success ? { Success: true } : { Failure: { error: { InsufficientGas: true }, command: 0 } },
    executedEpoch: '9', gasUsed: { computationCost: '1', storageCost: '0', storageRebate: '0', nonRefundableStorageFee: '0' },
    transactionDigest: f.record.digest, gasObjectIndex: null, eventsDigest: null, dependencies: [], lamportVersion: '3',
    changedObjects: [], unchangedConsensusObjects: [], auxDataDigest: null,
  } }).toBytes()
  const ledger = { digest: f.record.digest, transaction: { digest: f.record.digest, bcs: { value: fromBase64(f.record.bytes) } },
    effects: { transactionDigest: f.record.digest, bcs: { value: effects() }, status: { success: true } }, checkpoint: 0n as bigint | undefined }
  const query = vi.spyOn(client.ledgerService, 'getTransaction').mockImplementation(async () => ({ response: { transaction: ledger } }) as never)
  const broadcast = vi.spyOn(client.core, 'executeTransaction').mockResolvedValue({} as never)
  let enabled = true, address: string | null = f.intent.owner
  const sign = vi.fn(async (tx: Transaction) => signer.signTransaction(await tx.build()))
  const real = createPublicProfileOperationClient({ client, deployment: f.intent.deployment,
    storage: { blobType: `${id(80)}::blob::Blob`, aggregatorUrl: 'https://storage.example.com' },
    writesEnabled: () => enabled, getAddress: () => address, sign })
  const prepare = () => real.prepare({ status: 'prepared', intent: f.intent, receipt: f.receipt, transaction: f.tx })
  return { ...f, real, client, chain, epoch, ledger, query, effects, broadcast, sign, prepare,
    setEnabled: (value: boolean) => { enabled = value }, setAddress: (value: string | null) => { address = value } }
}
it('builds a real SDK operation with explicit epoch and does not sign during preparation', async () => {
  const f = await clientFixture()
  expect(await f.prepare()).toEqual(f.record)
  expect(f.sign).not.toHaveBeenCalled(); expect(f.broadcast).not.toHaveBeenCalled()
})
it('queries exact raw transaction/effects/checkpoint and distinguishes pending/failure', async () => {
  const f = await clientFixture()
  expect(await f.real.adapter.query(f.record)).toBe('SUCCEEDED')
  f.ledger.checkpoint = undefined
  expect(await f.real.adapter.query(f.record)).toBe('PENDING')
  f.ledger.checkpoint = 0n; f.ledger.effects.bcs.value = f.effects(false); f.ledger.effects.status.success = false
  expect(await f.real.adapter.query(f.record)).toBe('FAILED')
})
it.each(['transaction-bytes', 'effect-trailing-bytes', 'effect-digest', 'status', 'checkpoint'])('rejects raw ledger %s substitution', async mutation => {
  const f = await clientFixture()
  if (mutation === 'transaction-bytes') f.ledger.transaction.bcs.value = new Uint8Array([0])
  if (mutation === 'effect-trailing-bytes') f.ledger.effects.bcs.value = new Uint8Array([...f.ledger.effects.bcs.value, 0])
  if (mutation === 'effect-digest') f.ledger.effects.transactionDigest = digest
  if (mutation === 'status') f.ledger.effects.status.success = false
  if (mutation === 'checkpoint') f.ledger.checkpoint = -1n
  await expect(f.real.adapter.query(f.record)).rejects.toThrow()
})
it('maps only exact NOT_FOUND to absence, never timeout/error text', async () => {
  const f = await clientFixture()
  f.query.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'NOT_FOUND' }))
  expect(await f.real.adapter.query(f.record)).toBe('MISSING')
  f.query.mockRejectedValueOnce(new Error('NOT_FOUND'))
  await expect(f.real.adapter.query(f.record)).rejects.toThrow('NOT_FOUND')
  f.query.mockRejectedValueOnce(Object.assign(new Error('outage'), { code: 'UNAVAILABLE' }))
  await expect(f.real.adapter.query(f.record)).rejects.toThrow('outage')
})
it.each(['wrong-chain', 'short-chain', 'writes-disabled', 'wallet-switched'])('rejects %s before wallet preparation', async mutation => {
  const f = await clientFixture()
  if (mutation === 'wrong-chain') f.chain.mockResolvedValue({ chainIdentifier: toBase58(new Uint8Array(32).fill(2)) })
  if (mutation === 'short-chain') f.chain.mockResolvedValue({ chainIdentifier: toBase58(new Uint8Array(4).fill(1)) })
  if (mutation === 'writes-disabled') f.setEnabled(false)
  if (mutation === 'wallet-switched') f.setAddress(id(999))
  await expect(f.prepare()).rejects.toThrow()
  expect(f.sign).not.toHaveBeenCalled(); expect(f.broadcast).not.toHaveBeenCalled()
})
it('retains query recovery when writes are disabled, wallet switched or signed intent expired', async () => {
  const f = await clientFixture()
  f.setEnabled(false); f.setAddress(null)
  expect(await f.real.adapter.query(f.record)).toBe('SUCCEEDED')
  await expect(f.real.adapter.preflight(f.record, false)).rejects.toThrow('PROFILE_WRITES_DISABLED')
  f.setEnabled(true); f.setAddress(f.intent.owner)
  f.epoch.mockImplementation(async () => ({ response: { epoch: { epoch: 11n } } }) as never)
  await expect(f.real.adapter.preflight(f.record, false)).rejects.toThrow('PROFILE_TRANSACTION_EXPIRED_QUERY_ONLY')
  expect(await f.real.adapter.query(f.record)).toBe('SUCCEEDED')
})
it('verifies a real signature and broadcasts only its exact bytes with current wallet', async () => {
  const f = await clientFixture(), signed = await f.real.adapter.sign(f.record)
  const record = { ...f.record, phase: 'SIGNED' as const, signature: signed.signature }
  await f.real.adapter.verifySignature(record)
  await f.real.adapter.broadcast(record)
  expect(f.broadcast).toHaveBeenCalledWith({ transaction: fromBase64(record.bytes), signatures: [record.signature] })
  f.setAddress(null)
  await expect(f.real.adapter.broadcast(record)).rejects.toThrow('PROFILE_RECONNECT_PREPARING_WALLET')
  expect(f.broadcast).toHaveBeenCalledOnce()
})
