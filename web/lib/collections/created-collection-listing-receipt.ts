import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, fromBase64, normalizeStructTag, toBase64 } from '@mysten/sui/utils'
import { profileReadStep, SoulPublicCollectionBcs, SoulPublicCollectionRightBcs, SoulPublicKioskBcs,
  CollectionPublicListingBcs, CollectionKioskListingKeyBcs, CollectionKioskListingFieldBcs,
  deriveKioskItemFieldId, KioskItemFieldBcs, KIOSK_ITEM_FIELD_TYPE } from '@soulidity/sdk'
import { readActivityTransactionEvidence, type ActivityDeployment } from '../soulidity/activity-transaction-evidence'
import { readHistoricalMoveObject } from '../sui/historical-object'

const A = bcs.Address
const Minted = bcs.struct('CollectionMintedToKiosk', { collection_id: A, right_id: A, owner: A, kiosk_id: A, tradeable: bcs.bool() })
const Listed = bcs.struct('CollectionListed', { listing_id: A, collection_id: A, right_id: A, seller: A, kiosk_id: A, price: bcs.u64() })
function check(value: unknown, message: string): asserts value { if (!value) throw new Error('COLLECTION_CREATED_LISTING_' + message) }
function id(value: unknown): asserts value is string {
  check(typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value), 'INVALID_ID')
}
function decode<T>(codec: { parse(bytes: Uint8Array): T; serialize(value: any): { toBytes(): Uint8Array } }, bytes: Uint8Array): T {
  const parsed = codec.parse(bytes)
  check(toBase64(codec.serialize(parsed).toBytes()) === toBase64(bytes), 'NONCANONICAL_CONTENTS')
  return parsed
}

/** Receipt for the existing create+[optional list] PTB's bundled listing.
 * This is not a standalone list command, current listing status, SQL sync or
 * signing authorization. A successful creation can coexist with Walrus register
 * events and other objects; prove this exact Collection/Right/listing output.
 */
