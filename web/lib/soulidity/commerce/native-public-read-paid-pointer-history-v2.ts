import { bcs } from '@mysten/sui/bcs'
import { deriveDynamicFieldID } from '@mysten/sui/utils'
import { readHistoricalChildThroughParent } from '../../sui/historical-parent-lineage'
import { readHistoricalMoveObject } from '../../sui/historical-object'
import { readPinnedMovePackage } from '../../sui/pinned-move-package'
import { moveEmptyStructBytes, MoveEmptyStructBcs } from '../../sui/move-empty-struct'
import { NativePublicReadHostV2Bcs } from '../native-public-read-record-v2'
import { commerceCheck, decodeCommerce } from './economics-read'
import { proveNativePublicReadPaidReceiptV2 } from './native-public-read-paid-receipt-v2'

const Pointer = bcs.struct('Field', { id: bcs.Address,
  name: bcs.struct('Wrapper', { name: MoveEmptyStructBcs }), value: bcs.Address })

/** Original PaidKey pointer under State UID physically embedded in Shared Host.
 * Anchor finality is the caller's responsibility. No standalone State lookup,
 * current fallback, or inference that another descendant is embedded in Host.
 */
export async function proveNativePublicReadPaidPointerHistoryV2(input: Parameters<typeof proveNativePublicReadPaidReceiptV2>[0] & { checkpoint: string }) {
  const saved = structuredClone({ intent: input.intent, packet: input.packet, gas: input.gas, effects: input.effects, offer: input.offer,
    soulId: input.soulId, ledgerId: input.ledgerId, native: input.native, content: input.content, foundation: input.foundation, checkpoint: input.checkpoint })
  const { signal } = input, p = saved.intent
  const ledgerSource = input.client.ledgerService
  const client = { ledgerService: { getServiceInfo: ledgerSource.getServiceInfo.bind(ledgerSource), getTransaction: ledgerSource.getTransaction.bind(ledgerSource), getCheckpoint: ledgerSource.getCheckpoint.bind(ledgerSource), getObject: ledgerSource.getObject.bind(ledgerSource) } } as unknown as typeof input.client
  const receipt = await proveNativePublicReadPaidReceiptV2({ ...saved, client, signal })
  const native = await readPinnedMovePackage(client, saved.native, signal)
  const hostOrigin = native.origins.get('birth::PublicReadHostV2'), keyOrigin = native.origins.get('birth::PaidKey')
  commerceCheck(hostOrigin && keyOrigin, 'PUBLIC_PAID_V2_POINTER_ORIGIN')
  const hostType = `${hostOrigin}::birth::PublicReadHostV2`, wrapped = `0x2::dynamic_object_field::Wrapper<${keyOrigin}::birth::PaidKey>`
  const fieldId = deriveDynamicFieldID(receipt.stateId, wrapped, moveEmptyStructBytes())
  commerceCheck(!saved.effects.V2!.changedObjects.some(([id]) => id === fieldId), 'PUBLIC_PAID_V2_POINTER_CHANGED')
  const anchor = await readHistoricalMoveObject({ client, effects: saved.effects, transactionDigest: saved.packet.digest,
    objectId: p.host.objectId, type: hostType, mode: 'input', signal })
  const original = decodeCommerce(NativePublicReadHostV2Bcs, anchor.bytes)
  const child = await readHistoricalChildThroughParent({ client, anchorEffects: saved.effects, anchorTransactionDigest: saved.packet.digest,
    anchorMode: 'input', anchorCheckpoint: saved.checkpoint, rootId: p.host.objectId, rootType: hostType,
    parentUid: receipt.stateId, childId: fieldId, childType: `0x2::dynamic_field::Field<${wrapped},0x2::object::ID>`,
    chainIdentifier: '35834a8a', genesisDigest: '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S', signal,
    assertContainsParent: (bytes, uid) => {
      const host = decodeCommerce(NativePublicReadHostV2Bcs, bytes)
      commerceCheck(host.id === p.host.objectId && host.root === saved.soulId && host.state.id === uid
        && host.state.root === saved.soulId && host.state.protocol === p.config.objectId && host.state.registry === p.registry.objectId
        && host.state.schema === 1 && host.state.issuer.original === native.pin.originalPackageId
        && host.state.creator === original.state.creator, 'PUBLIC_PAID_V2_POINTER_HOST_ANCESTOR')
    } })
  const field = decodeCommerce(Pointer, child.bytes)
  commerceCheck(field.id === fieldId && field.name.name.dummy_field === false && field.value === saved.ledgerId, 'PUBLIC_PAID_V2_POINTER_VALUE')
  return { format: 'native-public-read-v2' as const, proof: 'original-paid-pointer-through-embedded-state-shared-host-only' as const,
    transactionDigest: saved.packet.digest, hostId: p.host.objectId, stateId: receipt.stateId, fieldId, ledgerId: field.value,
    writerTransactionDigest: child.writerTransactionDigest, trail: child.trail, requiresQualifiedHostParentCommitInvariant: true as const,
    requiresOriginalHostLinkAuthOfferAndCustodyProof: true as const, notCurrentAuthority: true as const, notContentDeliveryProof: true as const }
}
