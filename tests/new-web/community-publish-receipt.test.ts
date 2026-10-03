import { expect, it, vi } from 'vitest'
import { bcs, TypeTagSerializer } from '@mysten/sui/bcs'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase64, fromHex, toBase58, toBase64 } from '@mysten/sui/utils'
import { blake2b } from '@noble/hashes/blake2.js'
import { PostV1Bcs, CommentV1Bcs, publicCommunityPublishCommitment, buildCreatePublicCommunityPostTx,
  buildCreatePublicCommunityCommentTx, type PublicCommunityPublishIntent, type PublicCommunityPublishOperation } from '@soulidity/sdk'
import { profileId as id, profileSigner as signer, profileDigest as digest } from './fixtures/public-profile-operation'
import { readCommunityPublicationResult } from '../../web/lib/community/publish-receipt'

async function fixture(kind: 'post' | 'comment' = 'post') {
  const common = { deployment: { profile: { originalPackageId: id(1), callablePackageId: id(2), registryId: id(3),
    chainIdentifier: '01010101' }, registryId: id(100) }, owner: signer.toSuiAddress(), authorId: id(4), operationId: 'a'.repeat(32) }
  const intent: PublicCommunityPublishIntent = kind === 'post'
    ? { ...common, kind, postType: 1, channel: 1, document: { schema: 'soulidity.public-post.v1', title: 'Question', content: 'Body', tags: [] } }
    : { ...common, kind, postId: id(5), document: { schema: 'soulidity.public-comment.v1', content: 'Reply' } }
  const commitment = await publicCommunityPublishCommitment(intent)
  const receipt = { schema: 'soulidity.community-upload.v1' as const, intentHash: commitment.intentHash,
    reference: { blobObjectId: id(7), blobId: 'A'.repeat(43), sha256: commitment.contentHash, byteLength: String(commitment.bytes.length) } }
  const template = (intent.kind === 'post'
    ? buildCreatePublicCommunityPostTx({ ...intent, document: receipt.reference, postType: 'question', channel: 'questions' })
    : buildCreatePublicCommunityCommentTx({ ...intent, document: receipt.reference })).getData()
  const tx = Transaction.from(JSON.stringify({ ...template, inputs: template.inputs.map(input => input.UnresolvedObject
    ? { Object: { SharedObject: { objectId: input.UnresolvedObject.objectId, initialSharedVersion: '1',
      mutable: input.UnresolvedObject.objectId === (intent.kind === 'post' ? intent.deployment.registryId : intent.postId) } } } : input) }))
  tx.setGasOwner(intent.owner); tx.setGasBudget('10000000'); tx.setGasPrice('1000')
  tx.setGasPayment([{ objectId: id(60), version: '1', digest }]); tx.setExpiration({ Epoch: '10' })
  const bytes = await tx.build()
  const record: PublicCommunityPublishOperation = { schema: 'soulidity.community-publish-operation.v1', intent, receipt,
    bytes: toBase64(bytes), digest: TransactionDataBuilder.getDigestFromBytes(bytes), expirationEpoch: '10', phase: 'SUCCEEDED', signature: null }
  const document = { blob_object_id: id(7), blob_id: Array(32).fill(0), sha256: [...fromHex(receipt.reference.sha256)], byte_length: receipt.reference.byteLength }
  const base = { id: id(101), version: '1', registry_id: id(100), profile_registry_id: id(3), author: id(4),
    author_owner: intent.owner, index: '2', document, created_at_ms: '1000' }
  const post = { ...base, post_type: 1, channel: 1, updated_at_ms: '1000', comment_count: '0',
    comments_by_index: { id: id(102), size: '0' }, accepted_comment_id: null as string | null, acceptance_revision: '0' }
  const comment = { ...base, post_id: id(5) }
  const type = `${id(1)}::community_posts::${kind === 'post' ? 'PostV1' : 'CommentV1'}`
  const object = bcs.Object.parse(bcs.Object.serialize({ data: { Move: { type: { Other: TypeTagSerializer.parseFromStr(type).struct! },
    hasPublicTransfer: false, version: '12', contents: new Uint8Array() } },
  owner: kind === 'post' ? { Shared: { initialSharedVersion: '12' } } : { Immutable: true },
  previousTransaction: record.digest, storageRebate: '0' }).toBytes())
  const effects = bcs.TransactionEffects.parse(bcs.TransactionEffects.serialize({ V2: {
    status: { Success: true }, executedEpoch: '9', gasUsed: { computationCost: '1', storageCost: '0', storageRebate: '0', nonRefundableStorageFee: '0' },
    transactionDigest: record.digest, gasObjectIndex: null, eventsDigest: null, dependencies: [], lamportVersion: '12',
    changedObjects: [[id(101), { inputState: { NotExist: true }, outputState: { ObjectWrite: [digest, object.owner] }, idOperation: { Created: true } }]],
    unchangedConsensusObjects: [], auxDataDigest: null,
  } }).toBytes())
  const row = { objectId: id(101), version: 12n, digest: '', previousTransaction: record.digest, objectType: type,
    owner: kind === 'post' ? { kind: 3, version: 12n } : { kind: 4, version: undefined as bigint | undefined },
    contents: { value: new Uint8Array() }, bcs: { value: new Uint8Array() } }
  const ledger = { digest: record.digest, transaction: { digest: record.digest, bcs: { value: fromBase64(record.bytes) } },
    effects: { transactionDigest: record.digest, bcs: { value: new Uint8Array() }, status: { success: true } }, checkpoint: 0n as bigint | undefined }
  const syncEffects = () => { ledger.effects.bcs.value = bcs.TransactionEffects.serialize(effects).toBytes() }
  const rehash = () => {
    row.contents.value = kind === 'post' ? PostV1Bcs.serialize(post).toBytes() : CommentV1Bcs.serialize(comment).toBytes()
    object.data.Move!.contents = row.contents.value
    row.bcs.value = bcs.Object.serialize(object).toBytes()
    row.digest = toBase58(blake2b(new Uint8Array([...new TextEncoder().encode('Object::'), ...row.bcs.value]), { dkLen: 32 }))
    effects.V2!.changedObjects[0][1].outputState.ObjectWrite![0] = row.digest
    syncEffects()
  }
  rehash()
  const client = { core: { getChainIdentifier: vi.fn(async () => ({ chainIdentifier: digest })),
    getObject: vi.fn(() => { throw Error('No current object') }) },
  ledgerService: { getTransaction: vi.fn(async () => ({ response: { transaction: ledger } })),
    getObject: vi.fn(async () => ({ response: { object: row } })) } }
  return { record, post, comment, object, effects, row, ledger, client, rehash, syncEffects,
    read: (signal?: AbortSignal) => readCommunityPublicationResult({ client: client as never, record, signal }) }
}

