import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID } from '@mysten/sui/utils'
import { sha256 } from '@noble/hashes/sha2.js'
import { readPinnedMovePackage, type PinnedMovePackage } from '../../sui/pinned-move-package'
import { readCommerceObject, decodeCommerce, commerceCheck, commerceId } from './economics-read'

const A = bcs.Address, U = bcs.u64(), V = bcs.byteVector()
export const SaleCollectionBcs = bcs.struct('Collection', { id: A, schema_version: bcs.u16(), protocol: A, creator: A,
  right: A, right_hash: V, policy: A, extra: bcs.u16(), tradeable: bcs.bool(), max_supply: bcs.option(U),
  floor: bcs.option(bcs.u128()), supply: U, members: bcs.struct('Table', { id: A, size: U }),
  revision: U, holder: A, kiosk: A, epoch: U })
const Snapshot = bcs.struct('Snapshot', { collection: A, protocol: A, creator: A, right: A, right_hash: V, policy: A,
  extra: bcs.u16(), tradeable: bcs.bool(), max_supply: bcs.option(U), floor: bcs.option(bcs.u128()), holder: A, kiosk: A, epoch: U })
export const SaleCollectionMemberBcs = bcs.struct('Field', { id: A, name: A, value: U })

/** Mirrors collection::snapshot_hash; no mutable membership/supply/revision
 * fields are silently added to its immutable policy and current holder domain.
 */
export function saleCollectionSnapshotHash(c: ReturnType<typeof SaleCollectionBcs.parse>) {
  return sha256(Snapshot.serialize({ ...c, collection: c.id }).toBytes())
}

/** Exact Native-linked Collection plus permanent Table<ID,u64> membership.
 * Used only after the caller authenticates Native package and Config identity.
 * Never substitutes an external NFT or Collection Right for the Soul layer.
 */
export async function readSaleCollectionProof(input: { client: SuiGrpcClient; pin: PinnedMovePackage;
  nativeLinkage: Map<string, { upgradedId: string; upgradedVersion: string }>; collectionId: string;
  configId: string; soulId: string; signal: AbortSignal }) {
  const { client, signal } = input, pin = structuredClone(input.pin)
  const link = input.nativeLinkage.get(pin.originalPackageId)
  commerceCheck(link?.upgradedId === pin.callablePackageId, 'COLLECTION_NATIVE_LINK')
  const pkg = await readPinnedMovePackage(client, pin, signal)
  commerceCheck(link.upgradedVersion === String(pkg.version), 'COLLECTION_LINK_VERSION')
  const origin = pkg.origins.get('collection::Collection'); commerceCheck(origin, 'COLLECTION_ORIGIN')
  const type = `${origin}::collection::Collection`
  const object = await readCommerceObject(client, input.collectionId, type, signal)
  commerceCheck(object.owner.$kind === 'Shared', 'COLLECTION_OWNER')
  const c = decodeCommerce(SaleCollectionBcs, object.contents)
  commerceCheck(c.id === input.collectionId && c.protocol === input.configId && c.schema_version === 1
    && commerceId(c.holder) && commerceId(c.kiosk) && commerceId(c.creator) && commerceId(c.right) && commerceId(c.policy)
    && c.right_hash.length === 32 && c.extra <= 10000 && commerceId(c.members.id)
    && c.members.size === c.supply && BigInt(c.supply) > 0n
    && (c.max_supply === null || BigInt(c.max_supply) >= BigInt(c.supply)), 'COLLECTION_BINDING')
  const memberId = deriveDynamicFieldID(c.members.id, '0x2::object::ID', A.serialize(input.soulId).toBytes())
  const memberObject = await readCommerceObject(client, memberId, '0x2::dynamic_field::Field<0x2::object::ID,u64>', signal)
  const member = decodeCommerce(SaleCollectionMemberBcs, memberObject.contents)
  commerceCheck(memberObject.owner.ObjectOwner === c.members.id && member.id === memberId && member.name === input.soulId
    && BigInt(member.value) > 0n && BigInt(member.value) <= BigInt(c.supply), 'COLLECTION_MEMBERSHIP')
  const current = await readCommerceObject(client, object.objectId, type, signal)
  commerceCheck(current.version === object.version && current.digest === object.digest, 'COLLECTION_CHANGED')
  return { collectionId: c.id, creator: c.creator, holder: c.holder, royaltyBps: c.extra, snapshotHash: saleCollectionSnapshotHash(c),
    observed: { objectId: object.objectId, version: object.version, digest: object.digest },
    member: { objectId: memberId, version: memberObject.version, digest: memberObject.digest },
    notAuthorization: true as const }
}
