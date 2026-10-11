import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, fromBase58, toBase58 } from '@mysten/sui/utils'
import { assertKioskItemField, deriveKioskItemFieldId, KIOSK_ITEM_FIELD_TYPE, quoteAnimacraftV8SoulSale } from '@soulidity/sdk'
import { NativeMarketListingBcs } from './native-market'
import { EquipmentPointerBcs, EquipmentReadSet } from './native-equipment'
import { attestNativeReceiveTarget, decodeNativeBcs, NativeReceiveError, receiveId,
  NativeSoulBindingBcs, NativeSoulBcs, NativeSoulStateBcs, type NativeReceiveTarget } from './native-receive'

type ListingTransaction = { digest?: string; events?: Array<{ type?: string; parsedJson?: unknown }> | null }
function check(value: unknown, message: string): asserts value {
  if (!value) throw new NativeReceiveError('NATIVE_LISTING_INVALID', message)
}
function unchanged(value: unknown, message: string): asserts value {
  if (!value) throw new NativeReceiveError('NATIVE_LISTING_STATE_CHANGED', message, 409)
}
function price(value: unknown) {
  check(typeof value === 'bigint' || typeof value === 'string' && value.length <= 20 && /^(0|[1-9][0-9]*)$/.test(value)
    || typeof value === 'number' && Number.isSafeInteger(value), 'Listing price must be an exact u64')
  const result = BigInt(value)
  check(result > 0n && result <= 18446744073709551615n, 'Listing price must be a positive u64')
  return result
}

/** The caller authenticates the sender and obtains a successful transaction.
 * SoulListed is shared with ordinary/obsolete paths, so the event alone cannot
 * certify native listing: exact live V8 listing, immutable DF9 and custody must
 * agree. Unrelated Soul events (and a reprice's earlier cancel) are not targets.
 * No market flag, fee config, database listing/cap or Maker lifecycle is read. */
