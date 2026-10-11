import { expect, it, vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { deriveDynamicFieldID, normalizeStructTag, toBase58 } from '@mysten/sui/utils'
import { VoteRegistryV1Bcs, VoteCountsV1Bcs, VoteKeyV1Bcs, VoteEdgeV1Bcs,
  readPublicCommunityVotes } from '../../packages/soulidity-sdk/src/community-votes'
import { CommunityRegistryV1Bcs, PostV1Bcs, type PublicCommunityReadClient } from '../../packages/soulidity-sdk/src/community-posts-read'
import { ProfileRegistryV1Bcs, WalletProfileV1Bcs } from '../../packages/soulidity-sdk/src/wallet-profile'
const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const digest = toBase58(new Uint8Array(32).fill(1))
// Raw ABI fixtures execute the actual Post/profile readers, not mocked identity proofs.
function fixture() {
  const deployment = { community: { profile: { originalPackageId: id(1), callablePackageId: id(2), registryId: id(3), chainIdentifier: '01010101' }, registryId: id(4) }, registryId: id(20) }
  const rows = new Map<string, any>(), profiles = new Map<string, any>()
  const raw = (objectId: string, objectType: string, content: Uint8Array, owner: any) => ({ objectId, objectType, contents: { value: content }, owner, version: 1n, digest })
  const registry = { id: id(4), version: '1', post_count: '1', by_index: { id: id(5), size: '1' } }
  rows.set(registry.id, raw(registry.id, `${id(1)}::community_posts::CommunityRegistryV1`, CommunityRegistryV1Bcs.serialize(registry).toBytes(), { kind: 3, version: 1n }))
  const document = { blob_object_id: id(90), blob_id: new Uint8Array(32).fill(2), sha256: new Uint8Array(32).fill(3), byte_length: '80' }
  const post = { id: id(6), version: '1', registry_id: id(4), profile_registry_id: id(3), author: id(7), author_owner: id(8), index: '0',
    post_type: 0, channel: 0, document, created_at_ms: '10', updated_at_ms: '10', comment_count: '0', comments_by_index: { id: id(9), size: '0' },
    accepted_comment_id: null, acceptance_revision: '0' }
  rows.set(post.id, raw(post.id, `${id(1)}::community_posts::PostV1`, PostV1Bcs.serialize(post).toBytes(), { kind: 3, version: 1n }))
  const postField = deriveDynamicFieldID(id(5), 'u64', bcs.u64().serialize('0').toBytes())
  rows.set(postField, raw(postField, normalizeStructTag('0x2::dynamic_field::Field<u64,0x2::object::ID>'),
    bcs.struct('Index', { id: bcs.Address, name: bcs.u64(), value: bcs.Address }).serialize({ id: postField, name: '0', value: post.id }).toBytes(), { kind: 2, address: id(5) }))
  const coreObject = (objectId: string, type: string, content: Uint8Array, owner: any) => ({ objectId, type, content, owner, digest, version: '1' })
  profiles.set(id(3), coreObject(id(3), `${id(1)}::profile::ProfileRegistryV1`, ProfileRegistryV1Bcs.serialize({ id: id(3), version: '1', profile_count: '1',
    by_owner: { id: id(11), size: '1' }, by_handle: { id: id(12), size: '1' }, by_index: { id: id(13), size: '1' } }).toBytes(), { $kind: 'Shared', Shared: { initialSharedVersion: '1' } }))
  profiles.set(id(7), coreObject(id(7), `${id(1)}::profile::WalletProfileV1`, WalletProfileV1Bcs.serialize({ id: id(7), version: '1', registry_id: id(3), owner: id(8), revision: '0',
    handle: 'alice', metadata: document, created_at_ms: '1', updated_at_ms: '1' }).toBytes(), { $kind: 'AddressOwner', AddressOwner: id(8) }))
  const ownerField = deriveDynamicFieldID(id(11), 'address', bcs.Address.serialize(id(8)).toBytes())
  profiles.set(ownerField, coreObject(ownerField, normalizeStructTag('0x2::dynamic_field::Field<address,0x2::object::ID>'),
    bcs.struct('Owner', { id: bcs.Address, name: bcs.Address, value: bcs.Address }).serialize({ id: ownerField, name: id(8), value: id(7) }).toBytes(), { $kind: 'ObjectOwner', ObjectOwner: id(11) }))
  const votes = { id: id(20), version: '1', counts: { id: id(21), size: '1' }, edges: { id: id(22), size: '1' } }
  const putRegistry = () => rows.set(id(20), raw(id(20), `${id(1)}::community_votes::VoteRegistryV1`, VoteRegistryV1Bcs.serialize(votes).toBytes(), { kind: 3, version: 1n }))
  const countsId = deriveDynamicFieldID(id(21), normalizeStructTag('0x2::object::ID'), bcs.Address.serialize(post.id).toBytes())
  const putCounts = (up_count: string, down_count: string) => rows.set(countsId, raw(countsId,
    normalizeStructTag(`0x2::dynamic_field::Field<0x2::object::ID,${id(1)}::community_votes::VoteCountsV1>`),
    bcs.struct('Counts', { id: bcs.Address, name: bcs.Address, value: VoteCountsV1Bcs }).serialize({ id: countsId, name: post.id, value: { up_count, down_count } }).toBytes(), { kind: 2, address: id(21) }))
  const keyType = `${id(1)}::community_votes::VoteKeyV1`, key = { actor: id(7), post: post.id }
  const edgeId = deriveDynamicFieldID(id(22), keyType, VoteKeyV1Bcs.serialize(key).toBytes())
  const putEdge = (state: number, revision: string) => rows.set(edgeId, raw(edgeId,
    normalizeStructTag(`0x2::dynamic_field::Field<${keyType},${id(1)}::community_votes::VoteEdgeV1>`),
    bcs.struct('Edge', { id: bcs.Address, name: VoteKeyV1Bcs, value: VoteEdgeV1Bcs }).serialize({ id: edgeId, name: key, value: { state, revision } }).toBytes(), { kind: 2, address: id(22) }))
  putRegistry(); putCounts('1', '0'); putEdge(1, '1')
  const getObject = vi.fn(async ({ objectId }: { objectId: string }) => {
    if (!rows.has(objectId)) throw Object.assign(new Error('missing'), { code: 'NOT_FOUND' })
    return { response: { object: structuredClone(rows.get(objectId)) } }
  })
  const core = { getChainIdentifier: vi.fn(async () => ({ chainIdentifier: digest })),
    getObject: vi.fn(async ({ objectId }: { objectId: string }) => {
      if (!profiles.has(objectId)) throw new Error('profile missing')
      return { object: structuredClone(profiles.get(objectId)) }
    }), listOwnedObjects: vi.fn(async () => ({ objects: [structuredClone(profiles.get(id(7)))], hasNextPage: false, cursor: null })) }
  const client = { core, ledgerService: { getObject } } as unknown as PublicCommunityReadClient
  const read = (viewerAddress: string | null = id(8), signal?: AbortSignal) => readPublicCommunityVotes({ client, deployment, postId: post.id, viewerAddress, signal })
  return { deployment, client, core, rows, profiles, post, postField, ownerField, votes, countsId, edgeId, putRegistry, putCounts, putEdge, getObject, read }
}
it('reads exact registered Post/self-voter and real counts, preserving identity and revision', async () => {
  const f = fixture()
  expect(await f.read()).toMatchObject({ viewer: { id: id(7) }, viewerAddress: id(8), post: { id: id(6) },
    upCount: '1', downCount: '0', score: '1', state: 1, revision: '1', registryVersion: '1', registryDigest: digest })
  expect(f.core.listOwnedObjects).toHaveBeenCalled()
})
it('distinguishes anonymous from connected-but-unregistered viewer', async () => {
  const f = fixture()
  expect(await f.read(null)).toMatchObject({ viewer: null, viewerAddress: null, state: 0, revision: '0', upCount: '1' })
  expect(f.core.listOwnedObjects).not.toHaveBeenCalled()
  f.core.listOwnedObjects.mockResolvedValue({ objects: [], hasNextPage: false, cursor: null })
  expect(await f.read(id(99))).toMatchObject({ viewer: null, viewerAddress: id(99), state: 0, upCount: '1' })
})
it('allows only precise missing rows to mean zero on a verified Post', async () => {
  const f = fixture(); f.rows.delete(f.edgeId); f.rows.delete(f.countsId)
  f.votes.counts.size = f.votes.edges.size = '0'; f.putRegistry()
  expect(await f.read()).toMatchObject({ upCount: '0', downCount: '0', score: '0', state: 0, revision: '0' })
  const original = f.getObject.getMockImplementation()!
  for (const error of [new Error('NOT_FOUND'), Object.assign(new Error('denied'), { code: 'PERMISSION_DENIED' }), new Error('offline')]) {
    f.getObject.mockImplementation(async args => { if (args.objectId === f.countsId) throw error; return original(args) })
    await expect(f.read()).rejects.toThrow(error.message)
  }
})
it('preserves none tombstones and flip revisions, including full u64 revision', async () => {
  const f = fixture(); f.putCounts('0', '0'); f.putEdge(0, '2')
  expect(await f.read()).toMatchObject({ score: '0', state: 0, revision: '2' })
  f.putCounts('0', '1'); f.putEdge(2, '18446744073709551615')
  expect(await f.read()).toMatchObject({ score: '-1', state: 2, revision: '18446744073709551615' })
  f.rows.delete(f.countsId)
  await expect(f.read()).rejects.toThrow()
})
it('computes positive and negative scores losslessly above JS safe integers', async () => {
  const f = fixture(); f.votes.edges.size = '18446744073709551615'; f.putRegistry()
  f.putCounts('18446744073709551615', '0')
  expect(await f.read()).toMatchObject({ score: '18446744073709551615' })
  f.putCounts('0', '18446744073709551615'); f.putEdge(2, '2')
  expect(await f.read()).toMatchObject({ score: '-18446744073709551615' })
})
it.each(['id', 'type', 'version', 'digest', 'owner', 'sharedVersion', 'uid', 'schema', 'trailing', 'alias', 'count', 'edgeCount'])('rejects malformed vote registry %s', async variant => {
  const f = fixture(), raw = f.rows.get(f.votes.id)
  if (variant === 'id') raw.objectId = id(99)
  if (variant === 'type') raw.objectType = `${id(99)}::community_votes::VoteRegistryV1`
  if (variant === 'version') raw.version = 18446744073709551616n
  if (variant === 'digest') raw.digest = 'invalid'
  if (variant === 'owner') raw.owner.kind = 4
  if (variant === 'sharedVersion') raw.owner.version = 2n
  if (variant === 'uid') raw.contents.value.set(bcs.Address.serialize(id(99)).toBytes(), 0)
  if (variant === 'trailing') raw.contents.value = new Uint8Array([...raw.contents.value, 0])
  if (variant === 'schema') { f.votes.version = '2'; f.putRegistry() }
  if (variant === 'alias') { f.votes.counts.id = f.post.comments_by_index.id; f.putRegistry() }
  if (variant === 'count') { f.votes.counts.size = '2'; f.putRegistry() }
  if (variant === 'edgeCount') { f.votes.edges.size = '0'; f.putRegistry() }
  await expect(f.read()).rejects.toThrow()
})
it.each(['countsId', 'edgeId'] as const)('rejects raw field substitutions for %s', async target => {
  for (const variant of ['owner', 'type', 'uid', 'name', 'target', 'trailing']) {
    const f = fixture(), raw = f.rows.get(f[target])
    if (variant === 'owner') raw.owner.address = id(99)
    if (variant === 'type') raw.objectType = `${id(99)}::wrong::Field`
    if (variant === 'uid') raw.contents.value.set(bcs.Address.serialize(id(99)).toBytes(), 0)
    if (variant === 'name') raw.contents.value.set(bcs.Address.serialize(id(99)).toBytes(), 32)
    if (variant === 'target') raw.contents.value.set(bcs.Address.serialize(id(99)).toBytes(), target === 'edgeId' ? 64 : 32)
    if (variant === 'trailing') raw.contents.value = new Uint8Array([...raw.contents.value, 0])
    await expect(f.read()).rejects.toThrow()
  }
})
it.each(['state', 'revision', 'impossibleNone', 'activeUp', 'activeDown', 'overflowTotal', 'missingPost', 'missingMembership', 'wrongViewer', 'missingProfileRegistration'])('rejects invalid %s', async variant => {
  const f = fixture()
  if (variant === 'state') f.putEdge(3, '1')
  if (variant === 'revision') f.putEdge(1, '0')
  if (variant === 'impossibleNone') f.putEdge(0, '1')
  if (variant === 'activeUp') f.putCounts('0', '0')
  if (variant === 'activeDown') { f.putEdge(2, '2'); f.putCounts('1', '0') }
  if (variant === 'overflowTotal') f.putCounts('1', '1')
  if (variant === 'missingPost') f.rows.delete(f.post.id)
  if (variant === 'missingMembership') f.rows.delete(f.postField)
  if (variant === 'wrongViewer') f.core.listOwnedObjects.mockResolvedValue({ objects: [{ ...f.profiles.get(id(7)), owner: { $kind: 'AddressOwner', AddressOwner: id(99) } }], hasNextPage: false, cursor: null })
  if (variant === 'missingProfileRegistration') f.profiles.delete(f.ownerField)
  await expect(f.read()).rejects.toThrow()
})
it.each(['post', 'votes'] as const)('rechecks %s before returning', async target => {
  const f = fixture(), original = f.getObject.getMockImplementation()!; let reads = 0
  f.getObject.mockImplementation(async args => {
    if (args.objectId === f[target].id && ++reads === (target === 'post' ? 3 : 2)) f.rows.get(args.objectId).version = 2n
    return original(args)
  })
  await expect(f.read()).rejects.toThrow('CHANGED_RETRY')
})
it('rechecks viewer registration/metadata instead of returning a mixed identity snapshot', async () => {
  const f = fixture(), original = f.core.listOwnedObjects.getMockImplementation()!
  f.core.listOwnedObjects.mockImplementationOnce(original).mockResolvedValueOnce({ objects: [], hasNextPage: false, cursor: null })
  await expect(f.read()).rejects.toThrow('CHANGED_RETRY')
  const g = fixture()
  g.core.listOwnedObjects.mockResolvedValueOnce({ objects: [], hasNextPage: false, cursor: null })
  await expect(g.read()).rejects.toThrow('CHANGED_RETRY')
})
it('does not interpret a missing raw RPC response as an absent vote field', async () => {
  const f = fixture(), original = f.getObject.getMockImplementation()!
  f.getObject.mockImplementation(async args => args.objectId === f.countsId ? { response: {} } as any : original(args))
  await expect(f.read()).rejects.toThrow('OBJECT_RESPONSE_MISSING')
})
it('captures deployment, checks chain, and never interprets cancellation with NOT_FOUND as absence', async () => {
  const f = fixture()
  f.core.getChainIdentifier.mockResolvedValueOnce({ chainIdentifier: toBase58(new Uint8Array(32).fill(9)) })
  await expect(f.read()).rejects.toThrow('WRONG_CHAIN'); expect(f.getObject).not.toHaveBeenCalled()
  const original = f.core.getChainIdentifier.getMockImplementation()!
  f.core.getChainIdentifier.mockImplementationOnce(async () => { f.deployment.registryId = id(99); return original() })
  expect(await f.read()).toMatchObject({ registryVersion: '1' })
  f.deployment.registryId = id(20)
  const controller = new AbortController(), get = f.getObject.getMockImplementation()!
  f.getObject.mockImplementation(async args => {
    if (args.objectId === f.countsId) { controller.abort(Object.assign(new Error('cancelled'), { code: 'NOT_FOUND' })); return new Promise(() => {}) }
    return get(args)
  })
  await expect(f.read(id(8), controller.signal)).rejects.toThrow('cancelled')
})
it('bounds ignored transport cancellation at 15 seconds', async () => {
  vi.useFakeTimers()
  const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
    const c = new AbortController(); setTimeout(() => c.abort(new Error('timeout')), ms); return c.signal
  })
  try {
    const f = fixture(); f.getObject.mockImplementationOnce(() => new Promise(() => {}))
    const pending = expect(f.read()).rejects.toThrow('timeout'); await vi.advanceTimersByTimeAsync(15000); await pending
  } finally { timeout.mockRestore(); vi.useRealTimers() }
})
