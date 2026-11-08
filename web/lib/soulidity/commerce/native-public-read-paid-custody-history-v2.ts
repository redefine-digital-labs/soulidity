import { bcs } from '@mysten/sui/bcs'
import { deriveDynamicFieldID } from '@mysten/sui/utils'
import { deriveKioskItemFieldId, assertKioskItemField, KIOSK_ITEM_FIELD_TYPE, SoulPublicKioskBcs } from '@soulidity/sdk'
import { readHistoricalChildThroughParent } from '../../sui/historical-parent-lineage'
import { commerceCheck, decodeCommerce } from './economics-read'
import { proveNativePublicReadPaidReceiptV2 } from './native-public-read-paid-receipt-v2'

const Lock = bcs.struct('Field', { id: bcs.Address, name: bcs.struct('Lock', { id: bcs.Address }), value: bcs.bool() })

/** Original readonly Kiosk Item/Lock at paid buy. V2 does not require a
 * SourceService, Account, no-listing proof, or extensions-disabled Kiosk.
 * Parent must authenticate anchor finality and still prove actual Soul type,
 * Item ownership and Soul Link -> Host; these fields alone do not do that.
 */
export async function proveNativePublicReadPaidCustodyHistoryV2(input: Parameters<typeof proveNativePublicReadPaidReceiptV2>[0] & { checkpoint: string }) {
  const saved = structuredClone({ intent: input.intent, packet: input.packet, gas: input.gas, effects: input.effects, offer: input.offer,
    soulId: input.soulId, ledgerId: input.ledgerId, native: input.native, content: input.content, foundation: input.foundation, checkpoint: input.checkpoint })
  const { signal } = input, p = saved.intent
  const ledgerSource = input.client.ledgerService
  const client = { ledgerService: { getServiceInfo: ledgerSource.getServiceInfo.bind(ledgerSource), getTransaction: ledgerSource.getTransaction.bind(ledgerSource), getCheckpoint: ledgerSource.getCheckpoint.bind(ledgerSource), getObject: ledgerSource.getObject.bind(ledgerSource) } } as unknown as typeof input.client
  await proveNativePublicReadPaidReceiptV2({ ...saved, client, signal })
  const itemId = deriveKioskItemFieldId(p.kiosk.objectId, saved.soulId)
  const lockId = deriveDynamicFieldID(p.kiosk.objectId, '0x2::kiosk::Lock', bcs.Address.serialize(saved.soulId).toBytes())
  commerceCheck(!saved.effects.V2!.changedObjects.some(([id]) => id === itemId || id === lockId), 'PUBLIC_PAID_V2_CUSTODY_CHILD_CHANGED')
  const child = (childId: string, childType: string) => readHistoricalChildThroughParent({ client, anchorEffects: saved.effects,
    anchorTransactionDigest: saved.packet.digest, anchorMode: 'readonly', anchorCheckpoint: saved.checkpoint,
    rootId: p.kiosk.objectId, rootType: '0x2::kiosk::Kiosk', parentUid: p.kiosk.objectId, childId, childType,
    chainIdentifier: '35834a8a', genesisDigest: '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S', signal,
    assertContainsParent: (bytes, uid) => {
      commerceCheck(decodeCommerce(SoulPublicKioskBcs, bytes).id === uid, 'PUBLIC_PAID_V2_CUSTODY_KIOSK_ANCESTOR')
    } })
  const item = await child(itemId, KIOSK_ITEM_FIELD_TYPE)
  commerceCheck(assertKioskItemField(item.bytes, p.kiosk.objectId, saved.soulId) === itemId, 'PUBLIC_PAID_V2_CUSTODY_ITEM')
  const lock = await child(lockId, '0x2::dynamic_field::Field<0x2::kiosk::Lock,bool>'), value = decodeCommerce(Lock, lock.bytes)
  commerceCheck(value.id === lockId && value.name.id === saved.soulId && value.value, 'PUBLIC_PAID_V2_CUSTODY_LOCK')
  return { format: 'native-public-read-v2' as const, proof: 'original-readonly-kiosk-item-lock-history-only' as const,
    transactionDigest: saved.packet.digest, kioskId: p.kiosk.objectId, soulId: saved.soulId, itemFieldId: itemId, lockFieldId: lockId,
    itemWriterTransactionDigest: item.writerTransactionDigest, lockWriterTransactionDigest: lock.writerTransactionDigest,
    itemTrail: item.trail, lockTrail: lock.trail, requiresOriginalSoulTypeOwnerAndHostLinkProof: true as const,
    notCurrentCustody: true as const, notContentDeliveryProof: true as const }
}
