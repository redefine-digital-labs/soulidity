import { afterEach, expect, it, vi } from 'vitest'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { verifyTransactionSignature } from '@mysten/sui/verify'
import { profileId as id, profileSigner as signer, profileDigest as digest } from './fixtures/public-profile-operation'
import { buildAcceptPublicCommunityAnswerTx } from '../../packages/soulidity-sdk/src/community-posts-write'
import { createPublicCommunityAcceptIntent, parsePublicCommunityAcceptOperation, runPublicCommunityAcceptOperation, publicCommunityAcceptOperationKey,
  PublicCommunityAcceptPersistenceError,
  type PublicCommunityAcceptOperation, type PublicCommunityAcceptOperationAdapter, type PublicCommunityAcceptOperationStore } from '../../packages/soulidity-sdk/src/community-accept-operation'

async function publicCommunityAcceptOperationFixture(commentId = id(6), expectedRevision = '0') {
  const intent = createPublicCommunityAcceptIntent({ deployment: { profile: {
    originalPackageId: id(1), callablePackageId: id(2), registryId: id(3), chainIdentifier: '01010101' },
    registryId: id(100) }, owner: signer.toSuiAddress(), authorId: id(4),
    postId: id(5), expectedRevision, commentId })
  const template = buildAcceptPublicCommunityAnswerTx(intent).getData()
  const tx = Transaction.from(JSON.stringify({ ...template, inputs: template.inputs.map(input => input.UnresolvedObject
    ? input.UnresolvedObject.objectId === intent.commentId
      ? { Object: { ImmOrOwnedObject: { objectId: intent.commentId, version: '1', digest } } }
      : { Object: { SharedObject: { objectId: input.UnresolvedObject.objectId, initialSharedVersion: '1',
        mutable: input.UnresolvedObject.objectId === intent.postId } } } : input) }))
  tx.setGasOwner(intent.owner); tx.setGasBudget('10000000'); tx.setGasPrice('1000')
  tx.setGasPayment([{ objectId: id(60), version: '1', digest }]); tx.setExpiration({ Epoch: '10' })
  const bytes = await tx.build()
  const record: PublicCommunityAcceptOperation = { schema: 'soulidity.community-accept-operation.v1', intent, bytes: toBase64(bytes),
    digest: TransactionDataBuilder.getDigestFromBytes(bytes), expirationEpoch: '10', phase: 'PREPARED', signature: null }
  return { intent, record, tx }
}

