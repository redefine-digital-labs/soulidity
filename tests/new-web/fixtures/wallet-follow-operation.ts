import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { bcs } from '@mysten/sui/bcs'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, normalizeStructTag, toBase64 } from '@mysten/sui/utils'
import { vi } from 'vitest'
import { createWalletFollowIntent, type WalletFollowOperation } from '../../../packages/soulidity-sdk/src/wallet-follow-operation'
import { buildSetWalletFollowTx, SocialRegistryV1Bcs, FollowCountsV1Bcs, FollowKeyV1Bcs, FollowEdgeV1Bcs } from '../../../packages/soulidity-sdk/src/wallet-social'
import { ProfileRegistryV1Bcs, WalletProfileV1Bcs } from '../../../packages/soulidity-sdk/src/wallet-profile'
import { profileId as id, profileSigner as signer, profileDigest as digest } from './public-profile-operation'

export { id, signer, digest }
export async function walletFollowOperationFixture() {
  const intent = createWalletFollowIntent({ deployment: { profile: { originalPackageId: id(1), callablePackageId: id(2),
    registryId: id(3), chainIdentifier: '01010101' }, registryId: id(100) }, owner: signer.toSuiAddress(),
    actorId: id(4), targetId: id(5), targetOwner: id(9), expectedRevision: '0', following: true })
  const resolve = (tx: Transaction) => {
    const template = tx.getData()
    const result = Transaction.from(JSON.stringify({ ...template, inputs: template.inputs.map(input => input.UnresolvedObject
      ? { Object: { SharedObject: { objectId: input.UnresolvedObject.objectId, initialSharedVersion: '1',
        mutable: input.UnresolvedObject.objectId === intent.deployment.registryId } } } : input) }))
    result.setGasOwner(intent.owner); result.setGasBudget('10000000'); result.setGasPrice('1000')
    result.setGasPayment([{ objectId: id(60), version: '1', digest }])
    return result
  }
  const tx = resolve(buildSetWalletFollowTx(intent)); tx.setExpiration({ Epoch: '10' })
  const bytes = await tx.build()
  const record: WalletFollowOperation = { schema: 'soulidity.wallet-follow-operation.v1', intent, bytes: toBase64(bytes),
    digest: TransactionDataBuilder.getDigestFromBytes(bytes), expirationEpoch: '10', phase: 'PREPARED', signature: null }
  return { intent, record, tx, resolve }
}

/** Public-node fixture uses genuine SDK clients and encoded Move object layouts;
 * only RPC responses are substituted. It is not a live-chain acceptance test. */
