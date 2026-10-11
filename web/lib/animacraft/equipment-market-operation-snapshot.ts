import type {SuiGrpcClient} from '@mysten/sui/grpc'
import {toHex} from '@mysten/sui/utils'
import {EquipmentReadSet,EquipmentBaseItemBcs,EquipmentExternalItemBcs,readNativeEquipment} from './native-equipment'
import {readOwnedEquipmentMarketSnapshot,readEquipmentMarketListingSnapshot,equipmentMarketAssetCommitment} from './native-equipment-market-read'
import {prepareSelectedSaleEquipment,type SelectedSaleEquipmentPreparation} from './native-selected-equipment-sale'
import {readNativeReceiveTarget,type NativeReceiveTarget} from './native-receive'
import {marketListCheck as check,marketListId as id} from './market-list-operation'
import {validateEquipmentMarketSnapshot} from './equipment-market-operation'
import type {EquipmentMarketOperationSnapshot} from './equipment-market-operation-types'

type Owned=Awaited<ReturnType<typeof readOwnedEquipmentMarketSnapshot>>
type Listed=Awaited<ReturnType<typeof readEquipmentMarketListingSnapshot>>
const hex=(value:number[])=>toHex(new Uint8Array(value))
function asset(value:Owned['asset']){
  const {item,base,kind}=value
  if(kind==='base'){
    check(base,'Authenticated Base registries required')
    return {kind,itemId:item.id,packRegistryId:base.packRegistryId,definitionRegistryId:base.definitionRegistryId,baseRegistryId:base.baseRegistryId}
  }
  check('product_id'in item,'Authenticated External product required')
  return {kind,itemId:item.id,productId:item.product_id}
}

/** The mapper does not confer chain authority. Only call with the exact raw
 * authenticated read; the adapter repeats that read before wallet/sign/broadcast. */
export function equipmentOwnedOperationSnapshot(raw:Owned,release:NativeReceiveTarget,
  removal:SelectedSaleEquipmentPreparation|null=null):EquipmentMarketOperationSnapshot{
  const item=raw.asset.item,lock=item.equip_lock
  // Runtime clears only the lock during removal. Custody hashes the resulting
  // whole instance, so do not freeze its previous equipped-object hash instead.
  const cleared=raw.asset.kind==='base'
    ?EquipmentBaseItemBcs.serialize({...item,equip_lock:null} as ReturnType<typeof EquipmentBaseItemBcs.parse>).toBytes()
    :EquipmentExternalItemBcs.serialize({...item,equip_lock:null} as ReturnType<typeof EquipmentExternalItemBcs.parse>).toBytes()
  return validateEquipmentMarketSnapshot({schema:'equipment-market-operation-v1',actor:raw.owner,seller:raw.owner,
    ownershipEpoch:item.ownership_epoch,asset:asset(raw.asset),reference:raw.asset.receiving,
    assetCommitment:hex(equipmentMarketAssetCommitment(cleared)),quoteContext:raw.quoteContext,
    target:raw.target,release,protocolTreasuryId:raw.protocolTreasuryId,listing:null,
    lock:lock?{equipmentId:lock.loadout_id,revision:lock.equip_revision,selectionIndex:lock.selection_index}:null,removal,
    available:{list:raw.current&&item.transferable&&(!lock||removal!==null),buy:false,reprice:false,cancel:false,recover:false}})
}
export function equipmentListingOperationSnapshot(raw:Listed,release:NativeReceiveTarget,actor:string):EquipmentMarketOperationSnapshot{
  check(id(actor)&&raw.listing.status===0&&raw.asset,'An open authenticated equipment listing is required')
  return validateEquipmentMarketSnapshot({schema:'equipment-market-operation-v1',actor,seller:raw.listing.custody.holder,
    ownershipEpoch:raw.listing.custody.ownership_epoch,asset:asset(raw.asset),reference:raw.asset.receiving,
    assetCommitment:hex(raw.listing.custody.asset_commitment),quoteContext:raw.quoteContext,
    target:raw.target,release,protocolTreasuryId:raw.protocolTreasuryId,
    listing:{id:raw.listing.id,revision:raw.listing.revision,priceAtomic:raw.quote.grossAtomic,quoteCommitment:raw.quote.commitment},
    lock:null,removal:null,available:{list:false,buy:raw.buyAvailable,
      reprice:raw.current&&actor===raw.listing.custody.holder,cancel:raw.cancelAvailable,recover:raw.recoverAvailable}})
}

export interface EquipmentMarketReadRequest {
  actor:string;rootId:string;itemId:string;kind:'base'|'external'
  listingId?:string
  equipmentScope?:{soulId:string;stateId:string}
}
/** Market custody and optional partial removal share one final mutable readset.
 * A lock never authorizes discovering/selling another asset on the user's behalf. */
export async function readEquipmentMarketOperationSnapshot(client:SuiGrpcClient,release:NativeReceiveTarget,
  input:EquipmentMarketReadRequest,signal?:AbortSignal,readSet?:EquipmentReadSet){
  const request=structuredClone(input),pin=structuredClone(release)
  check(Object.keys(request).every(k=>['actor','rootId','itemId','kind','listingId','equipmentScope'].includes(k))
    &&[request.actor,request.rootId,request.itemId].every(id)
    &&['base','external'].includes(request.kind),'Invalid equipment operation read scope')
  const target=readNativeReceiveTarget({NEXT_PUBLIC_SUI_NETWORK:'mainnet',
    NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID:pin.soulidityCallablePackageId,
    NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID:pin.soulidityOriginalPackageId,
    NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON:JSON.stringify(pin)})
  check(target.equipmentMarket&&target.runtime,'Equipment Market release required')
  if(request.equipmentScope)check(Object.keys(request.equipmentScope).sort().join(',')==='soulId,stateId'
    &&id(request.equipmentScope.soulId)&&id(request.equipmentScope.stateId),'Invalid selected Soul scope')
  signal?.throwIfAborted()
  const reads=readSet??new EquipmentReadSet(client,true)
  let result:EquipmentMarketOperationSnapshot
  if(request.listingId!==undefined){
    check(id(request.listingId)&&request.equipmentScope===undefined,'Invalid listing read scope')
    const raw=await readEquipmentMarketListingSnapshot(client,target,target.equipmentMarket,
      {rootId:request.rootId,listingId:request.listingId,actor:request.actor},signal,reads)
    result=equipmentListingOperationSnapshot(raw,target,request.actor)
  }else{
    const raw=await readOwnedEquipmentMarketSnapshot(client,target,target.equipmentMarket,
      {rootId:request.rootId,itemId:request.itemId,kind:request.kind,owner:request.actor},signal,reads)
    let removal:SelectedSaleEquipmentPreparation|null=null
    if(request.equipmentScope){
      check(raw.requiresUnequip,'Selected equipment lock changed; refresh before listing')
      const e=await readNativeEquipment(client,target,{...request.equipmentScope,update:true},reads)
      removal=prepareSelectedSaleEquipment(request.actor,[{...request.equipmentScope,sellSoul:false,
        items:[{kind:request.kind,itemId:request.itemId}]}],[e])[0]
    }
    result=equipmentOwnedOperationSnapshot(raw,target,removal)
  }
  check(result.asset.itemId===request.itemId&&result.asset.kind===request.kind,'Selected equipment changed')
  signal?.throwIfAborted();await reads.verify();signal?.throwIfAborted()
  return result
}
