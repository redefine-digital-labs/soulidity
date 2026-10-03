import {deriveDynamicFieldID} from '@mysten/sui/utils'
import {bcs} from '@mysten/sui/bcs'
import {nativeMarketBuyFixture,bid as id,capOrigin} from './native-market-buy'
import {NativeSoulStateBcs} from '../../../web/lib/animacraft/native-receive'
import {NativeCancelPersonalKioskCapBcs} from '../../../web/lib/animacraft/native-market-cancel-snapshot'
import {NativeBuyOwnerKeyBcs,NativeBuyRegistrationBcs} from '../../../web/lib/animacraft/native-market-buy-snapshot'
import {readNativeMarketListSnapshot} from '../../../web/lib/animacraft/native-market-list-snapshot'
export function nativeMarketListFixture(listed=false) {
  const f=nativeMarketBuyFixture(),owner=id(11)
  f.edit(id(14),NativeSoulStateBcs,v=>{v.is_listed=listed})
  const addOwnerCap=(capId=id(70),kioskId=id(18))=>{
    f.put(capId,`${capOrigin}::personal_kiosk::PersonalKioskCap`,NativeCancelPersonalKioskCapBcs,
      {id:capId,cap:{id:id(71),for:kioskId}},{kind:1,address:owner})
    return f.objects.get(capId)
  }
  f.pages[0].push(addOwnerCap())
  const keyType=`${id(6)}::market::PersonalKioskOwnerKey`
  const registrationId=deriveDynamicFieldID(id(31),keyType,NativeBuyOwnerKeyBcs.serialize({owner}).toBytes())
  const register=(capId=id(70),kioskId=id(18))=>{
    f.put(registrationId,`0x2::dynamic_field::Field<${keyType},${id(6)}::market::PersonalKioskRegistration>`,NativeBuyRegistrationBcs,
      {id:registrationId,name:{owner},value:{version:'1',kiosk_id:kioskId,kiosk_cap_id:capId}},{kind:2,address:id(31)})
  }
  const pointerId=deriveDynamicFieldID(id(14),'u8',new Uint8Array([10]))
  const equip=()=>f.put(pointerId,'0x2::dynamic_field::Field<u8,0x2::object::ID>',
    bcs.struct('Field',{id:bcs.Address,name:bcs.u8(),value:bcs.Address}),{id:pointerId,name:10,value:id(75)},{kind:2,address:id(14)})
  const request={soulId:id(12),stateId:id(14),listingId:id(33),kioskCapId:undefined as string|undefined}
  const read=(signal?:AbortSignal)=>readNativeMarketListSnapshot(f.client,f.target,f.config,request,signal)
  return {...f,owner,registrationId,register,addOwnerCap,pointerId,equip,request,read}
}
