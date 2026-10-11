import { expect, it, vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, normalizeStructTag, toBase58 } from '@mysten/sui/utils'
import { SocialRegistryV1Bcs, FollowCountsV1Bcs, FollowKeyV1Bcs, FollowEdgeV1Bcs,
  buildSetWalletFollowTx, readWalletFollowState } from '../../packages/soulidity-sdk/src/wallet-social'
import { ProfileRegistryV1Bcs, WalletProfileV1Bcs } from '../../packages/soulidity-sdk/src/wallet-profile'
import { publicProfileOperationFixture, profileId as id, profileDigest as digest } from './fixtures/public-profile-operation'

async function fixture() {
  const { intent, receipt } = await publicProfileOperationFixture()
  const deployment = { profile: intent.deployment, registryId: id(100) }
  const targetId = id(4), viewerId = id(5), viewerOwner = id(8), countsId = id(101), edgesId = id(102)
  const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://grpc.example.test' })
  const profiles = new Map<string, any>(), rows = new Map<string, any>()
  const coreObject = (objectId: string, type: string, content: Uint8Array, owner: any) => ({ objectId, type, content, owner, digest, version: '1' })
  const profileRegistry = { id: intent.deployment.registryId, version: '1', profile_count: '2',
    by_owner: { id: id(10), size: '2' }, by_handle: { id: id(11), size: '2' }, by_index: { id: id(12), size: '2' } }
  profiles.set(profileRegistry.id, coreObject(profileRegistry.id, `${intent.deployment.originalPackageId}::profile::ProfileRegistryV1`,
    ProfileRegistryV1Bcs.serialize(profileRegistry).toBytes(), { $kind: 'Shared', Shared: { initialSharedVersion: '1' } }))
  const metadata = { blob_object_id: receipt.reference.blobObjectId, blob_id: new Uint8Array(32).fill(2),
    sha256: new Uint8Array(32).fill(3), byte_length: 15 }
  for (const [profileId, owner, handle] of [[targetId, intent.owner, 'alice'], [viewerId, viewerOwner, 'bob']]) {
    const profile = { id: profileId, version: '1', registry_id: profileRegistry.id, owner,
      revision: '0', handle, metadata, created_at_ms: '1', updated_at_ms: '1' }
    profiles.set(profileId, coreObject(profileId, `${intent.deployment.originalPackageId}::profile::WalletProfileV1`,
      WalletProfileV1Bcs.serialize(profile).toBytes(), { $kind: 'AddressOwner', AddressOwner: owner }))
    const fieldId = deriveDynamicFieldID(id(10), 'address', bcs.Address.serialize(owner).toBytes())
    const field = bcs.struct('ProfileOwnerField', { id: bcs.Address, name: bcs.Address, value: bcs.Address })
    profiles.set(fieldId, coreObject(fieldId, normalizeStructTag('0x2::dynamic_field::Field<address,0x2::object::ID>'),
      field.serialize({ id: fieldId, name: owner, value: profileId }).toBytes(), { $kind: 'ObjectOwner', ObjectOwner: id(10) }))
  }
  vi.spyOn(client.core, 'getChainIdentifier').mockResolvedValue({ chainIdentifier: toBase58(new Uint8Array(32).fill(1)) })
  vi.spyOn(client.core, 'getObjects').mockImplementation(async args => ({ objects: args.objectIds.map(key => profiles.get(key) ?? new Error('profile-not-found')) }))
  vi.spyOn(client.core, 'listOwnedObjects').mockResolvedValue({ objects: [profiles.get(viewerId)], hasNextPage: false, cursor: null } as any)
  const social = { id: deployment.registryId, version: '1', counts: { id: countsId, size: '2' }, edges: { id: edgesId, size: '1' } }
  const raw = (objectId: string, objectType: string, content: Uint8Array, owner: any) => ({ objectId, objectType,
    contents: { value: content }, owner, version: 1n, digest })
  function putRegistry() { rows.set(social.id, raw(social.id, `${intent.deployment.originalPackageId}::social::SocialRegistryV1`,
    SocialRegistryV1Bcs.serialize(social).toBytes(), { kind: 3, version: 1n })) }
  function putCounts(profileId: string, follower_count: string, following_count: string) {
    const fieldId = deriveDynamicFieldID(countsId, normalizeStructTag('0x2::object::ID'), bcs.Address.serialize(profileId).toBytes())
    rows.set(fieldId, raw(fieldId, normalizeStructTag(`0x2::dynamic_field::Field<0x2::object::ID,${intent.deployment.originalPackageId}::social::FollowCountsV1>`),
      bcs.struct('CountsField', { id: bcs.Address, name: bcs.Address, value: FollowCountsV1Bcs }).serialize({
        id: fieldId, name: profileId, value: { follower_count, following_count } }).toBytes(), { kind: 2, address: countsId }))
    return fieldId
  }
  const key = { follower: viewerId, following: targetId }
  const edgeType = `${intent.deployment.originalPackageId}::social::FollowKeyV1`
  const edgeId = deriveDynamicFieldID(edgesId, edgeType, FollowKeyV1Bcs.serialize(key).toBytes())
  function putEdge(following: boolean, revision: string) {
    rows.set(edgeId, raw(edgeId, normalizeStructTag(`0x2::dynamic_field::Field<${edgeType},${intent.deployment.originalPackageId}::social::FollowEdgeV1>`),
      bcs.struct('EdgeField', { id: bcs.Address, name: FollowKeyV1Bcs, value: FollowEdgeV1Bcs }).serialize({
        id: edgeId, name: key, value: { following, revision } }).toBytes(), { kind: 2, address: edgesId }))
  }
  putRegistry(); const targetCountsId = putCounts(targetId, '1', '0'); putCounts(viewerId, '0', '1'); putEdge(true, '1')
  const getObject = vi.spyOn(client.ledgerService, 'getObject').mockImplementation((args: any) => {
    if (!rows.has(args.objectId)) return Promise.reject(Object.assign(new Error('not found'), { code: 'NOT_FOUND' })) as any
    return Promise.resolve({ response: { object: structuredClone(rows.get(args.objectId)) } }) as any
  })
  const read = (viewerAddress: string | null = viewerOwner, signal?: AbortSignal) => readWalletFollowState({ client, deployment,
    targetProfileId: targetId, viewerAddress, signal })
  return { intent, deployment, client, profiles, rows, social, targetId, viewerId, viewerOwner, countsId, edgesId,
    targetCountsId, edgeId, getObject, putRegistry, putCounts, putEdge, read }
}
it('reads registered identities, raw dynamic-field names/parents and both sides of an active edge', async () => {
  const f = await fixture(), value = await f.read()
  expect(value).toMatchObject({ target: { id: f.targetId }, viewer: { id: f.viewerId }, following: true,
    edgeRevision: '1', followerCount: '1', followingCount: '0', registryVersion: '1', registryDigest: digest })
  expect(f.getObject.mock.calls[0][0]).toMatchObject({ objectId: f.social.id,
    readMask: { paths: ['object_id', 'object_type', 'version', 'digest', 'owner', 'contents'] } })
})
it('anonymous/self/unregistered viewers do not manufacture a follow edge', async () => {
  const f = await fixture()
  expect(await f.read(null)).toMatchObject({ viewer: null, following: false, edgeRevision: '0', followerCount: '1' })
  expect(await f.read(f.intent.owner)).toMatchObject({ viewer: { id: f.targetId }, following: false })
  vi.mocked(f.client.core.listOwnedObjects).mockResolvedValueOnce({ objects: [], hasNextPage: false, cursor: null } as any)
  expect(await f.read()).toMatchObject({ viewer: null, following: false })
})
it('exact RPC NOT_FOUND is an absent edge, whereas plain/permission/transport errors remain failures', async () => {
  const f = await fixture(); f.rows.delete(f.edgeId)
  expect(await f.read()).toMatchObject({ following: false, edgeRevision: '0' })
  for (const error of [new Error('NOT_FOUND'), Object.assign(new Error('denied'), { code: 'PERMISSION_DENIED' }), new Error('timeout')]) {
    const original = f.getObject.getMockImplementation()!
    f.getObject.mockImplementationOnce(original).mockImplementationOnce(original).mockRejectedValueOnce(error)
    await expect(f.read()).rejects.toThrow(error.message)
  }
})
it('unfollow tombstones preserve revision instead of recreating revision zero', async () => {
  const f = await fixture(); f.putEdge(false, '2'); f.putCounts(f.targetId, '0', '0'); f.putCounts(f.viewerId, '0', '0')
  expect(await f.read()).toMatchObject({ following: false, edgeRevision: '2', followerCount: '0' })
})
it.each(['target', 'viewer'])('rejects an unfollow tombstone with missing %s counts', async side => {
  const f = await fixture(); f.putEdge(false, '2'); f.putCounts(f.targetId, '0', '0')
  const viewerCountsId = f.putCounts(f.viewerId, '0', '0')
  f.rows.delete(side === 'target' ? f.targetCountsId : viewerCountsId)
  await expect(f.read()).rejects.toThrow('SOCIAL_EDGE_COUNTS_MISMATCH')
})
it.each(['type', 'owner', 'uid', 'version', 'trailing', 'alias'])('rejects malformed registry %s', async variant => {
  const f = await fixture(), raw = f.rows.get(f.social.id)
  if (variant === 'type') raw.objectType = `${id(99)}::social::SocialRegistryV1`
  if (variant === 'owner') raw.owner = { kind: 1, address: f.intent.owner }
  if (variant === 'uid') raw.contents.value = SocialRegistryV1Bcs.serialize({ ...f.social, id: id(99) }).toBytes()
  if (variant === 'version') raw.contents.value = SocialRegistryV1Bcs.serialize({ ...f.social, version: '2' }).toBytes()
  if (variant === 'trailing') raw.contents.value = new Uint8Array([...raw.contents.value, 0])
  if (variant === 'alias') raw.contents.value = SocialRegistryV1Bcs.serialize({ ...f.social, counts: { ...f.social.counts, id: f.edgesId } }).toBytes()
  await expect(f.read()).rejects.toThrow()
})
it.each(['owner', 'name', 'uid', 'type', 'trailing'])('rejects substituted counts field %s', async variant => {
  const f = await fixture(), raw = f.rows.get(f.targetCountsId)
  if (variant === 'owner') raw.owner.address = id(99)
  if (variant === 'name') raw.contents.value.set(bcs.Address.serialize(id(99)).toBytes(), 32)
  if (variant === 'uid') raw.contents.value.set(bcs.Address.serialize(id(99)).toBytes(), 0)
  if (variant === 'type') raw.objectType = normalizeStructTag(`0x2::dynamic_field::Field<address,${f.intent.deployment.originalPackageId}::social::FollowCountsV1>`)
  if (variant === 'trailing') raw.contents.value = new Uint8Array([...raw.contents.value, 0])
  await expect(f.read()).rejects.toThrow()
})
it('rejects invalid edge parity, wrong edge name and active-edge zero-count mismatch', async () => {
  const f = await fixture(); f.putEdge(false, '1')
  await expect(f.read()).rejects.toThrow('SOCIAL_EDGE_REVISION_MISMATCH')
  f.putEdge(true, '1'); f.rows.get(f.edgeId).contents.value.set(bcs.Address.serialize(id(99)).toBytes(), 32)
  await expect(f.read()).rejects.toThrow('SOCIAL_FIELD_CONTENT_MISMATCH')
  f.putEdge(true, '1'); f.rows.delete(f.targetCountsId)
  await expect(f.read()).rejects.toThrow('SOCIAL_EDGE_COUNTS_MISMATCH')
})
it('a concurrent registry mutation causes retry rather than mixed counts', async () => {
  const f = await fixture(), original = f.getObject.getMockImplementation()!; let rootReads = 0
  f.getObject.mockImplementation((args: any) => {
    if (args.objectId === f.social.id && ++rootReads === 2) f.rows.get(f.social.id).version = 2n
    return original(args)
  })
  await expect(f.read()).rejects.toThrow('SOCIAL_CHANGED_RETRY')
})
it('wrong profile ownership/chain and cancellation cannot turn into zero counts', async () => {
  const f = await fixture(); vi.mocked(f.client.core.getChainIdentifier).mockResolvedValueOnce({ chainIdentifier: toBase58(new Uint8Array(32).fill(9)) })
  await expect(f.read()).rejects.toThrow('PROFILE_WRONG_CHAIN'); expect(f.getObject).not.toHaveBeenCalled()
  f.profiles.get(f.targetId).owner.AddressOwner = id(99)
  await expect(f.read()).rejects.toThrow('PROFILE_OWNER_MISMATCH')
  const controller = new AbortController(); controller.abort(new Error('cancelled'))
  await expect(f.read(null, controller.signal)).rejects.toThrow('cancelled')
})
it('builds exactly one explicit desired-state CAS call using real BCS arguments', async () => {
  const f = await fixture(), tx = buildSetWalletFollowTx({ deployment: f.deployment, owner: f.viewerOwner,
    actorId: f.viewerId, targetId: f.targetId, targetOwner: f.intent.owner, expectedRevision: '2', following: true }).getData()
  expect(tx.sender).toBe(f.viewerOwner); expect(tx.commands).toHaveLength(1)
  expect(tx.commands[0].MoveCall).toMatchObject({ package: f.intent.deployment.callablePackageId, module: 'social', function: 'set_follow', typeArguments: [] })
  expect(tx.inputs[0].UnresolvedObject?.objectId).toBe(f.social.id)
  expect(tx.inputs[1].UnresolvedObject?.objectId).toBe(f.intent.deployment.registryId)
  expect(tx.inputs[5].Pure?.bytes).toBe(bcs.u64().serialize('2').toBase64())
  expect(tx.inputs[6].Pure?.bytes).toBe(bcs.bool().serialize(true).toBase64())
  expect(() => buildSetWalletFollowTx({ deployment: f.deployment, owner: f.viewerOwner,
    actorId: f.viewerId, targetId: f.viewerId, targetOwner: f.viewerOwner, expectedRevision: '0', following: true })).toThrow('SOCIAL_CANNOT_FOLLOW_SELF')
})
