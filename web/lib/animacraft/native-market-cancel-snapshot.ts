import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID } from '@mysten/sui/utils'
import { listOwnedPersonalKioskCaps } from '@soulidity/sdk'
import type { MarketCancelSnapshot } from './market-cancel-operation'
import { NativeMarketListingBcs } from './native-market'
import { EquipmentPointerBcs, EquipmentReadSet } from './native-equipment'
import { attestNativeReceiveTarget, decodeNativeBcs, NativeReceiveError, receiveId,
  NativeSoulBindingBcs, NativeSoulBcs, NativeSoulStateBcs, type NativeReceiveTarget } from './native-receive'

// Actual dependency family in Move.toml and the fresh publisher. Cap type
// origin is resolved from its linked package, never inferred from this address.
const KIOSK_FAMILY = '0x434b5bd8f6a7b05fede0ff46c6e511d71ea326ed38056e3bcd681d2d7c2a7879'
const A = bcs.Address
export const NativeCancelKioskBcs = bcs.struct('Kiosk', {
  id:A, profits:bcs.u64(), owner:A, item_count:bcs.u32(), allow_extensions:bcs.bool(),
})
export const NativeCancelPersonalKioskCapBcs = bcs.struct('PersonalKioskCap', {
  id:A, cap:bcs.option(bcs.struct('KioskOwnerCap', { id:A, for:A })),
})
function check(value: unknown, message: string): asserts value {
  if (!value) throw new NativeReceiveError('NATIVE_MARKET_CANCEL_INVALID', message)
}

async function capType(client:SuiGrpcClient, target:NativeReceiveTarget) {
  const read = async (id:string) => {
    const {response} = await client.ledgerService.getObject({objectId:id,
      readMask:{paths:['object_id','version','digest','owner','package']}})
    const object=response.object, pkg=object?.package
    check(object?.objectId===id && object.version!==undefined && object.owner?.kind===4 && pkg?.storageId===id
      && pkg.version===object.version && object.version>0n, 'Kiosk package identity mismatch')
    return {object,pkg}
  }
  const native=await read(target.soulidityCallablePackageId)
  check(native.object.digest===target.soulidityCallableDigest && native.pkg.originalId===target.soulidityOriginalPackageId,
    'Native package pin mismatch')
  const edges=native.pkg.linkage.filter(edge=>edge.originalId===KIOSK_FAMILY)
  check(edges.length===1, 'Exact Kiosk dependency required')
  const linked=await read(receiveId(edges[0].upgradedId))
  check(linked.pkg.originalId===KIOSK_FAMILY && linked.pkg.version===edges[0].upgradedVersion,
    'Kiosk dependency differs from native linkage')
  const rows=linked.pkg.typeOrigins.filter(row=>row.moduleName==='personal_kiosk' && row.datatypeName==='PersonalKioskCap')
  check(rows.length===1 && linked.pkg.modules.some(row=>row.name==='personal_kiosk' && row.contents && row.contents.length>4),
    'Exact PersonalKioskCap origin missing')
  return `${receiveId(rows[0].packageId)}::personal_kiosk::PersonalKioskCap`
}

async function abortable<T>(promise:Promise<T>, signal?:AbortSignal):Promise<T> {
  if(!signal)return promise
  if(signal.aborted) {
    // Discovery may synchronously abort before returning its promise. Keep a
    // rejection handler attached even though the caller has already stopped.
    void promise.catch(()=>{})
    signal.throwIfAborted()
  }
  let abort:()=>void=()=>{}
  try {
    return await Promise.race([promise,new Promise<never>((_,reject)=>{
      abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true})
    })])
  } finally {signal.removeEventListener('abort',abort)}
}

/** Public pre-sign facts only, with fail-closed release switch. Lookup hints and
 * owned-object discovery never replace exact BCS, custody and final readback. */
