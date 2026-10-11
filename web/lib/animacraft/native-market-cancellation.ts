import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID } from '@mysten/sui/utils'
import { NativeMarketListingBcs } from './native-market'
import { EquipmentPointerBcs, EquipmentReadSet } from './native-equipment'
import { attestNativeReceiveTarget, decodeNativeBcs, NativeReceiveError, receiveId,
  NativeSoulBindingBcs, NativeSoulBcs, NativeSoulStateBcs, type NativeReceiveTarget } from './native-receive'

type CancellationTransaction = {
  digest?: string
  events?: Array<{ type?: string; parsedJson?: unknown }> | null
}

function check(value: unknown, message: string): asserts value {
  if (!value) throw new NativeReceiveError('NATIVE_CANCELLATION_INVALID', message)
}

/** Receipt and current custody only. Cancellation never depends on a market
 * gate, fee, artwork, Root lifecycle or a cached database listing ID. The caller
 * must obtain a successful transaction and authenticate its sender first. */
export async function verifyNativeMarketCancellation(client: SuiGrpcClient, target: NativeReceiveTarget,
  input: { soulId: string; stateId: string; txDigest: string; sender: string; transaction: CancellationTransaction },
  signal?: AbortSignal) {
  const snapshot = structuredClone(input)
  const pin = structuredClone(target)
  const soulId = receiveId(snapshot.soulId), stateId = receiveId(snapshot.stateId), seller = receiveId(snapshot.sender)
  signal?.throwIfAborted()
  check(snapshot.transaction.digest === snapshot.txDigest, 'Cancellation transaction digest mismatch')
  const eventType = `${pin.soulidityOriginalPackageId}::market::SoulListingCancelled`
  const events = snapshot.transaction.events?.filter(event => event.type === eventType) ?? []
  check(events.length === 1, 'Exactly one original-package cancellation event required')
  const event = events[0].parsedJson
  check(event && typeof event === 'object' && !Array.isArray(event), 'Cancellation event fields missing')
  const fields = event as Record<string, unknown>
  check(Object.keys(fields).sort().join() === 'listing_id,seller,soul_id', 'Unexpected cancellation event fields')
  const listingId = receiveId(fields.listing_id)
  check(receiveId(fields.soul_id) === soulId && receiveId(fields.seller) === seller, 'Cancellation Soul or seller mismatch')

  const types = await attestNativeReceiveTarget(client, pin, { market: true })
  check(types.marketTypes!.listing === `${pin.soulidityOriginalPackageId}::market::SoulListing`, 'Native listing origin mismatch')
  const reads = new EquipmentReadSet(client)
  const state = decodeNativeBcs(NativeSoulStateBcs, await reads.read(stateId, types.stateType, 3))
  const kioskId = receiveId(state.current_kiosk_id)
  const soul = decodeNativeBcs(NativeSoulBcs, await reads.kioskItem(soulId, types.soulType, kioskId))
  check(state.id === stateId && state.soul_id === soulId && soul.id === soulId
    && soul.provenance_kind === 3 && state.creator === soul.creator && state.collection_id === null,
  'Native Soul identity mismatch')
  if (state.current_owner !== seller || state.is_listed) {
    throw new NativeReceiveError('NATIVE_CANCELLATION_OWNER_CHANGED', 'Cancelled Soul is no longer held by this seller', 409)
  }
  const fieldId = deriveDynamicFieldID(stateId, 'u8', new Uint8Array([9]))
  const field = decodeNativeBcs(EquipmentPointerBcs,
    await reads.read(fieldId, '0x2::dynamic_field::Field<u8,0x2::object::ID>', 2, stateId))
  check(field.id === fieldId && field.name === 9, 'Native DF9 key mismatch')
  const bindingId = receiveId(field.value)
  const binding = decodeNativeBcs(NativeSoulBindingBcs, await reads.read(bindingId, types.bindingType, 4))
  check(binding.id === bindingId && binding.version === '8' && binding.soul_id === soulId
    && binding.soul_state_id === stateId && binding.protocol_config_id === pin.protocolConfigId
    && binding.original_holder === state.creator && binding.rights.soul_creator_royalty_bps === state.creator_royalty_bps,
  'Native immutable identity/creator rights mismatch')
  receiveId(binding.maker_creator); receiveId(state.creator)

  const listing = decodeNativeBcs(NativeMarketListingBcs, await reads.read(listingId, types.marketTypes!.listing, 3))
  check(listing.id === listingId && listing.version === '8' && !listing.is_active && listing.purchase_cap === null
    && listing.soul_id === soulId && listing.state_id === stateId && listing.seller === seller
    && listing.seller_kiosk_id === kioskId && listing.creator === state.creator
    && listing.creator_royalty_bps === state.creator_royalty_bps && listing.collection_id === null,
  'Cancellation listing differs from the current native Soul')
  const verifyReadSet = async () => {
    signal?.throwIfAborted()
    await reads.verify()
    signal?.throwIfAborted()
  }
  await verifyReadSet()
  return { ownerAddress: seller, kioskId, ownershipEpoch: state.ownership_epoch, verifyReadSet }
}
