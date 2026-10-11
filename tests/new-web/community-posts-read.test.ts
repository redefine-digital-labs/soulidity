import { expect, it, vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { deriveDynamicFieldID, normalizeStructTag, toBase58 } from '@mysten/sui/utils'
import { CommunityRegistryV1Bcs, PostV1Bcs, CommentV1Bcs, readPublicCommunityPost,
  readPublicCommunityComment, readPublicCommunityPostDirectory, readPublicCommunityCommentDirectory,
  type PublicCommunityReadClient } from '../../packages/soulidity-sdk/src/community-posts-read'
import { ProfileRegistryV1Bcs, WalletProfileV1Bcs } from '../../packages/soulidity-sdk/src/wallet-profile'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const digest = toBase58(new Uint8Array(32).fill(1))
const shared = { kind: 3, version: 1n }
// These are raw ABI fixtures, not a live-network or publication proof.
function fixture() {
  const deployment = { profile: { originalPackageId: id(1), callablePackageId: id(2), registryId: id(3), chainIdentifier: '01010101' }, registryId: id(4) }
  const registry = { id: id(4), version: '1', post_count: '1', by_index: { id: id(5), size: '1' } }
  const document = { blob_object_id: id(90), blob_id: new Uint8Array(32).fill(2), sha256: new Uint8Array(32).fill(3), byte_length: '80' }
  const post = { id: id(6), version: '1', registry_id: id(4), profile_registry_id: id(3), author: id(7), author_owner: id(8), index: '0',
    post_type: 1, channel: 1, document, created_at_ms: '10', updated_at_ms: '20', comment_count: '1',
    comments_by_index: { id: id(9), size: '1' }, accepted_comment_id: id(10) as string | null, acceptance_revision: '1' }
  const comment = { id: id(10), version: '1', registry_id: id(4), profile_registry_id: id(3), post_id: id(6), author: id(7),
    author_owner: id(8), index: '0', document, created_at_ms: '20' }
  const rows = new Map<string, any>(), profiles = new Map<string, any>()
  const raw = (objectId: string, objectType: string, content: Uint8Array, owner: any) => ({ objectId, objectType, contents: { value: content }, owner, version: 1n, digest })
  const type = (name: string) => `${deployment.profile.originalPackageId}::community_posts::${name}`
  const putRegistry = () => rows.set(registry.id, raw(registry.id, type('CommunityRegistryV1'), CommunityRegistryV1Bcs.serialize(registry).toBytes(), structuredClone(shared)))
  const putPost = () => rows.set(post.id, raw(post.id, type('PostV1'), PostV1Bcs.serialize(post).toBytes(), structuredClone(shared)))
  const putComment = () => rows.set(comment.id, raw(comment.id, type('CommentV1'), CommentV1Bcs.serialize(comment).toBytes(), { kind: 4 }))
  const Field = bcs.struct('Field', { id: bcs.Address, name: bcs.u64(), value: bcs.Address })
  const putField = (parent: string, name: string, value: string) => {
    const fieldId = deriveDynamicFieldID(parent, 'u64', bcs.u64().serialize(name).toBytes())
    rows.set(fieldId, raw(fieldId, normalizeStructTag('0x2::dynamic_field::Field<u64,0x2::object::ID>'),
      Field.serialize({ id: fieldId, name, value }).toBytes(), { kind: 2, address: parent }))
    return fieldId
  }
  putRegistry(); putPost(); putComment()
  const postField = putField(registry.by_index.id, post.index, post.id), commentField = putField(post.comments_by_index.id, comment.index, comment.id)
  const coreObject = (objectId: string, type: string, content: Uint8Array, owner: any) => ({ objectId, type, content, owner, digest, version: '1' })
  const pr = { id: id(3), version: '1', profile_count: '1', by_owner: { id: id(11), size: '1' },
    by_handle: { id: id(12), size: '1' }, by_index: { id: id(13), size: '1' } }
  profiles.set(id(3), coreObject(id(3), `${id(1)}::profile::ProfileRegistryV1`, ProfileRegistryV1Bcs.serialize(pr).toBytes(),
    { $kind: 'Shared', Shared: { initialSharedVersion: '1' } }))
  profiles.set(id(7), coreObject(id(7), `${id(1)}::profile::WalletProfileV1`, WalletProfileV1Bcs.serialize({ id: id(7), version: '1', registry_id: id(3),
    owner: id(8), revision: '0', handle: 'alice', metadata: document, created_at_ms: '1', updated_at_ms: '1' }).toBytes(),
  { $kind: 'AddressOwner', AddressOwner: id(8) }))
  const ownerField = deriveDynamicFieldID(id(11), 'address', bcs.Address.serialize(id(8)).toBytes())
  profiles.set(ownerField, coreObject(ownerField, normalizeStructTag('0x2::dynamic_field::Field<address,0x2::object::ID>'),
    bcs.struct('OwnerField', { id: bcs.Address, name: bcs.Address, value: bcs.Address }).serialize({ id: ownerField, name: id(8), value: id(7) }).toBytes(),
    { $kind: 'ObjectOwner', ObjectOwner: id(11) }))
  const getObject = vi.fn(async ({ objectId }: { objectId: string }) => {
    if (!rows.has(objectId)) throw Object.assign(new Error('not found'), { code: 'NOT_FOUND' })
    return { response: { object: structuredClone(rows.get(objectId)) } }
  })
  const core = { getChainIdentifier: vi.fn(async () => ({ chainIdentifier: digest })),
    getObject: vi.fn(async ({ objectId }: { objectId: string }) => {
      if (!profiles.has(objectId)) throw new Error('profile missing')
      return { object: structuredClone(profiles.get(objectId)) }
    }), listOwnedObjects: vi.fn() }
  const client = { core, ledgerService: { getObject } } as unknown as PublicCommunityReadClient
  const readPost = (signal?: AbortSignal) => readPublicCommunityPost({ client, deployment, postId: post.id, signal })
  const readComment = (signal?: AbortSignal) => readPublicCommunityComment({ client, deployment, postId: post.id, commentId: comment.id, signal })
  return { deployment, registry, post, comment, rows, profiles, ownerField, core, client, getObject, postField, commentField,
    putRegistry, putPost, putComment, putField, readPost, readComment }
}
it('reads raw exact Post, its accepted Comment, and registered actual author; rechecks mutable authorities', async () => {
  const f = fixture(), value = await f.readPost()
  expect(value).toMatchObject({ id: f.post.id, postType: 'question', channel: 'questions', author: { id: id(7), owner: id(8) },
    commentCount: '1', acceptanceRevision: '1', document: { byteLength: '80' }, acceptedComment: { id: f.comment.id, postId: f.post.id },
    registryVersion: '1', objectVersion: '1', observedPostCount: '1' })
  expect(f.getObject.mock.calls.filter(([arg]) => arg.objectId === f.registry.id)).toHaveLength(2)
  expect(f.getObject.mock.calls.filter(([arg]) => arg.objectId === f.post.id)).toHaveLength(2)
  expect(await f.readComment()).toMatchObject({ accepted: true, comment: { id: f.comment.id }, post: { id: f.post.id } })
})
it('accepts ordinary non-question posts, no answer, and legal >1MiB/u64 reference values without inventing availability', async () => {
  const f = fixture(); f.post.post_type = 2; f.post.channel = 0; f.post.accepted_comment_id = null; f.post.acceptance_revision = '0'
  f.post.document.byte_length = '18446744073709551615'; f.putPost()
  expect(await f.readPost()).toMatchObject({ postType: 'knowledge', channel: 'general', acceptedComment: null,
    document: { byteLength: '18446744073709551615' } })
  expect(await f.readComment()).toMatchObject({ accepted: false })
})
it.each(['registry', 'post', 'comment', 'postField', 'commentField'])('missing %s is an error, never an empty result', async target => {
  const f = fixture(); f.rows.delete(target === 'registry' ? f.registry.id : target === 'post' ? f.post.id
    : target === 'comment' ? f.comment.id : target === 'postField' ? f.postField : f.commentField)
  await expect(f.readPost()).rejects.toThrow('not found')
})
it.each(['wrongChain', 'missingResponse', 'transport', 'profileOwner', 'registration', 'authorOwner'])('rejects %s', async variant => {
  const f = fixture()
  if (variant === 'wrongChain') f.core.getChainIdentifier.mockResolvedValue({ chainIdentifier: toBase58(new Uint8Array(32).fill(9)) })
  if (variant === 'missingResponse') f.getObject.mockResolvedValueOnce({ response: {} } as any)
  if (variant === 'transport') f.getObject.mockRejectedValueOnce(new Error('offline'))
  if (variant === 'profileOwner') f.profiles.get(id(7)).owner.AddressOwner = id(99)
  if (variant === 'registration') f.profiles.delete(f.ownerField)
  if (variant === 'authorOwner') { f.post.author_owner = id(99); f.putPost() }
  await expect(f.readPost()).rejects.toThrow()
  if (variant === 'wrongChain') expect(f.getObject).not.toHaveBeenCalled()
})
it.each(['id', 'type', 'zeroVersion', 'overflowVersion', 'digest', 'owner', 'sharedVersion', 'trailing', 'uid', 'schema', 'counts', 'namespace'])('rejects registry %s', async variant => {
  const f = fixture(), raw = f.rows.get(f.registry.id)
  if (variant === 'id') raw.objectId = id(99)
  if (variant === 'type') raw.objectType = `${id(99)}::community_posts::CommunityRegistryV1`
  if (variant === 'zeroVersion') raw.version = 0n
  if (variant === 'overflowVersion') raw.version = 18446744073709551616n
  if (variant === 'digest') raw.digest = 'abc'
  if (variant === 'owner') raw.owner = { kind: 4 }
  if (variant === 'sharedVersion') raw.owner.version = 0n
  if (variant === 'trailing') raw.contents.value = new Uint8Array([...raw.contents.value, 0])
  if (variant === 'uid') { raw.contents.value.set(bcs.Address.serialize(id(99)).toBytes()) }
  if (variant === 'schema') { f.registry.version = '2'; f.putRegistry() }
  if (variant === 'counts') { f.registry.post_count = '2'; f.putRegistry() }
  if (variant === 'namespace') { f.registry.by_index.id = f.deployment.profile.registryId; f.putRegistry() }
  await expect(f.readPost()).rejects.toThrow()
})
it.each(['type', 'owner', 'uid', 'schema', 'registry', 'profileRegistry', 'index', 'count', 'namespace', 'category', 'channel',
  'time', 'emptyTime', 'answerType', 'answerRevision', 'absentRevision', 'documentId', 'blob', 'hash', 'length', 'trailing'])('rejects Post %s', async variant => {
  const f = fixture()
  if (variant === 'uid') f.post.id = id(99)
  if (variant === 'schema') f.post.version = '2'
  if (variant === 'registry') f.post.registry_id = id(99)
  if (variant === 'profileRegistry') f.post.profile_registry_id = id(99)
  if (variant === 'index') f.post.index = '1'
  if (variant === 'count') f.post.comment_count = '2'
  if (variant === 'namespace') f.post.comments_by_index.id = f.registry.by_index.id
  if (variant === 'category') f.post.post_type = 3
  if (variant === 'channel') f.post.channel = 2
  if (variant === 'time') f.post.updated_at_ms = '9'
  if (variant === 'emptyTime') { f.post.comment_count = '0'; f.post.comments_by_index.size = '0'; f.post.accepted_comment_id = null; f.post.acceptance_revision = '0' }
  if (variant === 'answerType') f.post.post_type = 0
  if (variant === 'answerRevision') f.post.acceptance_revision = '0'
  if (variant === 'absentRevision') f.post.accepted_comment_id = null
  if (variant === 'documentId') f.post.document.blob_object_id = id(0)
  if (variant === 'blob') f.post.document.blob_id = new Uint8Array(31)
  if (variant === 'hash') f.post.document.sha256 = new Uint8Array(31)
  if (variant === 'length') f.post.document.byte_length = '0'
  f.putPost()
  const raw = f.rows.get(f.post.id)
  if (variant === 'type') raw.objectType = `${id(99)}::community_posts::PostV1`
  if (variant === 'owner') raw.owner = { kind: 4 }
  if (variant === 'trailing') raw.contents.value = new Uint8Array([...raw.contents.value, 0])
  await expect(f.readPost()).rejects.toThrow()
})
it.each(['parent', 'registry', 'profileRegistry', 'index', 'timeBefore', 'timeAfter', 'latestTime', 'owner', 'type', 'trailing', 'author'])('rejects accepted Comment %s', async variant => {
  const f = fixture()
  if (variant === 'parent') f.comment.post_id = id(99)
  if (variant === 'registry') f.comment.registry_id = id(99)
  if (variant === 'profileRegistry') f.comment.profile_registry_id = id(99)
  if (variant === 'index') f.comment.index = '1'
  if (variant === 'timeBefore') f.comment.created_at_ms = '9'
  if (variant === 'timeAfter') f.comment.created_at_ms = '21'
  if (variant === 'latestTime') f.comment.created_at_ms = '19'
  if (variant === 'author') f.comment.author_owner = id(99)
  f.putComment(); const raw = f.rows.get(f.comment.id)
  if (variant === 'owner') raw.owner = structuredClone(shared)
  if (variant === 'type') raw.objectType = `${id(99)}::community_posts::CommentV1`
  if (variant === 'trailing') raw.contents.value = new Uint8Array([...raw.contents.value, 0])
  await expect(f.readPost()).rejects.toThrow()
})
it.each(['postField', 'commentField'])('rejects all substitutions of %s', async target => {
  for (const variant of ['owner', 'type', 'uid', 'name', 'value', 'trailing']) {
    const f = fixture(), raw = f.rows.get(f[target as 'postField' | 'commentField'])
    if (variant === 'owner') raw.owner.address = id(99)
    if (variant === 'type') raw.objectType = normalizeStructTag('0x2::dynamic_field::Field<address,0x2::object::ID>')
    if (variant === 'uid') raw.contents.value.set(bcs.Address.serialize(id(99)).toBytes(), 0)
    if (variant === 'name') raw.contents.value.set(bcs.u64().serialize('1').toBytes(), 32)
    if (variant === 'value') raw.contents.value.set(bcs.Address.serialize(id(99)).toBytes(), 40)
    if (variant === 'trailing') raw.contents.value = new Uint8Array([...raw.contents.value, 0])
    await expect(f.readPost()).rejects.toThrow()
  }
})
it.each(['registry', 'post'])('rejects concurrent %s drift', async target => {
  const f = fixture(), original = f.getObject.getMockImplementation()!; let reads = 0
  f.getObject.mockImplementation(async args => {
    if (args.objectId === f[target as 'post' | 'registry'].id && ++reads === 2) f.rows.get(args.objectId).version = 2n
    return original(args)
  })
  await expect(f.readPost()).rejects.toThrow('COMMUNITY_CHANGED_RETRY')
})
it('preserves u64 counts/indices above the safe JS integer boundary with exact membership', async () => {
  const f = fixture()
  f.registry.post_count = f.registry.by_index.size = '18446744073709551615'
  f.post.index = '18446744073709551614'
  f.post.comment_count = f.post.comments_by_index.size = '18446744073709551615'
  f.comment.index = '18446744073709551614'
  f.putRegistry(); f.putPost(); f.putComment()
  f.putField(f.registry.by_index.id, f.post.index, f.post.id)
  f.putField(f.post.comments_by_index.id, f.comment.index, f.comment.id)
  expect(await f.readComment()).toMatchObject({ comment: { index: '18446744073709551614' },
    post: { index: '18446744073709551614', commentCount: '18446744073709551615', observedPostCount: '18446744073709551615' } })
})
it('derives requested-comment acceptance from the Post when a different valid Comment is selected', async () => {
  const f = fixture(); f.post.comment_count = f.post.comments_by_index.size = '2'; f.post.updated_at_ms = '30'; f.putPost()
  f.comment.id = id(15); f.comment.index = '1'; f.comment.created_at_ms = '30'; f.putComment()
  f.putField(f.post.comments_by_index.id, '1', id(15))
  expect(await f.readComment()).toMatchObject({ accepted: false, comment: { id: id(15) },
    post: { acceptedComment: { id: id(10) }, acceptanceRevision: '1' } })
})
it('captures deployment before awaiting, and aborts ignored/hanging transport', async () => {
  const f = fixture(), original = f.core.getChainIdentifier.getMockImplementation()!
  f.core.getChainIdentifier.mockImplementationOnce(async () => { f.deployment.registryId = id(99); return original() })
  expect(await f.readPost()).toMatchObject({ registryId: id(4) })
  f.deployment.registryId = id(4)
  const controller = new AbortController()
  f.getObject.mockImplementationOnce(() => new Promise(() => {}))
  const reading = f.readPost(controller.signal); await Promise.resolve(); controller.abort(new Error('cancelled'))
  await expect(reading).rejects.toThrow('cancelled')
})
it('bounds a transport ignoring cancellation to 15 seconds', async () => {
  vi.useFakeTimers()
  const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
    const controller = new AbortController(); setTimeout(() => controller.abort(new Error('timeout')), ms); return controller.signal
  })
  try {
    const f = fixture(); f.getObject.mockImplementationOnce(() => new Promise(() => {}))
    const pending = expect(f.readPost()).rejects.toThrow('timeout')
    await vi.advanceTimersByTimeAsync(15000); await pending
  } finally { timeout.mockRestore(); vi.useRealTimers() }
})

