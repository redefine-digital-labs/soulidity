import { afterEach, expect, it, vi } from 'vitest'
import { Transaction } from '@mysten/sui/transactions'
import { bcs } from '@mysten/sui/bcs'
import { fromBase64, toBase58 } from '@mysten/sui/utils'
import { walletFollowReadFixture, id, digest, signer } from './fixtures/wallet-follow-operation'
import { createWalletFollowOperationClient } from '../../web/lib/social/follow-operation-client'
import { runWalletFollowOperation, type WalletFollowOperation, type WalletFollowOperationStore } from '../../packages/soulidity-sdk/src/wallet-follow-operation'

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })
async function fixture() {
  const f = await walletFollowReadFixture()
  const effects = (success = true, txDigest = f.record.digest, executedEpoch = '9') => bcs.TransactionEffects.serialize({ V2: {
    status: success ? { Success: true } : { Failure: { error: { InsufficientGas: true }, command: 0 } },
    executedEpoch, gasUsed: { computationCost: '1', storageCost: '0', storageRebate: '0', nonRefundableStorageFee: '0' },
    transactionDigest: txDigest, gasObjectIndex: null, eventsDigest: null, dependencies: [], lamportVersion: '3',
    changedObjects: [], unchangedConsensusObjects: [], auxDataDigest: null,
  } }).toBytes()
  const ledger = { digest: f.record.digest, transaction: { digest: f.record.digest, bcs: { value: fromBase64(f.record.bytes) } },
    effects: { transactionDigest: f.record.digest, bcs: { value: effects() }, status: { success: true } }, checkpoint: 0n as bigint | undefined }
  const query = vi.spyOn(f.client.ledgerService, 'getTransaction').mockImplementation(async () => ({ response: { transaction: ledger } }) as never)
  const broadcast = vi.spyOn(f.client.core, 'executeTransaction').mockResolvedValue({} as never)
  const originalBuild = Transaction.prototype.build
  // Deterministic gas/shared references replace public node transaction-build
  // discovery only. The real SDK still serializes the actual built transaction.
  const build = vi.spyOn(Transaction.prototype, 'build').mockImplementation(async function (this: Transaction, options) {
    return options?.client === f.client ? originalBuild.call(f.resolve(this)) : originalBuild.call(this, options)
  })
  let enabled = true, address: string | null = f.intent.owner
  const sign = vi.fn(async (tx: Transaction) => signer.signTransaction(await tx.build()))
  const real = createWalletFollowOperationClient({ client: f.client, deployment: f.intent.deployment,
    writesEnabled: () => enabled, getAddress: () => address, sign })
  const signed = async (): Promise<WalletFollowOperation> => ({ ...f.record, phase: 'SIGNED', signature: (await signer.signTransaction(fromBase64(f.record.bytes))).signature })
  return { ...f, effects, ledger, query, broadcast, build, sign, real, signed,
    setEnabled: (value: boolean) => { enabled = value }, setAddress: (value: string | null) => { address = value } }
}
it('prepares one exact CAS transaction after real typed identity/social reads, without signing', async () => {
  const f = await fixture()
  expect(await f.real.prepare(f.intent)).toEqual(f.record)
  expect(f.getObject).toHaveBeenCalled(); expect(f.owned).toHaveBeenCalled()
  expect(f.sign).not.toHaveBeenCalled(); expect(f.broadcast).not.toHaveBeenCalled()
})
it.each(['wrong-chain', 'short-chain', 'writes-disabled', 'wallet-switched', 'changed-edge', 'already-current', 'unregistered-actor', 'wrong-target-owner'])('fails %s before preparing a wallet transaction', async variant => {
  const f = await fixture()
  let intent = f.intent
  if (variant === 'wrong-chain') f.chain.mockResolvedValue({ chainIdentifier: toBase58(new Uint8Array(32).fill(2)) })
  if (variant === 'short-chain') f.chain.mockResolvedValue({ chainIdentifier: toBase58(new Uint8Array(4).fill(1)) })
  if (variant === 'writes-disabled') f.setEnabled(false)
  if (variant === 'wallet-switched') f.setAddress(id(90))
  if (variant === 'changed-edge') f.setEdge(false, '2')
  if (variant === 'already-current') intent = { ...intent, following: false }
  if (variant === 'unregistered-actor') f.owned.mockResolvedValue({ objects: [], hasNextPage: false, cursor: null } as any)
  if (variant === 'wrong-target-owner') intent = { ...intent, targetOwner: id(90) }
  await expect(f.real.prepare(intent)).rejects.toThrow()
  expect(f.sign).not.toHaveBeenCalled(); expect(f.broadcast).not.toHaveBeenCalled()
})
it('cold-reads CAS again before signing, but signed recovery does not reinterpret current edge state', async () => {
  const f = await fixture(); await f.real.adapter.preflight(f.record, true)
  f.setEdge(false, '2')
  await expect(f.real.adapter.preflight(f.record, true)).rejects.toThrow('FOLLOW_CHANGED_RELOAD_REQUIRED')
  await expect(f.real.adapter.preflight(await f.signed(), false)).resolves.toBeUndefined()
})
it('detects a wallet switch during async prepare before returning prepared bytes', async () => {
  const f = await fixture(), original = f.epoch.getMockImplementation()!
  f.epoch.mockImplementation(async (...args) => { f.setAddress(null); return original(...args) })
  await expect(f.real.prepare(f.intent)).rejects.toThrow('FOLLOW_RECONNECT_PREPARING_WALLET')
  expect(f.sign).not.toHaveBeenCalled()
})
it('expired signed operations remain query-only with no rebuilt transaction', async () => {
  const f = await fixture(), signed = await f.signed()
  f.epoch.mockImplementation(async () => ({ response: { epoch: { epoch: 11n } } }) as never)
  await expect(f.real.adapter.preflight(signed, false)).rejects.toThrow('FOLLOW_TRANSACTION_EXPIRED_QUERY_ONLY')
  f.setEnabled(false); f.setAddress(null)
  expect(await f.real.adapter.query(signed)).toBe('SUCCEEDED')
  expect(f.sign).not.toHaveBeenCalled(); expect(f.broadcast).not.toHaveBeenCalled()
})
it.each(['missing-epoch', 'negative-epoch', 'exhausted-epoch'])('does not guess expiration when current epoch is %s', async variant => {
  const f = await fixture()
  f.epoch.mockImplementation(async () => ({ response: { epoch: { epoch: variant === 'missing-epoch' ? undefined : variant === 'negative-epoch' ? -1n : 18446744073709551615n } } }) as never)
  await expect(f.real.prepare(f.intent)).rejects.toThrow('FOLLOW_CURRENT_EPOCH_UNAVAILABLE')
})
it('requires exact transaction bytes, canonical effects, status agreement and checkpoint', async () => {
  const f = await fixture()
  expect(await f.real.adapter.query(f.record)).toBe('SUCCEEDED')
  f.ledger.checkpoint = undefined; expect(await f.real.adapter.query(f.record)).toBe('PENDING')
  f.ledger.checkpoint = 0n; f.ledger.effects.bcs.value = f.effects(false); f.ledger.effects.status.success = false
  expect(await f.real.adapter.query(f.record)).toBe('FAILED')
})
it.each(['digest', 'inner-digest', 'bytes', 'effects-digest', 'decoded-digest', 'effects-trailing', 'status', 'checkpoint', 'executed-after-expiry'])('rejects transaction evidence substitution: %s', async variant => {
  const f = await fixture()
  if (variant === 'digest') f.ledger.digest = digest
  if (variant === 'inner-digest') f.ledger.transaction.digest = digest
  if (variant === 'bytes') f.ledger.transaction.bcs.value = new Uint8Array([0])
  if (variant === 'effects-digest') f.ledger.effects.transactionDigest = digest
  if (variant === 'decoded-digest') f.ledger.effects.bcs.value = f.effects(true, digest)
  if (variant === 'effects-trailing') f.ledger.effects.bcs.value = new Uint8Array([...f.ledger.effects.bcs.value, 0])
  if (variant === 'status') f.ledger.effects.status.success = false
  if (variant === 'checkpoint') f.ledger.checkpoint = -1n
  if (variant === 'executed-after-expiry') f.ledger.effects.bcs.value = f.effects(true, f.record.digest, '11')
  await expect(f.real.adapter.query(f.record)).rejects.toThrow()
})
it('only a typed NOT_FOUND response is absence; missing body, text, timeout and permission failures remain errors', async () => {
  const f = await fixture()
  f.query.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'NOT_FOUND' }))
  expect(await f.real.adapter.query(f.record)).toBe('MISSING')
  for (const error of [new Error('NOT_FOUND'), new Error('timeout'), Object.assign(new Error('denied'), { code: 'PERMISSION_DENIED' })]) {
    f.query.mockRejectedValueOnce(error); await expect(f.real.adapter.query(f.record)).rejects.toThrow(error.message)
  }
  f.query.mockResolvedValueOnce({ response: {} } as never)
  await expect(f.real.adapter.query(f.record)).rejects.toThrow('FOLLOW_TRANSACTION_EVIDENCE_MISMATCH')
})
it('verifies a real owner signature and broadcasts only those exact saved bytes', async () => {
  const f = await fixture(), signed = await f.signed()
  await f.real.adapter.verifySignature(signed); await f.real.adapter.broadcast(signed)
  expect(f.broadcast).toHaveBeenCalledWith({ transaction: fromBase64(signed.bytes), signatures: [signed.signature] })
  f.setAddress(null)
  await expect(f.real.adapter.broadcast(signed)).rejects.toThrow('FOLLOW_RECONNECT_PREPARING_WALLET')
  expect(f.broadcast).toHaveBeenCalledOnce()
})
it('runs through the concrete adapter and recovers success independently of mutable edge state', async () => {
  const f = await fixture(); let saved: WalletFollowOperation | null = null, submitted = false
  f.query.mockImplementation(async () => {
    if (!submitted) throw Object.assign(new Error('missing'), { code: 'NOT_FOUND' })
    return { response: { transaction: f.ledger } } as never
  })
  f.broadcast.mockImplementation(async () => { submitted = true; f.setEdge(false, '4'); return {} as never })
  const store: WalletFollowOperationStore = { exclusive: async (_key, work) => work(), read: () => saved,
    write: (_key, record) => { saved = structuredClone(record) } }
  const prepared = await f.real.prepare(f.intent)
  expect((await runWalletFollowOperation({ intent: f.intent, prepared, store, adapter: f.real.adapter })).phase).toBe('SUCCEEDED')
  expect(f.sign).toHaveBeenCalledOnce(); expect(f.broadcast).toHaveBeenCalledOnce()
  f.setAddress(null); f.setEnabled(false)
  expect((await runWalletFollowOperation({ intent: f.intent, store, adapter: f.real.adapter, queryOnly: true })).phase).toBe('SUCCEEDED')
})

