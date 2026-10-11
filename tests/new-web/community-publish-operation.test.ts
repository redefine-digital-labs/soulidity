import { expect, it, vi } from 'vitest'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { verifyTransactionSignature } from '@mysten/sui/verify'
import { profileId as id, profileSigner as signer, profileDigest as digest } from './fixtures/public-profile-operation'
import { publicCommunityPublishCommitment, type PublicCommunityPublishIntent } from '../../packages/soulidity-sdk/src/community-publish-intent'
import { buildCreatePublicCommunityPostTx, buildCreatePublicCommunityCommentTx } from '../../packages/soulidity-sdk/src/community-posts-write'
import { parsePublicCommunityPublishOperation, runPublicCommunityPublishOperation, publicCommunityPublishOperationKey,
  PublicCommunityPublishPersistenceError, type PublicCommunityPublishOperation, type PublicCommunityPublishOperationStore,
  type PublicCommunityPublishOperationAdapter } from '../../packages/soulidity-sdk/src/community-publish-operation'

async function fixture(kind: 'post' | 'comment' = 'post') {
  const common = { deployment: { profile: { originalPackageId: id(1), callablePackageId: id(2), registryId: id(3),
    chainIdentifier: '01010101' }, registryId: id(100) }, owner: signer.toSuiAddress(), authorId: id(4), operationId: 'a'.repeat(32) }
  const intent: PublicCommunityPublishIntent = kind === 'post'
    ? { ...common, kind, postType: 1, channel: 1, document: { schema: 'soulidity.public-post.v1', title: 'Question', content: 'Body', tags: [] } }
    : { ...common, kind, postId: id(5), document: { schema: 'soulidity.public-comment.v1', content: 'Reply' } }
  const c = await publicCommunityPublishCommitment(intent)
  const receipt = { schema: 'soulidity.community-upload.v1' as const, intentHash: c.intentHash,
    reference: { blobObjectId: id(7), blobId: 'A'.repeat(43), sha256: c.contentHash, byteLength: String(c.bytes.length) } }
  const template = (intent.kind === 'post'
    ? buildCreatePublicCommunityPostTx({ ...intent, document: receipt.reference, postType: 'question', channel: 'questions' })
    : buildCreatePublicCommunityCommentTx({ ...intent, document: receipt.reference })).getData()
  const mutableId = intent.kind === 'post' ? intent.deployment.registryId : intent.postId
  const tx = Transaction.from(JSON.stringify({ ...template, inputs: template.inputs.map(input => input.UnresolvedObject
    ? { Object: { SharedObject: { objectId: input.UnresolvedObject.objectId, initialSharedVersion: '1',
      mutable: input.UnresolvedObject.objectId === mutableId } } } : input) }))
  tx.setGasOwner(intent.owner); tx.setGasBudget('10000000'); tx.setGasPrice('1000')
  tx.setGasPayment([{ objectId: id(60), version: '1', digest }]); tx.setExpiration({ Epoch: '10' })
  const bytes = await tx.build()
  const record: PublicCommunityPublishOperation = { schema: 'soulidity.community-publish-operation.v1', intent, receipt,
    bytes: toBase64(bytes), digest: TransactionDataBuilder.getDigestFromBytes(bytes), expirationEpoch: '10', phase: 'PREPARED', signature: null }
  let saved: PublicCommunityPublishOperation | null = null, submitted = false, locked = false
  const events: string[] = []
  const store: PublicCommunityPublishOperationStore = {
    exclusive: async (_key, run) => { if (locked) throw new Error('busy'); locked = true; try { return await run() } finally { locked = false } },
    read: () => structuredClone(saved), write: (_key, value) => { saved = structuredClone(value); events.push('persist:' + value.phase) },
  }
  const adapter: PublicCommunityPublishOperationAdapter = {
    query: vi.fn(async () => { events.push('query'); return submitted ? 'SUCCEEDED' : 'MISSING' }),
    preflight: vi.fn(async (_record, signing) => { events.push('preflight:' + signing) }),
    sign: vi.fn(async r => { events.push('sign'); return signer.signTransaction(fromBase64(r.bytes)) }),
    verifySignature: vi.fn(async r => { events.push('verify'); await verifyTransactionSignature(fromBase64(r.bytes), r.signature!, { address: r.intent.owner }) }),
    broadcast: vi.fn(async () => { events.push('broadcast'); submitted = true }),
  }
  const run = (prepared = false, options = {}) => runPublicCommunityPublishOperation({ intent, store, adapter, ...(prepared ? { prepared: record } : {}), ...options })
  return { intent, receipt, record, tx, store, adapter, run, events, saved: () => saved }
}
it.each(['post', 'comment'] as const)('validates and executes real %s PTB with durable ordered recovery', async kind => {
  const f = await fixture(kind)
  expect(await parsePublicCommunityPublishOperation(f.record)).toEqual(f.record)
  expect((await f.run(true)).phase).toBe('SUCCEEDED')
  expect(f.events).toEqual(['persist:PREPARED', 'query', 'preflight:true', 'persist:SIGNING', 'sign', 'verify',
    'persist:SIGNED', 'preflight:false', 'verify', 'broadcast', 'query', 'persist:SUCCEEDED'])
  await expect(f.run(true)).rejects.toThrow('RECOVERY_REQUIRED')
})
it('freezes a detached canonical intent and release/wallet/operation key', async () => {
  const f = await fixture(), input = structuredClone(f.record)
  const parsing = parsePublicCommunityPublishOperation(input); input.intent.document.content = 'Changed'
  const result = await parsing
  expect(result.intent.document.content).toBe('Body')
  expect(Object.isFrozen(result.intent.document)).toBe(true)
  const key = publicCommunityPublishOperationKey(f.intent)
  for (const change of ['owner', 'operationId', 'release']) {
    const intent = structuredClone(f.intent)
    if (change === 'owner') intent.owner = id(999)
    else if (change === 'operationId') intent.operationId = 'b'.repeat(32)
    else intent.deployment.profile.callablePackageId = id(999)
    expect(publicCommunityPublishOperationKey(intent)).not.toBe(key)
  }
})
it.each(['post', 'comment'] as const)('rejects rehashed %s PTB role/argument/command attacks', async kind => {
  const f = await fixture(kind)
  for (const mutation of ['package', 'accept', 'extra-call', 'transfer-result', 'type', 'order', 'pure', 'registry-role',
    'profile-role', 'clock-role', 'object-id', 'shared-version', 'gas-owner', 'gas-overlap', 'gas-duplicate', 'expiry', 'trailing']) {
    const record = structuredClone(f.record), data = f.tx.getData(), call = data.commands[0].MoveCall!
    if (mutation === 'package') call.package = id(999)
    if (mutation === 'accept') call.function = 'accept_answer'
    if (mutation === 'extra-call') data.commands.push(data.commands[0])
    if (mutation === 'transfer-result') data.commands.push({ $kind: 'TransferObjects', TransferObjects: {
      objects: [{ $kind: 'Result', Result: 0 }], address: { $kind: 'Input', Input: kind === 'post' ? 2 : 3 } } })
    if (mutation === 'type') call.typeArguments.push('0x2::sui::SUI')
    if (mutation === 'order') [call.arguments[0], call.arguments[1]] = [call.arguments[1], call.arguments[0]]
    if (mutation === 'pure') data.inputs[kind === 'post' ? 2 : 3].Pure!.bytes = toBase64(new Uint8Array(32))
    if (mutation === 'registry-role') data.inputs[0].Object!.SharedObject!.mutable = kind !== 'post'
    if (mutation === 'profile-role') data.inputs[1].Object!.SharedObject!.mutable = true
    if (mutation === 'clock-role') data.inputs.at(-1)!.Object!.SharedObject!.mutable = true
    if (mutation === 'object-id') data.inputs[0].Object!.SharedObject!.objectId = id(999)
    if (mutation === 'shared-version') data.inputs[0].Object!.SharedObject!.initialSharedVersion = '0'
    if (mutation === 'gas-owner') data.gasData.owner = id(999)
    if (mutation === 'gas-overlap') data.gasData.payment![0].objectId = id(100)
    if (mutation === 'gas-duplicate') data.gasData.payment!.push(data.gasData.payment![0])
    if (mutation === 'expiry') data.expiration = { $kind: 'Epoch', Epoch: '11' }
    const bytes = mutation === 'trailing' ? new Uint8Array([...fromBase64(record.bytes), 0]) : await Transaction.from(JSON.stringify(data)).build()
    record.bytes = toBase64(bytes); record.digest = TransactionDataBuilder.getDigestFromBytes(bytes)
    await expect(parsePublicCommunityPublishOperation(record), mutation).rejects.toThrow()
  }
})
it.each(['content', 'blob', 'intentHash', 'operation', 'parent', 'extra'])('rejects receipt or frozen intent substitution: %s', async mutation => {
  const f = await fixture('comment'), record = structuredClone(f.record)
  if (mutation === 'content') record.intent.document.content = 'Other'
  if (mutation === 'blob') record.receipt.reference.blobObjectId = id(999)
  if (mutation === 'intentHash') record.receipt.intentHash = '0'.repeat(64)
  if (mutation === 'operation') record.intent.operationId = 'b'.repeat(32)
  if (mutation === 'parent' && record.intent.kind === 'comment') record.intent.postId = id(999)
  if (mutation === 'extra') Object.assign(record, { injected: true })
  await expect(parsePublicCommunityPublishOperation(record)).rejects.toThrow()
})
it.each(['PREPARED', 'SIGNING', 'SIGNED'])('preserves exportable evidence after %s persistence failure', async phase => {
  const f = await fixture(), original = f.store.write
  f.store.write = (key, record) => { if (record.phase === phase) throw new Error('quota'); original(key, record) }
  const failure = await f.run(true).catch(error => error)
  expect(failure).toBeInstanceOf(PublicCommunityPublishPersistenceError)
  expect(f.adapter.broadcast).not.toHaveBeenCalled()
  if (phase !== 'SIGNED') expect(f.adapter.sign).not.toHaveBeenCalled()
  else {
    expect(f.saved()?.phase).toBe('SIGNING')
    await verifyTransactionSignature(fromBase64(failure.record.bytes), failure.record.signature, { address: f.intent.owner })
    const exported = failure.record; exported.signature = null; expect(failure.record.signature).not.toBeNull()
  }
})
it('recovers uncertain broadcast using the exact signed bytes and receipt', async () => {
  const f = await fixture('comment')
  vi.mocked(f.adapter.broadcast).mockRejectedValueOnce(new Error('unknown'))
  await expect(f.run(true)).rejects.toThrow('unknown')
  const saved = f.saved()!
  await expect(f.run(true)).rejects.toThrow('RECOVERY_REQUIRED')
  await f.run()
  expect(f.adapter.sign).toHaveBeenCalledOnce()
  expect(vi.mocked(f.adapter.broadcast).mock.calls[1][0]).toEqual(saved)
})
it('does not cancel or replace unknown signing and query-only has no side effects', async () => {
  const f = await fixture()
  vi.mocked(f.adapter.sign).mockRejectedValueOnce(new Error('unknown'))
  await expect(f.run(true)).rejects.toThrow('unknown')
  await expect(f.run(false, { cancelUnsigned: true })).rejects.toThrow('CANNOT_DISCARD_SIGNED')
  await expect(f.run(true)).rejects.toThrow('RECOVERY_REQUIRED')
  await f.run(false, { queryOnly: true })
  expect(f.adapter.sign).toHaveBeenCalledOnce(); expect(f.adapter.broadcast).not.toHaveBeenCalled()
})
it('never signs with pending or invalid query evidence', async () => {
  const f = await fixture(); f.store.write('key', f.record)
  vi.mocked(f.adapter.query).mockResolvedValueOnce('PENDING')
  await f.run(); expect(f.adapter.sign).not.toHaveBeenCalled()
  vi.mocked(f.adapter.query).mockResolvedValueOnce('UNKNOWN' as any)
  await expect(f.run()).rejects.toThrow('QUERY_INVALID'); expect(f.adapter.sign).not.toHaveBeenCalled()
})
it.each(['changed-bytes', 'invalid-signature'])('rejects wallet %s', async mutation => {
  const f = await fixture()
  vi.mocked(f.adapter.sign).mockResolvedValue({ bytes: mutation === 'changed-bytes' ? 'AA==' : f.record.bytes, signature: 'invalid' })
  await expect(f.run(true)).rejects.toThrow(); expect(f.adapter.broadcast).not.toHaveBeenCalled()
})
it.each(['content', 'parent', 'author'])('refuses cancelled operation identity reuse with changed %s', async mutation => {
  const f = await fixture('comment'), original = { ...f.record, phase: 'CANCELLED' as const }
  const changed = structuredClone(f.record)
  if (mutation === 'content') changed.intent.document.content = 'Changed'
  if (mutation === 'parent' && changed.intent.kind === 'comment') changed.intent.postId = id(99)
  if (mutation === 'author') changed.intent.authorId = id(99)
  const commitment = await publicCommunityPublishCommitment(changed.intent)
  changed.receipt.intentHash = commitment.intentHash
  changed.receipt.reference.sha256 = commitment.contentHash
  changed.receipt.reference.byteLength = String(commitment.bytes.length)
  if (changed.intent.kind !== 'comment') throw new Error('fixture')
  const template = buildCreatePublicCommunityCommentTx({ ...changed.intent, document: changed.receipt.reference }).getData()
  const data = f.tx.getData()
  data.inputs = template.inputs.map(input => input.UnresolvedObject
    ? { Object: { SharedObject: { objectId: input.UnresolvedObject.objectId, initialSharedVersion: '1',
      mutable: input.UnresolvedObject.objectId === (changed.intent as { postId: string }).postId } } } as typeof data.inputs[number] : input)
  const bytes = await Transaction.from(JSON.stringify(data)).build()
  changed.bytes = toBase64(bytes); changed.digest = TransactionDataBuilder.getDigestFromBytes(bytes)
  f.store.write('key', original)
  await expect(runPublicCommunityPublishOperation({ intent: changed.intent, prepared: changed, store: f.store, adapter: f.adapter }))
    .rejects.toThrow('INTENT_MISMATCH')
  expect(f.adapter.sign).not.toHaveBeenCalled(); expect(f.saved()).toEqual(original)
})