export async function walletFollowReadFixture() {
  const fixture = await walletFollowOperationFixture(), { intent } = fixture
  const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://not-called.invalid' })
  const profileObjects = new Map<string, any>(), rows = new Map<string, any>()
  const profile = intent.deployment.profile
  const coreObject = (objectId: string, type: string, content: Uint8Array, owner: any) => ({ objectId, type, content, owner, digest, version: '1' })
  const directory = { id: profile.registryId, version: '1', profile_count: '2', by_owner: { id: id(10), size: '2' },
    by_handle: { id: id(11), size: '2' }, by_index: { id: id(12), size: '2' } }
  profileObjects.set(profile.registryId, coreObject(profile.registryId, `${profile.originalPackageId}::profile::ProfileRegistryV1`,
    ProfileRegistryV1Bcs.serialize(directory).toBytes(), { $kind: 'Shared', Shared: { initialSharedVersion: '1' } }))
  for (const [profileId, owner, handle] of [[intent.actorId, intent.owner, 'alice'], [intent.targetId, intent.targetOwner, 'bob']]) {
    const value = { id: profileId, version: '1', registry_id: profile.registryId, owner, revision: '0', handle,
      metadata: { blob_object_id: id(50), blob_id: new Uint8Array(32).fill(2), sha256: new Uint8Array(32).fill(3), byte_length: 15 },
      created_at_ms: '1', updated_at_ms: '1' }
    profileObjects.set(profileId, coreObject(profileId, `${profile.originalPackageId}::profile::WalletProfileV1`,
      WalletProfileV1Bcs.serialize(value).toBytes(), { $kind: 'AddressOwner', AddressOwner: owner }))
    const fieldId = deriveDynamicFieldID(id(10), 'address', bcs.Address.serialize(owner).toBytes())
    profileObjects.set(fieldId, coreObject(fieldId, normalizeStructTag('0x2::dynamic_field::Field<address,0x2::object::ID>'),
      bcs.struct('OwnerField', { id: bcs.Address, name: bcs.Address, value: bcs.Address })
        .serialize({ id: fieldId, name: owner, value: profileId }).toBytes(), { $kind: 'ObjectOwner', ObjectOwner: id(10) }))
  }
  const chain = vi.spyOn(client.core, 'getChainIdentifier').mockResolvedValue({ chainIdentifier: digest })
  const objects = vi.spyOn(client.core, 'getObjects').mockImplementation(async args => ({ objects: args.objectIds.map(key => profileObjects.get(key) ?? new Error('missing')) }))
  const owned = vi.spyOn(client.core, 'listOwnedObjects').mockResolvedValue({ objects: [profileObjects.get(intent.actorId)], hasNextPage: false, cursor: null } as any)
  const epoch = vi.spyOn(client.ledgerService, 'getEpoch').mockImplementation(async () => ({ response: { epoch: { epoch: 9n } } }) as never)
  const raw = (objectId: string, objectType: string, content: Uint8Array, owner: any) => ({ objectId, objectType,
    contents: { value: content }, owner, version: 1n, digest })
  const social = { id: intent.deployment.registryId, version: '1', counts: { id: id(101), size: '0' }, edges: { id: id(102), size: '0' } }
  function putRegistry() {
    rows.set(social.id, raw(social.id, `${profile.originalPackageId}::social::SocialRegistryV1`, SocialRegistryV1Bcs.serialize(social).toBytes(), { kind: 3, version: 1n }))
  }
  function setEdge(following: boolean, revision: string) {
    const key = { follower: intent.actorId, following: intent.targetId }
    const nameType = `${profile.originalPackageId}::social::FollowKeyV1`
    const edgeId = deriveDynamicFieldID(id(102), nameType, FollowKeyV1Bcs.serialize(key).toBytes())
    rows.set(edgeId, raw(edgeId, normalizeStructTag(`0x2::dynamic_field::Field<${nameType},${profile.originalPackageId}::social::FollowEdgeV1>`),
      bcs.struct('EdgeField', { id: bcs.Address, name: FollowKeyV1Bcs, value: FollowEdgeV1Bcs }).serialize({ id: edgeId, name: key, value: { following, revision } }).toBytes(),
      { kind: 2, address: id(102) }))
    for (const profileId of [intent.actorId, intent.targetId]) {
      const fieldId = deriveDynamicFieldID(id(101), normalizeStructTag('0x2::object::ID'), bcs.Address.serialize(profileId).toBytes())
      rows.set(fieldId, raw(fieldId, normalizeStructTag(`0x2::dynamic_field::Field<0x2::object::ID,${profile.originalPackageId}::social::FollowCountsV1>`),
        bcs.struct('CountsField', { id: bcs.Address, name: bcs.Address, value: FollowCountsV1Bcs }).serialize({ id: fieldId, name: profileId,
          value: { follower_count: following && profileId === intent.targetId ? '1' : '0', following_count: following && profileId === intent.actorId ? '1' : '0' } }).toBytes(),
        { kind: 2, address: id(101) }))
    }
    social.counts.size = '2'; social.edges.size = '1'; putRegistry()
  }
  putRegistry()
  const getObject = vi.spyOn(client.ledgerService, 'getObject').mockImplementation((args: any) => rows.has(args.objectId)
    ? Promise.resolve({ response: { object: structuredClone(rows.get(args.objectId)) } }) as any
    : Promise.reject(Object.assign(new Error('missing'), { code: 'NOT_FOUND' })) as any)
  return { ...fixture, client, chain, objects, owned, epoch, getObject, rows, profileObjects, setEdge }
}