it('bounds a hung preparation build and ignores late bytes without signing', async () => {
  const f = await fixture(); let release!: (bytes: Uint8Array) => void
  f.build.mockImplementationOnce(() => new Promise<Uint8Array>(resolve => { release = resolve }))
  vi.useFakeTimers()
  const preparing = f.real.prepare(f.intent).catch(error => error)
  await vi.waitFor(() => expect(release).toBeDefined())
  await vi.advanceTimersByTimeAsync(15001)
  expect((await preparing).message).toBe('FOLLOW_PREPARATION_TIMEOUT_RETRY')
  release(fromBase64(f.record.bytes)); await vi.advanceTimersByTimeAsync(0)
  expect(f.sign).not.toHaveBeenCalled(); expect(f.broadcast).not.toHaveBeenCalled()
})

it.each(['sign', 'verify', 'broadcast'])('a hung %s releases the lock, preserves recovery and ignores late fulfillment', async stage => {
  const f = await fixture()
  const signed = await signer.signTransaction(fromBase64(f.record.bytes))
  let release!: (value: any) => void, locked = false, saved: WalletFollowOperation | null = null
  const never = () => new Promise<any>(resolve => { release = resolve })
  if (stage === 'sign') f.sign.mockImplementationOnce(never)
  if (stage === 'broadcast') f.broadcast.mockImplementationOnce(never)
  if (stage === 'verify') {
    // The adapter resolves its installed web SDK, which is distinct from the
    // root package used by transaction fixtures. Keep all other real checks.
    const verifier = await import('../../web/node_modules/@mysten/sui/dist/cryptography/publickey.mjs')
    vi.spyOn(verifier.PublicKey.prototype, 'verifyTransaction').mockImplementationOnce(never)
  }
  f.query.mockRejectedValue(Object.assign(new Error('missing'), { code: 'NOT_FOUND' }))
  const store: WalletFollowOperationStore = {
    exclusive: async (_key, work) => { if (locked) throw new Error('busy'); locked = true
      try { return await work() } finally { locked = false }
    }, read: () => structuredClone(saved), write: (_key, record) => { saved = structuredClone(record) },
  }
  vi.useFakeTimers()
  const running = runWalletFollowOperation({ intent: f.intent, prepared: f.record, store, adapter: f.real.adapter }).catch(error => error)
  await vi.waitFor(() => expect(release).toBeDefined())
  expect(locked).toBe(true)
  await vi.advanceTimersByTimeAsync(stage === 'sign' ? 120001 : stage === 'verify' ? 15001 : 30001)
  expect((await running).message).toContain('TIMEOUT_QUERY_SAVED_TRANSACTION')
  expect(locked).toBe(false)
  const snapshot = structuredClone(saved)!
  expect(snapshot.phase).toBe(stage === 'broadcast' ? 'SIGNED' : 'SIGNING')
  expect(snapshot.bytes).toBe(f.record.bytes)
  release(stage === 'sign' ? signed : stage === 'verify' ? true : undefined); await vi.advanceTimersByTimeAsync(0)
  expect(saved).toEqual(snapshot)
  expect(f.broadcast).toHaveBeenCalledTimes(stage === 'broadcast' ? 1 : 0)
  const checked = await runWalletFollowOperation({ intent: f.intent, store, adapter: f.real.adapter, queryOnly: true })
  expect(checked.phase).toBe(snapshot.phase)
  expect(locked).toBe(false)
  expect(f.broadcast).toHaveBeenCalledTimes(stage === 'broadcast' ? 1 : 0)
})