afterEach(() => vi.restoreAllMocks())
async function fixture() {
  const f = await publicCommunityAcceptOperationFixture()
  let saved: PublicCommunityAcceptOperation | null = null, locked = false, submitted = false
  const events: string[] = []
  const store: PublicCommunityAcceptOperationStore = {
    exclusive: async (_key, run) => { if (locked) throw new Error('busy'); locked = true; try { return await run() } finally { locked = false } },
    read: () => structuredClone(saved), write: (_key, value) => { saved = structuredClone(value); events.push('persist:' + value.phase) },
  }
  const adapter: PublicCommunityAcceptOperationAdapter = {
    query: vi.fn(async () => { events.push('query'); return submitted ? 'SUCCEEDED' : 'MISSING' }),
    preflight: vi.fn(async (_record, signing) => { events.push('preflight:' + signing) }),
    sign: vi.fn(async record => { events.push('sign'); return signer.signTransaction(fromBase64(record.bytes)) }),
    verifySignature: vi.fn(async record => { events.push('verify'); await verifyTransactionSignature(fromBase64(record.bytes), record.signature!, { address: record.intent.owner }) }),
    broadcast: vi.fn(async () => { events.push('broadcast'); submitted = true }),
  }
  const run = (prepared = false, options = {}) => runPublicCommunityAcceptOperation({ intent: f.intent, store, adapter,
    ...(prepared ? { prepared: f.record } : {}), ...options })
  return { ...f, events, store, adapter, run, saved: () => saved }
}
it('freezes exact intent while accepting semantically identical JSON key order', async () => {
  const f = await fixture(), reordered = { ...f.record, intent: Object.fromEntries(Object.entries(f.intent).reverse()) }
  expect(parsePublicCommunityAcceptOperation(reordered)).toEqual(f.record)
  expect(Object.isFrozen(f.intent)).toBe(true); expect(Object.isFrozen(f.intent.deployment.profile)).toBe(true)
  const alternate = { ...f.intent, expectedRevision: '5', commentId: id(7) }
  expect(publicCommunityAcceptOperationKey({ deployment: f.intent.deployment, owner: f.intent.owner, postId: f.intent.postId }))
    .toBe(publicCommunityAcceptOperationKey(alternate))
})
it('freezes the answer and full-u64 CAS revision', async () => {
  const f = await publicCommunityAcceptOperationFixture(id(6), '18446744073709551615')
  expect(parsePublicCommunityAcceptOperation(f.record).intent).toMatchObject({ commentId: id(6), expectedRevision: '18446744073709551615' })
})
it.each(['-1', '18446744073709551616', '01', 1, null])('rejects invalid revision %s before any signing', async expectedRevision => {
  const f = await fixture()
  expect(() => createPublicCommunityAcceptIntent({ ...f.intent, expectedRevision } as any)).toThrow('INTENT_INVALID')
})
it('separates complete release identities while leaving revision/comment outside the operation key', async () => {
  const f = await fixture(), original = publicCommunityAcceptOperationKey(f.intent)
  for (const change of ['originalPackageId', 'callablePackageId', 'registryId', 'chainIdentifier'] as const) {
    const intent = structuredClone(f.intent)
    intent.deployment.profile[change] = change === 'chainIdentifier' ? '02020202' : id(900)
    expect(publicCommunityAcceptOperationKey(intent)).not.toBe(original)
  }
})
it.each(['extra-intent', 'extra-deployment', 'extra-profile', 'extra-record', 'short-owner', 'numeric-revision', 'actor-post-alias'])('rejects untrusted intent mutation %s', async mutation => {
  const { record } = await fixture(); const value = structuredClone(record) as any
  if (mutation === 'extra-intent') value.intent.injected = true
  if (mutation === 'extra-deployment') value.intent.deployment.injected = true
  if (mutation === 'extra-profile') value.intent.deployment.profile.injected = true
  if (mutation === 'extra-record') value.injected = true
  if (mutation === 'short-owner') value.intent.owner = '0x1'
  if (mutation === 'numeric-revision') value.intent.expectedRevision = 0
  if (mutation === 'actor-post-alias') value.intent.postId = value.intent.authorId
  expect(() => parsePublicCommunityAcceptOperation(value)).toThrow()
})
it('persists exact bytes before prompt and verified real signature before broadcast', async () => {
  const f = await fixture()
  expect((await f.run(true)).phase).toBe('SUCCEEDED')
  expect(f.events).toEqual(['persist:PREPARED', 'query', 'preflight:true', 'persist:SIGNING', 'sign', 'verify',
    'persist:SIGNED', 'preflight:false', 'verify', 'broadcast', 'query', 'persist:SUCCEEDED'])
  expect(f.saved()?.bytes).toBe(f.record.bytes)
})
it.each(['prepared', 'signing', 'signed', 'succeeded', 'failed', 'cancelled'])('query-only never prompts or broadcasts: %s', async phase => {
  const f = await fixture(), record = { ...f.record, phase: phase.toUpperCase() as PublicCommunityAcceptOperation['phase'] }
  if (phase === 'signed') record.signature = (await signer.signTransaction(fromBase64(record.bytes))).signature
  f.store.write('x', record)
  if (phase === 'succeeded' || phase === 'failed') vi.mocked(f.adapter.query).mockResolvedValue(phase === 'succeeded' ? 'SUCCEEDED' : 'FAILED')
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
  await expect(f.run(false, { cancelUnsigned: true })).rejects.toThrow('COMMUNITY_ACCEPT_OPERATION_CANNOT_DISCARD_SIGNED')
  await expect(f.run(true)).rejects.toThrow('COMMUNITY_ACCEPT_OPERATION_RECOVERY_REQUIRED')
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
  expect(failure).toBeInstanceOf(PublicCommunityAcceptPersistenceError)
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
  const f = await fixture(); f.store.write('x', { ...f.record, phase: phase as PublicCommunityAcceptOperation['phase'] })
  await expect(f.run(false, { queryOnly: true })).rejects.toThrow('COMMUNITY_ACCEPT_OPERATION_RESULT_UNCONFIRMED')
  await expect(f.run(true)).rejects.toThrow('COMMUNITY_ACCEPT_OPERATION_PREVIOUS_RESULT_UNCONFIRMED')
  expect(f.adapter.sign).not.toHaveBeenCalled()
})
it('pending ledger evidence returns without signing, cancellation or rebroadcast', async () => {
  const f = await fixture(); f.store.write('x', f.record); vi.mocked(f.adapter.query).mockResolvedValue('PENDING')
  expect((await f.run(false, { cancelUnsigned: true })).phase).toBe('PREPARED')
  expect(f.adapter.sign).not.toHaveBeenCalled(); expect(f.adapter.broadcast).not.toHaveBeenCalled()
})
it.each([undefined, null, 'UNKNOWN', '', 0])('rejects invalid runtime query result %s without signing or sending', async result => {
  const f = await fixture()
  vi.mocked(f.adapter.query).mockResolvedValue(result as any)
  await expect(f.run(true)).rejects.toThrow('COMMUNITY_ACCEPT_OPERATION_QUERY_INVALID')
  expect(f.saved()?.phase).toBe('PREPARED')
  expect(f.adapter.preflight).not.toHaveBeenCalled()
  expect(f.adapter.sign).not.toHaveBeenCalled(); expect(f.adapter.broadcast).not.toHaveBeenCalled()
})
it.each(['wallet', 'release', 'target', 'revision', 'comment'])('refuses mismatched recovery intent %s', async mutation => {
  const f = await fixture(); f.store.write('x', f.record); const intent = structuredClone(f.intent)
  if (mutation === 'wallet') intent.owner = id(900)
  if (mutation === 'release') intent.deployment.profile.callablePackageId = id(900)
  if (mutation === 'target') intent.postId = id(900)
  if (mutation === 'revision') intent.expectedRevision = '2'
  if (mutation === 'comment') intent.commentId = id(7)
  await expect(runPublicCommunityAcceptOperation({ intent, store: f.store, adapter: f.adapter })).rejects.toThrow(/COMMUNITY_ACCEPT_OPERATION_(SCOPE|INTENT)_MISMATCH/)
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
it.each(['call-package', 'call-function', 'extra-call', 'type-argument', 'argument-order', 'actor', 'target', 'revision', 'comment',
  'comment-shared', 'comment-receiving', 'comment-zero-version', 'community-mutable', 'profile-mutable', 'post-immutable', 'shared-id', 'shared-zero-version', 'sender', 'gas-owner', 'gas-zero-budget', 'gas-zero-price', 'gas-zero-version', 'gas-overlap', 'gas-comment-overlap', 'gas-duplicate', 'expiry', 'trailing-bytes'])('rejects a rebuilt and rehashed malicious transaction: %s', async mutation => {
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
    if (mutation === 'actor') record.intent.authorId = id(999)
    if (mutation === 'target') record.intent.postId = id(999)
    if (mutation === 'revision') record.intent.expectedRevision = '2'
    if (mutation === 'comment') record.intent.commentId = id(7)
    if (mutation === 'comment-shared') data.inputs[3] = { Object: { SharedObject: { objectId: f.intent.commentId, initialSharedVersion: '1', mutable: false }, $kind: 'SharedObject' }, $kind: 'Object' }
    if (mutation === 'comment-receiving') data.inputs[3] = { Object: { Receiving: { objectId: f.intent.commentId, version: '1', digest }, $kind: 'Receiving' }, $kind: 'Object' }
    if (mutation === 'comment-zero-version') data.inputs[3].Object!.ImmOrOwnedObject!.version = '0'
    if (mutation === 'community-mutable') data.inputs[0].Object!.SharedObject!.mutable = true
    if (mutation === 'post-immutable') data.inputs[2].Object!.SharedObject!.mutable = false
    if (mutation === 'profile-mutable') data.inputs[1].Object!.SharedObject!.mutable = true
    if (mutation === 'shared-id') data.inputs[1].Object!.SharedObject!.objectId = id(999)
    if (mutation === 'shared-zero-version') data.inputs[0].Object!.SharedObject!.initialSharedVersion = '0'
    if (mutation === 'gas-owner') data.gasData.owner = id(999)
    if (mutation === 'sender') data.sender = id(999)
    if (mutation === 'gas-zero-budget') data.gasData.budget = '0'
    if (mutation === 'gas-zero-price') data.gasData.price = '0'
    if (mutation === 'gas-zero-version') data.gasData.payment![0].version = '0'
    if (mutation === 'gas-overlap') data.gasData.payment![0].objectId = f.intent.deployment.registryId
    if (mutation === 'gas-comment-overlap') data.gasData.payment![0].objectId = f.intent.commentId
    if (mutation === 'gas-duplicate') data.gasData.payment!.push(data.gasData.payment![0])
    if (mutation === 'expiry') data.expiration = { $kind: 'Epoch', Epoch: '11' }
    const bytes = await Transaction.from(JSON.stringify(data)).build(); record.bytes = toBase64(bytes); record.digest = TransactionDataBuilder.getDigestFromBytes(bytes)
  }
  expect(() => parsePublicCommunityAcceptOperation(record)).toThrow()
})

it.each(['SUCCEEDED', 'FAILED', 'CANCELLED'] as const)('allows a new accepted answer only after confirming previous terminal %s', async phase => {
  const f = await fixture(), next = await publicCommunityAcceptOperationFixture(id(7), '1')
  f.store.write('x', { ...f.record, phase })
  vi.mocked(f.adapter.query).mockResolvedValueOnce(phase === 'CANCELLED' ? 'MISSING' : phase).mockResolvedValueOnce('MISSING').mockResolvedValueOnce('SUCCEEDED')
  const result = await runPublicCommunityAcceptOperation({ intent: next.intent, prepared: next.record, store: f.store, adapter: f.adapter })
  expect(result.phase).toBe('SUCCEEDED'); expect(result.intent.commentId).toBe(id(7))
  expect(vi.mocked(f.adapter.query).mock.calls[0][0].bytes).toBe(f.record.bytes)
  expect(vi.mocked(f.adapter.sign).mock.calls[0][0].bytes).toBe(next.record.bytes)
})
it.each(['PREPARED', 'SIGNING', 'SIGNED'] as const)('never replaces unresolved %s with a different answer', async phase => {
  const f = await fixture(), next = await publicCommunityAcceptOperationFixture(id(7), '1')
  const signature = phase === 'SIGNED' ? (await signer.signTransaction(fromBase64(f.record.bytes))).signature : null
  f.store.write('x', { ...f.record, phase, signature })
  await expect(runPublicCommunityAcceptOperation({ intent: next.intent, prepared: next.record, store: f.store, adapter: f.adapter })).rejects.toThrow('RECOVERY_REQUIRED')
  expect(f.saved()?.bytes).toBe(f.record.bytes)
  expect(f.adapter.sign).not.toHaveBeenCalled(); expect(f.adapter.broadcast).not.toHaveBeenCalled()
})
