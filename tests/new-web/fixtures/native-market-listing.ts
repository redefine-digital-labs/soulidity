import { deriveDynamicFieldID } from '@mysten/sui/utils'
import { nativeReceiveFixture } from './native-receive'
import { NativeMarketListingBcs } from '../../../web/lib/animacraft/native-market'
import { NativeSoulStateBcs, NativeSoulBindingBcs } from '../../../web/lib/animacraft/native-receive'
import { EquipmentPointerBcs } from '../../../web/lib/animacraft/native-equipment'
import { verifyNativeMarketListing } from '../../../web/lib/animacraft/native-market-listing'
export const lid=(n:number)=>`0x${n.toString(16).padStart(64,'0')}`
export function nativeMarketListingFixture(){
  const f=nativeReceiveFixture()
  const edit=(objectId:string,schema:any,change:(value:any)=>void)=>{
    const object=f.objects.get(objectId),value=schema.parse(object.contents.value)
    change(value);object.contents.value=schema.serialize(value).toBytes()
  }
  for(const datatypeName of ['MarketConfigV2','SoulListing'])f.objects.get(lid(5)).package.typeOrigins.push({moduleName:'market',datatypeName,packageId:lid(6)})
  f.objects.set(lid(30),{objectId:lid(30),version:2n,digest:'listing-digest',owner:{kind:3},objectType:`${lid(6)}::market::SoulListing`,
    contents:{value:NativeMarketListingBcs.serialize({id:lid(30),version:'8',soul_id:lid(12),state_id:lid(14),seller:lid(11),seller_kiosk_id:lid(18),
      price:'10001',creator:lid(11),creator_royalty_bps:750,collection_id:null,purchase_cap:{id:lid(32),kiosk_id:lid(18),item_id:lid(12),min_price:'0'},is_active:true}).toBytes()}})
  edit(lid(14),NativeSoulStateBcs,value=>{value.creator_royalty_bps=750;value.is_listed=true;value.ownership_epoch='7'})
  edit(lid(13),NativeSoulBindingBcs,value=>{value.rights.soul_creator_royalty_bps=750;value.rights.maker_source_royalty_bps=250})
  const pointerId=deriveDynamicFieldID(lid(14),'u8',new Uint8Array([10]))
  f.client.ledgerService.batchGetObjects=async(request:any)=>({response:{objects:request.requests.map((row:any)=>{
    const object=f.objects.get(row.objectId)
    return {result:object?{oneofKind:'object',object}:{oneofKind:'error',error:{code:5}}}
  })}}) as never
  const event={type:`${lid(6)}::market::SoulListed`,parsedJson:{listing_id:lid(30),soul_id:lid(12),seller:lid(11),kiosk_id:lid(18),price:'10001'}}
  const transaction={digest:f.input.txDigest,events:[event] as Array<{type:string;parsedJson:any}>}
  const input={soulId:lid(12),stateId:lid(14),sender:lid(11),txDigest:f.input.txDigest,transaction}
  const addEquipment=()=>f.objects.set(pointerId,{objectId:pointerId,version:2n,digest:'equipment-pointer',owner:{kind:2,address:lid(14)},
    objectType:'0x2::dynamic_field::Field<u8,0x2::object::ID>',contents:{value:EquipmentPointerBcs.serialize({id:pointerId,name:10,value:lid(90)}).toBytes()}})
  return {...f,edit,event,transaction,listingInput:input,pointerId,addEquipment,read:(signal?:AbortSignal)=>verifyNativeMarketListing(f.client,f.target,input,signal)}
}