function directoryFixture(kind: 'post' | 'comment', count = 3) {
  const f = fixture(), parent = kind === 'post' ? f.registry.by_index.id : f.post.comments_by_index.id
  if (kind === 'post') { f.registry.post_count = f.registry.by_index.size = String(count); f.putRegistry() }
  else {
    f.post.comment_count = f.post.comments_by_index.size = String(count)
    f.post.accepted_comment_id = null; f.post.acceptance_revision = '0'
    if (!count) f.post.updated_at_ms = f.post.created_at_ms
    f.putPost()
  }
  const entryIds = Array.from({ length: count }, (_, index) => id(index + 1000))
  entryIds.forEach((entryId, index) => f.putField(parent, String(index), entryId))
  const readDirectory = (options: { startIndex?: string; upperBound?: string; limit?: number; signal?: AbortSignal } = {}) =>
    kind === 'post' ? readPublicCommunityPostDirectory({ client: f.client, deployment: f.deployment, ...options })
      : readPublicCommunityCommentDirectory({ client: f.client, deployment: f.deployment, postId: f.post.id, ...options })
  return { ...f, parent, entryIds, readDirectory }
}
it.each(['post', 'comment'] as const)('reads exact ordered %s IDs with explicit per-page coverage and no hydration', async kind => {
  const f = directoryFixture(kind)
  expect(await f.readDirectory({ limit: 2 })).toMatchObject({ entries: [
    { id: id(1000), index: '0' }, { id: id(1001), index: '1' }], observedCount: '3', upperBound: '3', nextIndex: '2', partial: true })
  expect(await f.readDirectory({ startIndex: '2', upperBound: '3', limit: 2 })).toMatchObject({
    entries: [{ id: id(1002), index: '2' }], nextIndex: null, partial: true })
  expect(await f.readDirectory()).toMatchObject({ entries: f.entryIds.map((entryId, index) => ({ id: entryId, index: String(index) })), partial: false })
  expect(f.getObject.mock.calls.some(([arg]) => f.entryIds.includes(arg.objectId))).toBe(false)
})
it.each(['post', 'comment'] as const)('preserves %s upper bound across later inserts and marks newly observed entries partial', async kind => {
  const f = directoryFixture(kind)
  const first = await f.readDirectory({ limit: 2 })
  if (kind === 'post') { f.registry.post_count = f.registry.by_index.size = '4'; f.putRegistry() }
  else { f.post.comment_count = f.post.comments_by_index.size = '4'; f.putPost() }
  f.putField(f.parent, '3', id(1003))
  expect(await f.readDirectory({ startIndex: first.nextIndex!, upperBound: first.upperBound })).toMatchObject({
    entries: [{ id: id(1002), index: '2' }], observedCount: '4', upperBound: '3', nextIndex: null, partial: true })
})
it.each(['post', 'comment'] as const)('only returns empty %s directory when verified count/window proves it', async kind => {
  const f = directoryFixture(kind, 0)
  expect(await f.readDirectory()).toMatchObject({ entries: [], observedCount: '0', upperBound: '0', nextIndex: null, partial: false })
  const g = directoryFixture(kind)
  expect(await g.readDirectory({ startIndex: '3', upperBound: '3' })).toMatchObject({ entries: [], nextIndex: null, partial: true })
  g.rows.delete(deriveDynamicFieldID(g.parent, 'u64', bcs.u64().serialize('1').toBytes()))
  await expect(g.readDirectory()).rejects.toThrow('not found')
})
it.each(['post', 'comment'] as const)('rejects malformed %s directory rows and duplicates', async kind => {
  for (const variant of ['duplicate', 'zero', 'registry', 'table', 'owner', 'name', 'type', 'trailing']) {
    const f = directoryFixture(kind)
    if (variant === 'duplicate') f.putField(f.parent, '1', id(1000))
    if (variant === 'zero') f.putField(f.parent, '1', id(0))
    if (variant === 'registry') f.putField(f.parent, '1', f.registry.id)
    if (variant === 'table') f.putField(f.parent, '1', f.parent)
    const raw = f.rows.get(deriveDynamicFieldID(f.parent, 'u64', bcs.u64().serialize('1').toBytes()))
    if (variant === 'owner') raw.owner.address = id(99)
    if (variant === 'name') raw.contents.value.set(bcs.u64().serialize('9').toBytes(), 32)
    if (variant === 'type') raw.objectType = normalizeStructTag('0x2::dynamic_field::Field<address,0x2::object::ID>')
    if (variant === 'trailing') raw.contents.value = new Uint8Array([...raw.contents.value, 0])
    await expect(f.readDirectory()).rejects.toThrow()
  }
})
it.each(['post', 'comment'] as const)('enforces canonical u64 %s paging parameters before RPC and range after root read', async kind => {
  const f = directoryFixture(kind)
  for (const bad of ['-1', '00', '01', '1.0', '18446744073709551616', 1, null]) {
    await expect(f.readDirectory({ startIndex: bad as string })).rejects.toThrow('COMMUNITY_INVALID_U64')
    await expect(f.readDirectory({ upperBound: bad as string })).rejects.toThrow('COMMUNITY_INVALID_U64')
  }
  for (const limit of [0, -1, 1.5, kind === 'post' ? 31 : 201, NaN]) {
    await expect(f.readDirectory({ limit })).rejects.toThrow('COMMUNITY_INVALID_PAGE_LIMIT')
  }
  expect(f.getObject).not.toHaveBeenCalled()
  await expect(f.readDirectory({ startIndex: '4' })).rejects.toThrow('COMMUNITY_PAGE_OUT_OF_RANGE')
  await expect(f.readDirectory({ upperBound: '4' })).rejects.toThrow('COMMUNITY_PAGE_OUT_OF_RANGE')
  await expect(f.readDirectory({ startIndex: '2', upperBound: '1' })).rejects.toThrow('COMMUNITY_PAGE_OUT_OF_RANGE')
})
it.each(['post', 'comment'] as const)('supports maximum %s page size with bounded RPC concurrency', async kind => {
  const maximum = kind === 'post' ? 30 : 200, f = directoryFixture(kind, maximum)
  const original = f.getObject.getMockImplementation()!; let active = 0, peak = 0
  f.getObject.mockImplementation(async args => {
    active++; peak = Math.max(peak, active)
    try { await Promise.resolve(); return await original(args) } finally { active-- }
  })
  const page = await f.readDirectory({ limit: maximum })
  expect(page.entries).toHaveLength(maximum); expect(page.partial).toBe(false)
  expect(peak).toBeLessThanOrEqual(8)
})
it.each(['post', 'comment'] as const)('preserves full-u64 %s directory indices', async kind => {
  const f = directoryFixture(kind, 1), count = '18446744073709551615', index = '18446744073709551614'
  if (kind === 'post') { f.registry.post_count = f.registry.by_index.size = count; f.putRegistry() }
  else { f.post.comment_count = f.post.comments_by_index.size = count; f.putPost() }
  f.putField(f.parent, index, id(1001))
  expect(await f.readDirectory({ startIndex: index, upperBound: count })).toMatchObject({
    entries: [{ index, id: id(1001) }], observedCount: count, upperBound: count, nextIndex: null, partial: true })
})
it.each(['post', 'comment'] as const)('rejects %s registry drift before publishing a page', async kind => {
  const f = directoryFixture(kind), original = f.getObject.getMockImplementation()!; let count = 0
  f.getObject.mockImplementation(async args => {
    if (args.objectId === f.registry.id && ++count === 2) f.rows.get(f.registry.id).version = 2n
    return original(args)
  })
  await expect(f.readDirectory()).rejects.toThrow('COMMUNITY_CHANGED_RETRY')
})
it('rejects comment parent drift, wrong-chain and a caller abort with ignored transport', async () => {
  const f = directoryFixture('comment'), original = f.getObject.getMockImplementation()!; let count = 0
  f.getObject.mockImplementation(async args => {
    if (args.objectId === f.post.id && ++count === 2) f.rows.get(f.post.id).version = 2n
    return original(args)
  })
  await expect(f.readDirectory()).rejects.toThrow('COMMUNITY_CHANGED_RETRY')
  const g = directoryFixture('post')
  g.core.getChainIdentifier.mockResolvedValueOnce({ chainIdentifier: toBase58(new Uint8Array(32).fill(9)) })
  await expect(g.readDirectory()).rejects.toThrow('COMMUNITY_WRONG_CHAIN')
  expect(g.getObject).not.toHaveBeenCalled()
  const controller = new AbortController(); g.getObject.mockImplementationOnce(() => new Promise(() => {}))
  const pending = g.readDirectory({ signal: controller.signal }); await Promise.resolve(); controller.abort(new Error('cancel directory'))
  await expect(pending).rejects.toThrow('cancel directory')
})
