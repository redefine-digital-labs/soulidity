import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID } from '@mysten/sui/utils'
import { quoteAnimacraftV8SoulSale } from '@soulidity/sdk'
import { attestNativeReceiveTarget, decodeNativeBcs, NativeReceiveError, receiveId,
  NativeSoulBcs, NativeSoulStateBcs, NativeSoulBindingBcs, type NativeReceiveTarget } from './native-receive'
import { EquipmentReadSet, EquipmentPointerBcs } from './native-equipment'

const A = bcs.Address, U = bcs.u64()
export const NativeMarketConfigBcs = bcs.struct('MarketConfigV2', {id:A,version:U,legacy_config_id:A,
  fee_recipient:A,platform_fee_bps:bcs.u16(),primary_enabled:bcs.bool(),secondary_enabled:bcs.bool()})
const PurchaseCap = bcs.struct('PurchaseCap', {id:A,kiosk_id:A,item_id:A,min_price:U})
export const NativeMarketListingBcs = bcs.struct('SoulListing', {id:A,version:U,soul_id:A,state_id:A,
  seller:A,seller_kiosk_id:A,price:U,creator:A,creator_royalty_bps:bcs.u16(),collection_id:bcs.option(A),
  purchase_cap:bcs.option(PurchaseCap),is_active:bcs.bool()})
function check(value: unknown, message: string): asserts value {
  if (!value) throw new NativeReceiveError('NATIVE_MARKET_INVALID', message)
}

/** Public metadata only. A listing ID is a lookup hint, never identity evidence.
 * This quote does not authorize a purchase or grant access to protected artwork. */
export async function readNativeMarketSnapshot(client: SuiGrpcClient, target: NativeReceiveTarget,
  input: {soulId:string;stateId:string;marketConfigId:string;listingId?:string|null}, signal?:AbortSignal,
  readSet?:EquipmentReadSet) {
  const soulId=receiveId(input.soulId),stateId=receiveId(input.stateId),configId=receiveId(input.marketConfigId)
  if(input.listingId != null)receiveId(input.listingId)
  signal?.throwIfAborted()
  const types=await attestNativeReceiveTarget(client,target,{market:true})
  const reads=readSet??new EquipmentReadSet(client)
  try {
    const config=decodeNativeBcs(NativeMarketConfigBcs,await reads.read(configId,types.marketTypes!.config,3))
    check(config.id===configId && config.version==='2' && /^0x0{64}$/.test(config.legacy_config_id), 'Fresh market config required')
    receiveId(config.fee_recipient)
    const state=decodeNativeBcs(NativeSoulStateBcs,await reads.read(stateId,types.stateType,3))
    check(state.id===stateId && state.soul_id===soulId && state.collection_id===null,'Native SoulState mismatch')
    receiveId(state.current_owner);receiveId(state.current_kiosk_id)
    const soul=decodeNativeBcs(NativeSoulBcs,await reads.kioskItem(soulId,types.soulType,state.current_kiosk_id))
    check(soul.id===soulId && soul.provenance_kind===3 && soul.creator===state.creator,'Native Soul custody/creator mismatch')
    const fieldId=deriveDynamicFieldID(stateId,'u8',new Uint8Array([9]))
    const field=decodeNativeBcs(EquipmentPointerBcs,await reads.read(fieldId,'0x2::dynamic_field::Field<u8,0x2::object::ID>',2,stateId))
    check(field.id===fieldId && field.name===9,'Native DF9 key mismatch')
    const binding=decodeNativeBcs(NativeSoulBindingBcs,await reads.read(receiveId(field.value),types.bindingType,4))
    check(binding.id===field.value && binding.version==='8' && binding.soul_id===soulId && binding.soul_state_id===stateId
      && binding.protocol_config_id===target.protocolConfigId && binding.original_holder===state.creator
      && binding.rights.soul_creator_royalty_bps===state.creator_royalty_bps,'Native immutable provenance mismatch')
    receiveId(binding.maker_creator);receiveId(state.creator)
    const rates={soulCreatorRoyaltyBps:state.creator_royalty_bps,makerSourceRoyaltyBps:binding.rights.maker_source_royalty_bps}
    // Validate rates even before a price has been selected.
    quoteAnimacraftV8SoulSale(1n,rates)
    let listing:null|{id:string;priceAtomic:string;quote:ReturnType<typeof stringifyQuote>}=null
    if(state.is_listed) {
      if(!input.listingId)throw new NativeReceiveError('NATIVE_MARKET_LISTING_UNAVAILABLE','Live listing lookup is required',409)
      const row=decodeNativeBcs(NativeMarketListingBcs,await reads.read(input.listingId,types.marketTypes!.listing,3))
      check(row.id===input.listingId && row.version==='8' && row.is_active && row.soul_id===soulId && row.state_id===stateId
        && row.seller===state.current_owner && row.seller_kiosk_id===state.current_kiosk_id && row.creator===state.creator
        && row.creator_royalty_bps===state.creator_royalty_bps && row.collection_id===null,'Listing differs from live native Soul')
      check(row.purchase_cap && row.purchase_cap.item_id===soulId && row.purchase_cap.kiosk_id===state.current_kiosk_id
        && row.purchase_cap.min_price==='0','Native listing purchase capability mismatch')
      receiveId(row.purchase_cap.id)
      // Current contract forbids listing while DF10 exists, even if empty.
      check(await reads.pointer(stateId)===null,'Listed Soul still has equipment custody')
      listing={id:row.id,priceAtomic:row.price,quote:stringifyQuote(quoteAnimacraftV8SoulSale(BigInt(row.price),rates))}
    }
    return {schema:'native-market-v1' as const,soulId,stateId,bindingId:binding.id,
      owner:state.current_owner,kioskId:state.current_kiosk_id,ownershipEpoch:state.ownership_epoch,
      creator:state.creator,makerCreator:binding.maker_creator,...rates,marketConfigId:configId,
      protocolFeeRecipient:config.fee_recipient,protocolFeeBps:250,
      secondaryEnabled:config.secondary_enabled,nativeFeePolicyValid:config.platform_fee_bps===250,
      purchaseAvailable:listing!==null && config.secondary_enabled && config.platform_fee_bps===250,listing}
  } finally {await reads.verify();signal?.throwIfAborted()}
}
function stringifyQuote(quote:ReturnType<typeof quoteAnimacraftV8SoulSale>) {
  return {priceAtomic:quote.priceAtomic.toString(),totalAtomic:quote.totalAtomic.toString(),
    platformFeeAtomic:quote.protocolFeeAtomic.toString(),creatorRoyaltyAtomic:quote.soulCreatorRoyaltyAtomic.toString(),
    makerRoyaltyAtomic:quote.makerSourceRoyaltyAtomic.toString(),sellerPayoutAtomic:quote.sellerPayoutAtomic.toString(),
    collectionRoyaltyAtomic:'0',makerRoyaltyBps:quote.makerSourceRoyaltyBps,
    soulCreatorRoyaltyBps:quote.soulCreatorRoyaltyBps,royaltySource:'animacraft-maker' as const}
}
