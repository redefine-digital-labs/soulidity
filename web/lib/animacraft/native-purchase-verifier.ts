import type { tryExtractAnimacraftV8SoulPurchasedEvent } from '@soulidity/sdk'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID } from '@mysten/sui/utils'
import { attestNativeReceiveTarget, createNativeReceiveClient, readNativeReceiveTarget,
  NativeReceiveError, decodeNativeBcs, NativeSoulBcs, NativeSoulStateBcs, NativeSoulBindingBcs, type NativeReceiveTarget } from './native-receive'
import { EquipmentReadSet, EquipmentPointerBcs } from './native-equipment'

/** Purchase identity only: no artwork download, decryption or equipment grant. */
export async function verifyNativePurchase(soulId: string, stateId: string,
  purchase: NonNullable<ReturnType<typeof tryExtractAnimacraftV8SoulPurchasedEvent>>,
  packageId: string, signal: AbortSignal) {
  const target = readNativeReceiveTarget()
  if (target.soulidityOriginalPackageId !== packageId) {
    throw new NativeReceiveError('NATIVE_PURCHASE_TARGET_MISMATCH', 'Purchase package differs from native target', 503)
  }
  const client = createNativeReceiveClient(signal)
  return verifyNativePurchaseWithClient(client, target, soulId, stateId, purchase, signal)
}

/** Same verified purchase custody path with an explicit captured browser release
 * and client. Existing agent callers retain their configured wrapper above. */
export async function verifyNativePurchaseWithClient(client: SuiGrpcClient, targetInput: NativeReceiveTarget,
  soulId: string, stateId: string,
  purchaseInput: NonNullable<ReturnType<typeof tryExtractAnimacraftV8SoulPurchasedEvent>>, signal: AbortSignal) {
  const target = structuredClone(targetInput), purchase = structuredClone(purchaseInput)
  const { provenanceId: bindingId, buyerAddress: buyer } = purchase
  signal.throwIfAborted()
  const types = await attestNativeReceiveTarget(client, target)
  const reads = new EquipmentReadSet(client)
  const state = decodeNativeBcs(NativeSoulStateBcs, await reads.read(stateId, types.stateType, 3))
  const soul = decodeNativeBcs(NativeSoulBcs, await reads.kioskItem(soulId, types.soulType, state.current_kiosk_id))
  if (state.id !== stateId || state.soul_id !== soulId || soul.id !== soulId || soul.provenance_kind !== 3
    || state.current_owner !== buyer || state.is_listed) {
    throw new NativeReceiveError('NATIVE_PURCHASE_OWNER_CHANGED', 'Purchased Soul is no longer held by this buyer', 409)
  }
  const fieldId = deriveDynamicFieldID(stateId, 'u8', new Uint8Array([9]))
  const field = decodeNativeBcs(EquipmentPointerBcs,
    await reads.read(fieldId, '0x2::dynamic_field::Field<u8,0x2::object::ID>', 2, stateId))
  const binding = decodeNativeBcs(NativeSoulBindingBcs, await reads.read(bindingId, types.bindingType, 4))
  if (field.id !== fieldId || field.name !== 9 || field.value !== bindingId
    || binding.id !== bindingId || binding.version !== '8' || binding.soul_id !== soulId
    || binding.soul_state_id !== stateId || binding.protocol_config_id !== target.protocolConfigId
    || binding.original_holder !== state.creator || state.creator !== soul.creator
    || binding.maker_creator !== purchase.makerSourceRecipientAddress
    || binding.rights.soul_creator_royalty_bps !== purchase.soulCreatorRoyaltyBps
    || state.creator_royalty_bps !== purchase.soulCreatorRoyaltyBps
    || binding.rights.maker_source_royalty_bps !== purchase.makerSourceRoyaltyBps) {
    throw new NativeReceiveError('NATIVE_PURCHASE_BINDING_MISMATCH', 'Purchase does not match the exact native DF9 binding')
  }
  await reads.verify()
  signal.throwIfAborted()
  return { ownerAddress: buyer, kioskId: state.current_kiosk_id, ownershipEpoch: state.ownership_epoch,
    verifyReadSet: () => reads.verify() }
}
