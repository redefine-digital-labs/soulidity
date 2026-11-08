import { bcs } from '@mysten/sui/bcs'
import { deriveDynamicFieldID, normalizeStructTag } from '@mysten/sui/utils'
import { readHistoricalMoveObject } from '../../sui/historical-object'
import { readHistoricalChildThroughOwnedParent } from '../../sui/historical-owned-parent'
import { readPinnedMovePackage } from '../../sui/pinned-move-package'
import { moveEmptyStructBytes } from '../../sui/move-empty-struct'
import { publicMutationCanonical } from '../../sui/public-mutation-journal'
import { NativeInitialPaidBcs } from '../native-initial-children'
import { PaidContentOfferBcs } from './paid-content-policy'
import { commerceCheck, decodeCommerce } from './economics-read'
import { proveNativePublicReadPaidReceiptV2 } from './native-public-read-paid-receipt-v2'

export const NativePublicReadPaidOfferFieldV2Bcs = bcs.struct('Field', { id: bcs.Address, name: bcs.u32(), value: PaidContentOfferBcs })

/** V2 only: State UID comes from the original embedded Shared Host receipt.
 * Read the unchanged original Offer under the original Ledger's embedded Table.
 * Parent finality supplies the original checkpoint. Every ancestor must keep
 * that exact Table UID and root/controller identity. The generic lineage proof
 * still requires qualified deployed code proving child writes commit Ledger;
 * local source observations alone cannot clear that requirement.
 */
export async function proveNativePublicReadPaidOfferHistoryV2(input: Parameters<typeof proveNativePublicReadPaidReceiptV2>[0] & { checkpoint: string }) {
  const saved = structuredClone({ intent: input.intent, packet: input.packet, gas: input.gas, effects: input.effects, offer: input.offer,
    soulId: input.soulId, ledgerId: input.ledgerId, native: input.native, content: input.content, foundation: input.foundation, checkpoint: input.checkpoint })
  const { signal } = input, p = saved.intent
  const ledgerSource = input.client.ledgerService
  const client = { ledgerService: { getServiceInfo: ledgerSource.getServiceInfo.bind(ledgerSource), getTransaction: ledgerSource.getTransaction.bind(ledgerSource), getCheckpoint: ledgerSource.getCheckpoint.bind(ledgerSource), getObject: ledgerSource.getObject.bind(ledgerSource) } } as unknown as typeof input.client
  const receipt = await proveNativePublicReadPaidReceiptV2({ ...saved, client, signal })
  const native = await readPinnedMovePackage(client, saved.native, signal), content = await readPinnedMovePackage(client, saved.content, signal)
  const type = (origins: Map<string, string>, module: string, name: string) => { const origin = origins.get(`${module}::${name}`)
    commerceCheck(origin, 'PUBLIC_PAID_V2_OFFER_HISTORY_ORIGIN'); return `${origin}::${module}::${name}` }
  const ledgerType = type(content.origins, 'paid_access', 'Ledger'), offerType = type(content.origins, 'paid_access', 'Offer')
  const original = await readHistoricalMoveObject({ client, effects: saved.effects, transactionDigest: saved.packet.digest,
    objectId: saved.ledgerId, type: ledgerType, mode: 'input', signal }), ledger = decodeCommerce(NativeInitialPaidBcs, original.bytes)
  const ownerId = deriveDynamicFieldID(receipt.stateId, `0x2::dynamic_object_field::Wrapper<${type(native.origins, 'birth', 'PaidKey')}>`, moveEmptyStructBytes())
  const fieldId = deriveDynamicFieldID(ledger.offers.id, 'u32', bcs.u32().serialize(p.kind).toBytes())
  commerceCheck(!saved.effects.V2!.changedObjects.some(([id]) => id === fieldId), 'PUBLIC_PAID_V2_OFFER_HISTORY_CHANGED_DURING_BUY')
  const child = await readHistoricalChildThroughOwnedParent({ client, anchorEffects: saved.effects, anchorTransactionDigest: saved.packet.digest,
    anchorCheckpoint: saved.checkpoint, anchorMode: 'input', rootId: ledger.id, rootType: ledgerType, rootOwnerId: ownerId,
    childId: fieldId, childType: `0x2::dynamic_field::Field<u32,${offerType}>`, signal, chainIdentifier: '35834a8a',
    genesisDigest: '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S',
    nestedParent: { uid: ledger.offers.id, assertContainsParent: (bytes, uid) => {
      commerceCheck(decodeCommerce(NativeInitialPaidBcs, bytes).offers.id === uid, 'PUBLIC_PAID_V2_OFFER_HISTORY_TABLE_REBOUND')
    } }, assertRoot: bytes => { const old = decodeCommerce(NativeInitialPaidBcs, bytes)
      commerceCheck(old.id === saved.ledgerId && old.root === saved.soulId && old.protocol === p.config.objectId
        && old.controller.root === saved.soulId && old.controller.parent === receipt.stateId
        && normalizeStructTag(old.controller.operator.name) === type(native.origins, 'birth', 'ContentOperator')
        && BigInt(old.revision) <= BigInt(ledger.revision), 'PUBLIC_PAID_V2_OFFER_HISTORY_LEDGER_ANCESTOR')
    } })
  const field = decodeCommerce(NativePublicReadPaidOfferFieldV2Bcs, child.bytes)
  commerceCheck(field.id === fieldId && field.name === p.kind && publicMutationCanonical(field.value) === publicMutationCanonical(saved.offer)
    && BigInt(field.value.revision) <= BigInt(ledger.revision), 'PUBLIC_PAID_V2_OFFER_HISTORY_FIELD')
  return { format: 'native-public-read-v2' as const, proof: 'native-public-read-v2-original-offer-through-owned-ledger-lineage-only' as const, transactionDigest: saved.packet.digest,
    ledgerId: ledger.id, offersTableId: ledger.offers.id, fieldId, offer: field.value, writerTransactionDigest: child.writerTransactionDigest, trail: child.trail,
    requiresQualifiedParentCommitInvariant: true as const, requiresOriginalLedgerTreeMembership: true as const,
    notCurrentOffer: true as const, notContentDeliveryProof: true as const }
}
