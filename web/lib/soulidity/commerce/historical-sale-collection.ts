import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { bcs } from '@mysten/sui/bcs'
import { Transaction } from '@mysten/sui/transactions'
import { deriveDynamicFieldID, fromBase64 } from '@mysten/sui/utils'
import type { PublicMutationPacket } from '../../sui/public-mutation-journal'
import { readPinnedMovePackage, type PinnedMovePackage } from '../../sui/pinned-move-package'
import { readHistoricalMoveObject } from '../../sui/historical-object'
import { readHistoricalChildThroughParent } from '../../sui/historical-parent-lineage'
import { commerceCheck, commerceId, decodeCommerce } from './economics-read'
import { SaleCollectionBcs, SaleCollectionMemberBcs, saleCollectionSnapshotHash } from './collection-sale-proof'

/** Parent authenticates original packet, finality, Native graph and Offer.
 * Historical membership and royalty only: never current holder authority or a
 * replacement for the original Soul's Collection descriptor/source binding.
 */
export async function proveHistoricalSaleCollection(input: {
  client: SuiGrpcClient; effects: Parameters<typeof readHistoricalMoveObject>[0]['effects'];
  transactionDigest: string; checkpoint: string; packet: Pick<PublicMutationPacket, 'bytes' | 'digest'>;
  pin: PinnedMovePackage; nativeLinkage: Map<string, { upgradedId: string; upgradedVersion: string }>;
  collectionId: string; configId: string; soulId: string; signal: AbortSignal
}) {
  const { client, signal, transactionDigest, checkpoint, collectionId, configId, soulId } = input
  const effects = structuredClone(input.effects), pin = structuredClone(input.pin), packet = structuredClone(input.packet)
  commerceCheck(effects.V2?.status.$kind === 'Success' && effects.V2.transactionDigest === transactionDigest
    && packet.digest === transactionDigest, 'HIST_COLLECTION_CONTEXT')
  const link = input.nativeLinkage.get(pin.originalPackageId), pkg = await readPinnedMovePackage(client, pin, signal)
  commerceCheck(link?.upgradedId === pin.callablePackageId && link.upgradedVersion === String(pkg.version), 'HIST_COLLECTION_NATIVE_LINK')
  const origin = pkg.origins.get('collection::Collection'); commerceCheck(origin, 'HIST_COLLECTION_ORIGIN')
  const type = `${origin}::collection::Collection`
  const original = await readHistoricalMoveObject({ client, effects, transactionDigest, objectId: collectionId, type, mode: 'readonly', signal, maxBytes: 256 * 1024 })
  const refs = Transaction.from(fromBase64(packet.bytes)).getData().inputs.flatMap(i => i.Object?.SharedObject ? [i.Object.SharedObject] : []).filter(r => r.objectId === collectionId)
  commerceCheck(refs.length === 1 && !refs[0].mutable && original.object.owner.Shared
    && original.object.owner.Shared.initialSharedVersion === String(refs[0].initialSharedVersion), 'HIST_COLLECTION_SHARED_REFERENCE')
  const c = decodeCommerce(SaleCollectionBcs, original.bytes)
  const checkCollection = (value: typeof c) => commerceCheck(value.id === collectionId && value.protocol === configId && value.schema_version === 1
    && [value.holder, value.kiosk, value.creator, value.right, value.policy, value.members.id].every(commerceId)
    && value.right_hash.length === 32 && value.extra <= 10000 && value.members.size === value.supply && BigInt(value.supply) > 0n
    && (value.max_supply === null || BigInt(value.max_supply) >= BigInt(value.supply)), 'HIST_COLLECTION_BINDING')
  checkCollection(c)
  const memberId = deriveDynamicFieldID(c.members.id, '0x2::object::ID', bcs.Address.serialize(soulId).toBytes())
  commerceCheck(!effects.V2.changedObjects.some(([id]) => id === memberId), 'HIST_COLLECTION_READONLY_MEMBER_CHANGED')
  const member = await readHistoricalChildThroughParent({ client, anchorEffects: effects, anchorTransactionDigest: transactionDigest,
    anchorCheckpoint: checkpoint, anchorMode: 'readonly', rootId: collectionId, rootType: type, parentUid: c.members.id,
    childId: memberId, childType: '0x2::dynamic_field::Field<0x2::object::ID,u64>',
    chainIdentifier: '35834a8a', genesisDigest: '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S', signal,
    assertContainsParent: bytes => { const prior = decodeCommerce(SaleCollectionBcs, bytes); checkCollection(prior)
      commerceCheck(prior.members.id === c.members.id, 'HIST_COLLECTION_MEMBERS_TABLE') } })
  const field = decodeCommerce(SaleCollectionMemberBcs, member.bytes)
  commerceCheck(field.id === memberId && field.name === soulId && BigInt(field.value) > 0n
    && BigInt(field.value) <= BigInt(c.supply), 'HIST_COLLECTION_MEMBER')
  return { proof: 'original-collection-membership-and-royalty-only' as const, collectionId, soulId, creator: c.creator, holder: c.holder,
    royaltyBps: c.extra, snapshotHash: saleCollectionSnapshotHash(c),
    observed: { objectId: collectionId, version: String(original.reference.version), digest: original.reference.digest },
    member: { objectId: memberId, version: String(member.reference.version), digest: member.reference.digest, ordinal: field.value,
      writerTransactionDigest: member.writerTransactionDigest, trail: member.trail },
    requiresOriginalSoulCollectionBinding: true as const, notCurrentAuthority: true as const }
}