export async function verifyNativeMarketListing(client: SuiGrpcClient, target: NativeReceiveTarget,
  input: { soulId: string; stateId: string; txDigest: string; sender: string; transaction: ListingTransaction },
  signal?: AbortSignal) {
  const snapshot = structuredClone(input), pin = structuredClone(target)
  const soulId = receiveId(snapshot.soulId), stateId = receiveId(snapshot.stateId), seller = receiveId(snapshot.sender)
  signal?.throwIfAborted()
  check(snapshot.transaction.digest === snapshot.txDigest && typeof snapshot.txDigest === 'string'
    && snapshot.txDigest.length <= 44, 'Listing transaction digest mismatch')
  let digest: Uint8Array
  try { digest = fromBase58(snapshot.txDigest) } catch { throw new NativeReceiveError('NATIVE_LISTING_INVALID', 'Invalid listing transaction digest') }
  check(digest.length === 32 && toBase58(digest) === snapshot.txDigest, 'Invalid listing transaction digest')
  const eventType = `${pin.soulidityOriginalPackageId}::market::SoulListed`
  const events = snapshot.transaction.events?.filter(event => event.type === eventType && event.parsedJson
    && typeof event.parsedJson === 'object' && !Array.isArray(event.parsedJson)
    && (event.parsedJson as Record<string, unknown>).soul_id === soulId) ?? []
  check(events.length === 1, 'Exactly one original-package listing event for this Soul is required')
  const fields = events[0].parsedJson as Record<string, unknown>
  check(Object.keys(fields).sort().join() === 'kiosk_id,listing_id,price,seller,soul_id', 'Unexpected listing event fields')
  const listingId = receiveId(fields.listing_id), kioskId = receiveId(fields.kiosk_id), priceAtomic = price(fields.price)
  check(receiveId(fields.seller) === seller, 'Listing seller differs from the authenticated sender')

  const types = await attestNativeReceiveTarget(client, pin, { market: true })
  check(types.marketTypes!.listing === `${pin.soulidityOriginalPackageId}::market::SoulListing`, 'Native listing type origin mismatch')
  const reads = new EquipmentReadSet(client)
  // Missing evidence is not a superseded listing. Preserve retryability instead
  // of translating transport/absence/abort failures into a business 409.
  const read = async (objectId: string, type: string, kind: number, address?: string) => {
    signal?.throwIfAborted()
    const { response } = await client.ledgerService.getObject({ objectId,
      readMask: { paths: ['object_id','version','digest','owner','object_type','contents'] } }, { abort: signal })
    signal?.throwIfAborted()
    if (!response.object || !response.object.contents?.value) {
      throw new NativeReceiveError('NATIVE_LISTING_UNAVAILABLE', 'Live listing evidence is unavailable', 503)
    }
    return reads.accept(response.object, objectId, type, kind, address)
  }
  const state = decodeNativeBcs(NativeSoulStateBcs, await read(stateId, types.stateType, 3))
  check(state.id === stateId && state.soul_id === soulId && state.collection_id === null, 'Native SoulState identity mismatch')
  receiveId(state.creator); receiveId(state.current_owner); receiveId(state.current_kiosk_id)
  unchanged(state.current_owner === seller && state.current_kiosk_id === kioskId && state.is_listed,
    'Soul ownership, kiosk or listed state changed after this receipt')
  const itemFieldId = deriveKioskItemFieldId(kioskId, soulId)
  const itemBytes = await read(itemFieldId, KIOSK_ITEM_FIELD_TYPE, 2, kioskId)
  check(itemBytes instanceof Uint8Array, 'Kiosk Item field BCS missing')
  assertKioskItemField(itemBytes, kioskId, soulId)
  const soul = decodeNativeBcs(NativeSoulBcs, await read(soulId, types.soulType, 2, itemFieldId))
  check(soul.id === soulId && soul.provenance_kind === 3 && state.creator === soul.creator, 'Native Soul identity/creator mismatch')
  const fieldId = deriveDynamicFieldID(stateId, 'u8', new Uint8Array([9]))
  const field = decodeNativeBcs(EquipmentPointerBcs, await read(fieldId, '0x2::dynamic_field::Field<u8,0x2::object::ID>', 2, stateId))
  check(field.id === fieldId && field.name === 9, 'Native DF9 key mismatch')
  const bindingId = receiveId(field.value)
  const binding = decodeNativeBcs(NativeSoulBindingBcs, await read(bindingId, types.bindingType, 4))
  check(binding.id === bindingId && binding.version === '8' && binding.soul_id === soulId && binding.soul_state_id === stateId
    && binding.protocol_config_id === pin.protocolConfigId && binding.original_holder === state.creator
    && binding.rights.soul_creator_royalty_bps === state.creator_royalty_bps, 'Native immutable identity/creator rights mismatch')
  receiveId(binding.maker_creator)
  // Core rights bounds are an immutable native invariant, not a current fee or
  // admission gate. Use the existing exact quote validator, without config I/O.
  try { quoteAnimacraftV8SoulSale(priceAtomic, { soulCreatorRoyaltyBps: state.creator_royalty_bps,
    makerSourceRoyaltyBps: binding.rights.maker_source_royalty_bps }) }
  catch { throw new NativeReceiveError('NATIVE_LISTING_INVALID', 'Invalid native immutable royalty schedule') }

  const listing = decodeNativeBcs(NativeMarketListingBcs, await read(listingId, types.marketTypes!.listing, 3))
  check(listing.id === listingId && listing.version === '8' && listing.soul_id === soulId && listing.state_id === stateId
    && listing.seller === seller && listing.seller_kiosk_id === kioskId && listing.creator === state.creator
    && listing.creator_royalty_bps === state.creator_royalty_bps && listing.collection_id === null,
  'Listing differs from this native Soul and receipt')
  unchanged(listing.is_active && listing.purchase_cap !== null && BigInt(listing.price) === priceAtomic,
    'Listing was sold, cancelled or repriced after this receipt')
  check(listing.purchase_cap!.item_id === soulId && listing.purchase_cap!.kiosk_id === kioskId
    && listing.purchase_cap!.min_price === '0', 'Native listing PurchaseCap binding mismatch')
  receiveId(listing.purchase_cap!.id)
  unchanged(await reads.pointer(stateId) === null, 'Soul equipment custody changed after this listing')
  const verifyReadSet = async () => {
    signal?.throwIfAborted()
    // Preserve generic retryable read drift (not a claim of later cancellation).
    await reads.verify()
    unchanged(await reads.pointer(stateId) === null, 'Soul equipment custody changed after this listing')
    await reads.verify()
    signal?.throwIfAborted()
  }
  await verifyReadSet()
  return { ownerAddress: seller, kioskId, ownershipEpoch: state.ownership_epoch, listingId, priceAtomic, verifyReadSet }
}