export async function readNativeMarketCancelSnapshot(client:SuiGrpcClient, target:NativeReceiveTarget,
  input:{soulId:string;stateId:string;listingId?:string|null;kioskCapId?:string|null}, signal?:AbortSignal,
  discoverCaps:typeof listOwnedPersonalKioskCaps=listOwnedPersonalKioskCaps):Promise<MarketCancelSnapshot> {
  const pin=structuredClone(target), request=structuredClone(input)
  const soulId=receiveId(request.soulId),stateId=receiveId(request.stateId)
  if(!request.listingId)throw new NativeReceiveError('NATIVE_MARKET_CANCEL_LISTING_UNAVAILABLE','Listing lookup is required',409)
  const listingId=receiveId(request.listingId)
  if(request.kioskCapId!=null)receiveId(request.kioskCapId)
  signal?.throwIfAborted()
  const types=await attestNativeReceiveTarget(client,pin,{market:true})
  check(types.marketTypes!.listing===`${pin.soulidityOriginalPackageId}::market::SoulListing`,'Listing origin mismatch')
  const personalCapType=await capType(client,pin)
  const reads=new EquipmentReadSet(client)
  const state=decodeNativeBcs(NativeSoulStateBcs,await reads.read(stateId,types.stateType,3))
  const owner=receiveId(state.current_owner),kioskId=receiveId(state.current_kiosk_id)
  const soul=decodeNativeBcs(NativeSoulBcs,await reads.kioskItem(soulId,types.soulType,kioskId))
  check(state.id===stateId && state.soul_id===soulId && soul.id===soulId && soul.provenance_kind===3
    && soul.creator===state.creator && state.collection_id===null,'Native Soul identity mismatch')
  const fieldId=deriveDynamicFieldID(stateId,'u8',new Uint8Array([9]))
  const field=decodeNativeBcs(EquipmentPointerBcs,await reads.read(fieldId,'0x2::dynamic_field::Field<u8,0x2::object::ID>',2,stateId))
  check(field.id===fieldId && field.name===9,'Native DF9 key mismatch')
  const bindingId=receiveId(field.value)
  const binding=decodeNativeBcs(NativeSoulBindingBcs,await reads.read(bindingId,types.bindingType,4))
  check(binding.id===bindingId && binding.version==='8' && binding.soul_id===soulId && binding.soul_state_id===stateId
    && binding.protocol_config_id===pin.protocolConfigId && binding.original_holder===state.creator
    && binding.rights.soul_creator_royalty_bps===state.creator_royalty_bps,'Native immutable binding mismatch')
  receiveId(binding.maker_creator);receiveId(state.creator)
  const listing=decodeNativeBcs(NativeMarketListingBcs,await reads.read(listingId,types.marketTypes!.listing,3))
  check(listing.id===listingId && listing.version==='8' && listing.soul_id===soulId && listing.state_id===stateId
    && listing.creator===state.creator && listing.creator_royalty_bps===state.creator_royalty_bps
    && listing.collection_id===null,'Native listing identity mismatch')
  if(listing.is_active) {
    check(state.is_listed && listing.seller===owner && listing.seller_kiosk_id===kioskId
      && listing.purchase_cap && listing.purchase_cap.item_id===soulId && listing.purchase_cap.kiosk_id===kioskId
      && listing.purchase_cap.min_price==='0','Active native listing/custody mismatch')
    receiveId(listing.purchase_cap.id)
  } else check(listing.purchase_cap===null,'Inactive listing still has purchase capability')
  const kiosk=decodeNativeBcs(NativeCancelKioskBcs,await reads.read(kioskId,'0x2::kiosk::Kiosk',3))
  check(kiosk.id===kioskId && kiosk.owner===owner,'Current Kiosk identity/owner mismatch')
  let kioskCapId=request.kioskCapId
  if(!kioskCapId) {
    const candidates=(await abortable(discoverCaps(owner),signal)).filter(row=>row.ownerAddress===owner && row.currentKioskId===kioskId)
    check(candidates.length===1,'Exactly one current owned PersonalKioskCap required')
    kioskCapId=receiveId(candidates[0].currentKioskCapOnChainId)
  }
  const cap=decodeNativeBcs(NativeCancelPersonalKioskCapBcs,await reads.read(kioskCapId,personalCapType,1,owner))
  check(cap.id===kioskCapId && cap.cap && cap.cap.for===kioskId,'PersonalKioskCap does not unlock current Kiosk')
  receiveId(cap.cap.id)
  await reads.verify();signal?.throwIfAborted()
  return {schema:'native-market-cancel-v1',soulId,stateId,bindingId,owner,kioskId,kioskCapId,
    ownershipEpoch:state.ownership_epoch,listingId,listed:state.is_listed,listingActive:listing.is_active,
    release:{network:'mainnet',protocolConfigId:pin.protocolConfigId,soulidityCallablePackageId:pin.soulidityCallablePackageId,
      soulidityCallableDigest:pin.soulidityCallableDigest,writesEnabled:pin.marketWritesEnabled===true}}
}