export async function readCreatedCollectionListingReceipt(params: {
  client: SuiGrpcClient; deployment: ActivityDeployment; transactionDigest: string; author: string;
  collectionId: string; rightId: string; priceAtomic: string; signal?: AbortSignal
}) {
  const { client } = params
  const expected = structuredClone({ deployment: params.deployment, transactionDigest: params.transactionDigest,
    author: params.author, collectionId: params.collectionId, rightId: params.rightId, priceAtomic: params.priceAtomic })
  id(expected.author); id(expected.collectionId); id(expected.rightId)
  check(/^[1-9][0-9]{0,19}$/.test(expected.priceAtomic) && BigInt(expected.priceAtomic) <= 18446744073709551615n, 'INVALID_PRICE')
  const signal = AbortSignal.any([AbortSignal.timeout(30000), ...(params.signal ? [params.signal] : [])])
  return profileReadStep(signal, async () => {
    const evidence = await readActivityTransactionEvidence({ client, deployment: expected.deployment,
      transactionDigest: expected.transactionDigest, signal })
    check(evidence.sender === expected.author, 'AUTHOR_MISMATCH')
    const effects = bcs.TransactionEffects.parse(fromBase64(evidence.effectsBytes)), e = effects.V2
    check(e && e.status.$kind === 'Success', 'V2_SUCCESS_REQUIRED')
    const pkg = expected.deployment.originalPackageId
    const minted = evidence.events.filter(event => normalizeStructTag(event.type) === pkg + '::market::CollectionMintedToKiosk')
      .map(event => ({ sequence: event.eventSequence, value: decode(Minted, fromBase64(event.contentsBytes)) }))
      .filter(event => event.value.collection_id === expected.collectionId)
    const listed = evidence.events.filter(event => normalizeStructTag(event.type) === pkg + '::market::CollectionListed')
      .map(event => ({ sequence: event.eventSequence, value: decode(Listed, fromBase64(event.contentsBytes)) }))
      .filter(event => event.value.collection_id === expected.collectionId)
    check(minted.length === 1 && listed.length === 1 && minted[0].sequence < listed[0].sequence, 'EVENT_RELATION')
    const m = minted[0].value, l = listed[0].value
    id(m.kiosk_id); id(l.listing_id)
    check(m.owner === expected.author && m.right_id === expected.rightId && m.tradeable
      && l.right_id === expected.rightId && l.seller === expected.author && l.kiosk_id === m.kiosk_id
      && l.price === expected.priceAtomic, 'EVENT_MISMATCH')
    const itemId = deriveKioskItemFieldId(m.kiosk_id, expected.rightId)
    const markerId = deriveDynamicFieldID(m.kiosk_id, '0x2::kiosk::Listing',
      CollectionKioskListingKeyBcs.serialize({ id: expected.rightId, is_exclusive: true }).toBytes())
    check(new Set([expected.collectionId, expected.rightId, m.kiosk_id, l.listing_id, itemId, markerId]).size === 6, 'DUPLICATE_ID')
    const object = (objectId: string, type: string, mode: 'created' | 'written' = 'created') => readHistoricalMoveObject({
      client, effects, transactionDigest: expected.transactionDigest, objectId, type, mode, signal, maxBytes: 262144,
    })
    const [root, right, item, kiosk, listing, marker] = await Promise.all([
      object(expected.collectionId, pkg + '::collection::SoulCollection'),
      object(expected.rightId, pkg + '::collection::SoulCollectionRight'),
      object(itemId, KIOSK_ITEM_FIELD_TYPE), object(m.kiosk_id, '0x2::kiosk::Kiosk', 'written'),
      object(l.listing_id, pkg + '::market::CollectionListing'),
      object(markerId, '0x2::dynamic_field::Field<0x2::kiosk::Listing,u64>'),
    ])
    const c = decode(SoulPublicCollectionBcs, root.bytes), r = decode(SoulPublicCollectionRightBcs, right.bytes)
    const k = decode(SoulPublicKioskBcs, kiosk.bytes), i = decode(KioskItemFieldBcs, item.bytes)
    const sale = decode(CollectionPublicListingBcs, listing.bytes), reservation = decode(CollectionKioskListingFieldBcs, marker.bytes)
    check(root.object.owner.Shared?.initialSharedVersion === e.lamportVersion && c.id === expected.collectionId && c.version === '1'
      && c.creator === expected.author && c.current_holder === expected.author && c.current_holder_kiosk_id === m.kiosk_id
      && c.right_id === expected.rightId && c.tradeable, 'COLLECTION_OUTPUT')
    check(r.id === expected.rightId && r.version === '1' && r.collection_id === c.id && r.creator === expected.author
      && right.object.owner.ObjectOwner === itemId, 'RIGHT_OUTPUT')
    check(item.object.owner.ObjectOwner === m.kiosk_id && i.id === itemId && i.name.name.id === expected.rightId && i.value === expected.rightId, 'ITEM_OUTPUT')
    check(kiosk.object.owner.Shared && k.id === m.kiosk_id && k.owner === expected.author && k.item_count > 0, 'KIOSK_OUTPUT')
    check(listing.object.owner.Shared?.initialSharedVersion === e.lamportVersion
      && sale.id === l.listing_id && sale.version === '1' && sale.collection_id === c.id && sale.right_id === r.id
      && sale.seller === expected.author && sale.seller_kiosk_id === k.id && sale.price === expected.priceAtomic
      && sale.is_active && sale.purchase_cap?.kiosk_id === k.id && sale.purchase_cap.item_id === r.id
      && sale.purchase_cap.min_price === '0', 'LISTING_OUTPUT')
    id(sale.purchase_cap.id)
    check(![c.id, r.id, k.id, sale.id, itemId, markerId].includes(sale.purchase_cap.id), 'PURCHASE_CAP_ID')
    check(marker.object.owner.ObjectOwner === k.id && reservation.id === markerId && reservation.name.id === r.id
      && reservation.name.is_exclusive && reservation.value === '0', 'RESERVATION_OUTPUT')
    signal.throwIfAborted()
    return Object.freeze({ transactionDigest: evidence.transactionDigest, collectionId: c.id, rightId: r.id,
      listingId: sale.id, seller: expected.author, kioskId: k.id, priceAtomic: sale.price, checkpoint: evidence.checkpoint,
      createdAtMs: evidence.checkpointTimestampMs, statusAtCreation: 'LISTED' as const,
      currentStatus: 'NOT_READ' as const, historyAuthority: evidence.eventAuthority, notAuthorization: true as const })
  })
}