it.each(['post', 'comment'] as const)('proves %s from real PTB, V2 effects and full historical Object BCS', async kind => {
  const f = await fixture(kind)
  await expect(f.read()).resolves.toEqual({ kind, postId: kind === 'post' ? id(101) : id(5), commentId: kind === 'comment' ? id(101) : null, digest: f.record.digest })
  expect(f.client.ledgerService.getObject).toHaveBeenCalledWith(expect.objectContaining({ objectId: id(101), version: 12n }), expect.anything())
  expect(f.client.core.getObject).not.toHaveBeenCalled()
})
it('validates the full untrusted operation before any RPC', async () => {
  const f = await fixture(); f.record.intent.owner = id(999)
  await expect(f.read()).rejects.toThrow()
  expect(f.client.core.getChainIdentifier).not.toHaveBeenCalled()
})
it.each(['chain', 'bytes', 'digest', 'effects-digest', 'pending', 'checkpoint', 'status', 'epoch', 'trailing'] as const)('rejects %s transaction evidence', async field => {
  const f = await fixture()
  if (field === 'chain') f.client.core.getChainIdentifier.mockResolvedValue({ chainIdentifier: toBase58(new Uint8Array(32).fill(2)) })
  if (field === 'bytes') f.ledger.transaction.bcs.value[0] ^= 1
  if (field === 'digest') f.ledger.digest = digest
  if (field === 'effects-digest') f.effects.V2!.transactionDigest = digest
  if (field === 'pending') f.ledger.checkpoint = undefined
  if (field === 'checkpoint') f.ledger.checkpoint = -1n
  if (field === 'status') f.ledger.effects.status.success = false
  if (field === 'epoch') f.effects.V2!.executedEpoch = '11'
  f.syncEffects()
  if (field === 'trailing') f.ledger.effects.bcs.value = new Uint8Array([...f.ledger.effects.bcs.value, 0])
  await expect(f.read()).rejects.toThrow()
  expect(f.client.ledgerService.getObject).not.toHaveBeenCalled()
})
it.each(['absent', 'duplicate', 'mutated', 'owner'] as const)('rejects %s created output', async field => {
  const f = await fixture(), e = f.effects.V2!
  if (field === 'absent') e.changedObjects = []
  if (field === 'duplicate') e.changedObjects.push(structuredClone(e.changedObjects[0]))
  if (field === 'mutated') e.changedObjects[0][1].idOperation = { $kind: 'None', None: true }
  if (field === 'owner') e.changedObjects[0][1].outputState.ObjectWrite![1] = { $kind: 'Immutable', Immutable: true }
  f.syncEffects()
  await expect(f.read()).rejects.toThrow('CREATED_OUTPUT_NOT_UNIQUE')
})
it.each(['registry_id', 'profile_registry_id', 'author', 'author_owner'] as const)('rejects rehashed wrong %s', async field => {
  for (const kind of ['post', 'comment'] as const) {
    const f = await fixture(kind); (kind === 'post' ? f.post : f.comment)[field] = id(999); f.rehash()
    await expect(f.read()).rejects.toThrow('IDENTITY_MISMATCH')
  }
})
it.each(['blob_object_id', 'blob_id', 'sha256', 'byte_length'] as const)('rejects rehashed substituted document %s', async field => {
  const f = await fixture(), doc = f.post.document
  if (field === 'blob_object_id') doc.blob_object_id = id(999)
  if (field === 'blob_id' || field === 'sha256') doc[field][0] ^= 1
  if (field === 'byte_length') doc.byte_length = '1'
  f.rehash(); await expect(f.read()).rejects.toThrow('DOCUMENT_MISMATCH')
})
it.each(['post_type', 'channel', 'comment_count', 'table_size', 'accepted_comment_id', 'acceptance_revision', 'updated_at_ms', 'table_id'] as const)('rejects rehashed incorrect initial Post %s', async field => {
  const f = await fixture()
  if (field === 'post_type' || field === 'channel') f.post[field] = 0
  else if (field === 'accepted_comment_id') f.post.accepted_comment_id = id(999)
  else if (field === 'table_size') f.post.comments_by_index.size = '1'
  else if (field === 'table_id') f.post.comments_by_index.id = id(101)
  else f.post[field] = '1'
  f.rehash(); await expect(f.read()).rejects.toThrow('COMMUNITY_PUBLISH_RECEIPT_')
})
it('rejects rehashed wrong comment parent', async () => {
  const f = await fixture('comment'); f.comment.post_id = id(999); f.rehash()
  await expect(f.read()).rejects.toThrow('COMMENT_PARENT_OR_OWNER_MISMATCH')
})
it('rejects contents relabelled with a genuine effects digest', async () => {
  const f = await fixture(); f.post.author = id(999); f.row.contents.value = PostV1Bcs.serialize(f.post).toBytes()
  await expect(f.read()).rejects.toThrow('HISTORICAL_OBJECT_BCS_OBJECT_MISMATCH')
})
it('rejects full object BCS tampering without recomputing its effects digest', async () => {
  const f = await fixture(); f.object.storageRebate = '99'; f.row.bcs.value = bcs.Object.serialize(f.object).toBytes()
  await expect(f.read()).rejects.toThrow('HISTORICAL_OBJECT_BCS_DIGEST_MISMATCH')
})
it('rejects a latest-version object in place of the exact historical output', async () => {
  const f = await fixture(); f.row.version = 13n
  await expect(f.read()).rejects.toThrow('HISTORICAL_OBJECT_REFERENCE_MISMATCH')
})
it('requires the created Post shared birth version to equal its effects version', async () => {
  const f = await fixture(); f.object.owner.Shared!.initialSharedVersion = '11'; f.row.owner.version = 11n
  f.effects.V2!.changedObjects[0][1].outputState.ObjectWrite![1].Shared!.initialSharedVersion = '11'
  f.rehash(); await expect(f.read()).rejects.toThrow('POST_CATEGORY_OR_OWNER_MISMATCH')
})
it('rejects a rehashed wrong Move type despite genuine object digest', async () => {
  const f = await fixture(); f.object.data.Move!.type.Other!.name = 'Wrong'; f.rehash()
  await expect(f.read()).rejects.toThrow('HISTORICAL_OBJECT_BCS_OBJECT_MISMATCH')
})
it('rejects a purported creation with an existing input lifetime', async () => {
  const f = await fixture()
  f.effects.V2!.changedObjects[0][1].inputState = { $kind: 'Exist', Exist: [['11', digest], f.object.owner] }
  f.syncEffects(); await expect(f.read()).rejects.toThrow('HISTORICAL_OBJECT_INVALID_LINEAGE')
})
it('rejects terminal lookup failure and never falls back to the local SUCCEEDED phase', async () => {
  const f = await fixture()
  f.client.ledgerService.getTransaction.mockRejectedValue(Object.assign(Error('Unavailable'), { code: 'NOT_FOUND' }))
  await expect(f.read()).rejects.toThrow('Unavailable')
  expect(f.client.ledgerService.getObject).not.toHaveBeenCalled()
})
it('honors an already aborted request without network calls', async () => {
  const f = await fixture(), controller = new AbortController(); controller.abort()
  await expect(f.read(controller.signal)).rejects.toThrow()
  expect(f.client.core.getChainIdentifier).not.toHaveBeenCalled()
})
