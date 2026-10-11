import { afterEach, expect, it, vi } from 'vitest'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { verifyTransactionSignature } from '@mysten/sui/verify'
import { walletFollowOperationFixture, id, signer } from './fixtures/wallet-follow-operation'
import { createWalletFollowIntent, parseWalletFollowOperation, runWalletFollowOperation, walletFollowOperationKey,
  WalletFollowPersistenceError,
  type WalletFollowOperation, type WalletFollowOperationAdapter, type WalletFollowOperationStore } from '../../packages/soulidity-sdk/src/wallet-follow-operation'

afterEach(() => vi.restoreAllMocks())
async function fixture() {
  const f = await walletFollowOperationFixture()
  let saved: WalletFollowOperation | null = null, locked = false, submitted = false
  const events: string[] = []
  const store: WalletFollowOperationStore = {
    exclusive: async (_key, run) => { if (locked) throw new Error('busy'); locked = true; try { return await run() } finally { locked = false } },
    read: () => structuredClone(saved), write: (_key, value) => { saved = structuredClone(value); events.push('persist:' + value.phase) },
  }
  const adapter: WalletFollowOperationAdapter = {
    query: vi.fn(async () => { events.push('query'); return submitted ? 'SUCCEEDED' : 'MISSING' }),
    preflight: vi.fn(async (_record, signing) => { events.push('preflight:' + signing) }),
    sign: vi.fn(async record => { events.push('sign'); return signer.signTransaction(fromBase64(record.bytes)) }),
    verifySignature: vi.fn(async record => { events.push('verify'); await verifyTransactionSignature(fromBase64(record.bytes), record.signature!, { address: record.intent.owner }) }),
    broadcast: vi.fn(async () => { events.push('broadcast'); submitted = true }),
  }
  const run = (prepared = false, options = {}) => runWalletFollowOperation({ intent: f.intent, store, adapter,
    ...(prepared ? { prepared: f.record } : {}), ...options })
  return { ...f, events, store, adapter, run, saved: () => saved }
}
it('freezes exact intent while accepting semantically identical JSON key order', async () => {
  const f = await fixture(), reordered = { ...f.record, intent: Object.fromEntries(Object.entries(f.intent).reverse()) }
  expect(parseWalletFollowOperation(reordered)).toEqual(f.record)
  expect(Object.isFrozen(f.intent)).toBe(true); expect(Object.isFrozen(f.intent.deployment.profile)).toBe(true)
  expect(walletFollowOperationKey({ deployment: f.intent.deployment, owner: f.intent.owner, targetId: f.intent.targetId }))
    .toBe(walletFollowOperationKey({ ...f.intent, expectedRevision: '5', following: false }))
})
it.each(['extra-intent', 'extra-deployment', 'extra-profile', 'extra-record', 'short-owner', 'numeric-revision', 'self'])('rejects untrusted intent mutation %s', async mutation => {
  const { record } = await fixture(); const value = structuredClone(record) as any
  if (mutation === 'extra-intent') value.intent.injected = true
  if (mutation === 'extra-deployment') value.intent.deployment.injected = true
  if (mutation === 'extra-profile') value.intent.deployment.profile.injected = true
  if (mutation === 'extra-record') value.injected = true
  if (mutation === 'short-owner') value.intent.owner = '0x1'
  if (mutation === 'numeric-revision') value.intent.expectedRevision = 0
  if (mutation === 'self') value.intent.targetId = value.intent.actorId
  expect(() => parseWalletFollowOperation(value)).toThrow()
})
it('persists exact bytes before prompt and verified real signature before broadcast', async () => {
  const f = await fixture()
  expect((await f.run(true)).phase).toBe('SUCCEEDED')
  expect(f.events).toEqual(['persist:PREPARED', 'query', 'preflight:true', 'persist:SIGNING', 'sign', 'verify',
    'persist:SIGNED', 'preflight:false', 'verify', 'broadcast', 'query', 'persist:SUCCEEDED'])
  expect(f.saved()?.bytes).toBe(f.record.bytes)
})
it.each(['prepared', 'signing', 'signed', 'succeeded', 'cancelled'])('query-only never prompts or broadcasts: %s', async phase => {
  const f = await fixture(), record = { ...f.record, phase: phase.toUpperCase() as WalletFollowOperation['phase'] }
  if (phase === 'signed') record.signature = (await signer.signTransaction(fromBase64(record.bytes))).signature
  f.store.write('x', record)
  if (phase === 'succeeded') vi.mocked(f.adapter.query).mockResolvedValue('SUCCEEDED')
  await f.run(false, { queryOnly: true })
  expect(f.adapter.sign).not.toHaveBeenCalled(); expect(f.adapter.broadcast).not.toHaveBeenCalled(); expect(f.adapter.preflight).not.toHaveBeenCalled()
  expect(f.adapter.query).toHaveBeenCalledOnce()
})
it('keeps a signed record after unknown broadcast and resumes the same bytes without rebuilding/signing', async () => {
  const f = await fixture()
  vi.mocked(f.adapter.broadcast).mockRejectedValueOnce(new Error('transport unknown'))
  await expect(f.run(true)).rejects.toThrow('transport unknown')
  const signed = f.saved()!; expect(signed.phase).toBe('SIGNED')
  await f.run()
  expect(f.adapter.sign).toHaveBeenCalledOnce()
  expect(f.adapter.broadcast).toHaveBeenCalledTimes(2)
  expect(vi.mocked(f.adapter.broadcast).mock.calls[1][0]).toEqual(signed)
  expect(f.saved()?.bytes).toBe(f.record.bytes)
})
it('unknown wallet signing retains SIGNING and allows only the same frozen transaction recovery', async () => {
  const f = await fixture()
  vi.mocked(f.adapter.sign).mockRejectedValueOnce(new Error('wallet disconnected'))
  await expect(f.run(true)).rejects.toThrow('wallet disconnected')
  expect(f.saved()?.phase).toBe('SIGNING')
  await expect(f.run(false, { cancelUnsigned: true })).rejects.toThrow('FOLLOW_OPERATION_CANNOT_DISCARD_SIGNED')
  await expect(f.run(true)).rejects.toThrow('FOLLOW_OPERATION_RECOVERY_REQUIRED')
  await f.run(); expect(f.adapter.sign).toHaveBeenCalledTimes(2)
  expect(vi.mocked(f.adapter.sign).mock.calls[1][0].bytes).toBe(f.record.bytes)
})
it('only explicit wallet-standard rejection resets a first prompt to PREPARED', async () => {
  const f = await fixture(), rejected = Object.assign(new Error('rejected'), { name: 'WalletStandardError', context: { __code: 4001000 } })
  vi.mocked(f.adapter.sign).mockRejectedValueOnce(rejected)
  await expect(f.run(true)).rejects.toThrow('rejected'); expect(f.saved()?.phase).toBe('PREPARED')
  expect((await f.run(false, { cancelUnsigned: true })).phase).toBe('CANCELLED')
  f.store.write('x', { ...f.record, phase: 'SIGNING' })
  vi.mocked(f.adapter.sign).mockRejectedValueOnce(rejected)
  await expect(f.run()).rejects.toThrow('rejected'); expect(f.saved()?.phase).toBe('SIGNING')
})
it.each(['PREPARED', 'SIGNING', 'SIGNED'])('storage failure at %s cannot advance to an unsafe prompt/broadcast', async phase => {
  const f = await fixture(), original = f.store.write
  f.store.write = (key, record) => { if (record.phase === phase) throw new Error('quota'); original(key, record) }
  const failure = await f.run(true).catch(error => error)
  expect(failure).toBeInstanceOf(WalletFollowPersistenceError)
  expect(failure.cause.message).toBe('quota')
  expect(f.adapter.broadcast).not.toHaveBeenCalled()
  if (phase !== 'SIGNED') expect(f.adapter.sign).not.toHaveBeenCalled()
  else {
    expect(f.saved()?.phase).toBe('SIGNING')
    const recovered = failure.record
    expect(recovered.phase).toBe('SIGNED'); expect(recovered.bytes).toBe(f.record.bytes)
    await verifyTransactionSignature(fromBase64(recovered.bytes), recovered.signature, { address: recovered.intent.owner })
    recovered.signature = null
    expect(failure.record.signature).not.toBeNull()
  }
})
it.each(['changed-bytes', 'invalid-signature'])('never broadcasts a wallet result with %s', async mutation => {
  const f = await fixture()
  vi.mocked(f.adapter.sign).mockResolvedValue({ bytes: mutation === 'changed-bytes' ? 'AA==' : f.record.bytes, signature: 'invalid' })
  await expect(f.run(true)).rejects.toThrow(); expect(f.adapter.broadcast).not.toHaveBeenCalled(); expect(f.saved()?.phase).toBe('SIGNING')
})
it.each(['SUCCEEDED', 'FAILED'])('does not trust cached terminal %s without matching chain evidence', async phase => {
  const f = await fixture(); f.store.write('x', { ...f.record, phase: phase as WalletFollowOperation['phase'] })
  await expect(f.run(false, { queryOnly: true })).rejects.toThrow('FOLLOW_OPERATION_RESULT_UNCONFIRMED')
  await expect(f.run(true)).rejects.toThrow('FOLLOW_OPERATION_PREVIOUS_RESULT_UNCONFIRMED')
  expect(f.adapter.sign).not.toHaveBeenCalled()
})
it('pending ledger evidence returns without signing, cancellation or rebroadcast', async () => {
  const f = await fixture(); f.store.write('x', f.record); vi.mocked(f.adapter.query).mockResolvedValue('PENDING')
  expect((await f.run(false, { cancelUnsigned: true })).phase).toBe('PREPARED')
  expect(f.adapter.sign).not.toHaveBeenCalled(); expect(f.adapter.broadcast).not.toHaveBeenCalled()
})
it.each(['wallet', 'release', 'target', 'revision', 'desired'])('refuses mismatched recovery intent %s', async mutation => {
  const f = await fixture(); f.store.write('x', f.record); const intent = structuredClone(f.intent)
  if (mutation === 'wallet') intent.owner = id(900)
  if (mutation === 'release') intent.deployment.profile.callablePackageId = id(900)
  if (mutation === 'target') intent.targetId = id(900)
  if (mutation === 'revision') intent.expectedRevision = '2'
  if (mutation === 'desired') intent.following = false
  await expect(runWalletFollowOperation({ intent, store: f.store, adapter: f.adapter })).rejects.toThrow(/FOLLOW_OPERATION_(SCOPE|INTENT)_MISMATCH/)
  expect(f.adapter.sign).not.toHaveBeenCalled(); expect(f.adapter.query).not.toHaveBeenCalled()
})
it('serializes concurrent operations and refuses a new intent while one is signing', async () => {
  const f = await fixture(); let finish!: () => void
  vi.mocked(f.adapter.preflight).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  const running = f.run(true)
  await vi.waitFor(() => expect(finish).toBeDefined())
  await expect(f.run()).rejects.toThrow('busy')
  finish(); await running; expect(f.adapter.sign).toHaveBeenCalledOnce()
})
it.each(['call-package', 'call-function', 'extra-call', 'type-argument', 'argument-order', 'actor', 'target', 'target-owner', 'revision', 'desired',
  'social-immutable', 'profile-mutable', 'shared-id', 'shared-zero-version', 'gas-owner', 'gas-overlap', 'gas-duplicate', 'expiry', 'trailing-bytes'])('rejects a rebuilt and rehashed malicious transaction: %s', async mutation => {
  const f = await fixture(), record = structuredClone(f.record), data = f.tx.getData()
  if (mutation === 'trailing-bytes') {
    const bytes = new Uint8Array([...fromBase64(record.bytes), 0]); record.bytes = toBase64(bytes); record.digest = TransactionDataBuilder.getDigestFromBytes(bytes)
  } else {
    const call = data.commands[0].MoveCall!
    if (mutation === 'call-package') call.package = id(999)
    if (mutation === 'call-function') call.function = 'other'
    if (mutation === 'extra-call') data.commands.push(data.commands[0])
    if (mutation === 'type-argument') call.typeArguments.push('0x2::sui::SUI')
    if (mutation === 'argument-order') [call.arguments[2], call.arguments[3]] = [call.arguments[3], call.arguments[2]]
    if (mutation === 'actor') record.intent.actorId = id(999)
    if (mutation === 'target') record.intent.targetId = id(999)
    if (mutation === 'target-owner') record.intent.targetOwner = id(999)
    if (mutation === 'revision') record.intent.expectedRevision = '2'
    if (mutation === 'desired') record.intent.following = false
    if (mutation === 'social-immutable') data.inputs[0].Object!.SharedObject!.mutable = false
    if (mutation === 'profile-mutable') data.inputs[1].Object!.SharedObject!.mutable = true
    if (mutation === 'shared-id') data.inputs[1].Object!.SharedObject!.objectId = id(999)
    if (mutation === 'shared-zero-version') data.inputs[0].Object!.SharedObject!.initialSharedVersion = '0'
    if (mutation === 'gas-owner') data.gasData.owner = id(999)
    if (mutation === 'gas-overlap') data.gasData.payment![0].objectId = f.intent.deployment.registryId
    if (mutation === 'gas-duplicate') data.gasData.payment!.push(data.gasData.payment![0])
    if (mutation === 'expiry') data.expiration = { $kind: 'Epoch', Epoch: '11' }
    const bytes = await Transaction.from(JSON.stringify(data)).build(); record.bytes = toBase64(bytes); record.digest = TransactionDataBuilder.getDigestFromBytes(bytes)
  }
  expect(() => parseWalletFollowOperation(record)).toThrow()
})
