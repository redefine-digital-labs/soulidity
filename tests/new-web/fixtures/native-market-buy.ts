import {deriveDynamicFieldID} from '@mysten/sui/utils'
import {nativeReceiveFixture} from './native-receive'
import {NativeMarketConfigBcs,NativeMarketListingBcs} from '../../../web/lib/animacraft/native-market'
import {NativeSoulStateBcs,NativeSoulBindingBcs} from '../../../web/lib/animacraft/native-receive'
import {NativeCancelKioskBcs,NativeCancelPersonalKioskCapBcs} from '../../../web/lib/animacraft/native-market-cancel-snapshot'
import {NativeBuyRegistryBcs,NativeBuyPolicyBcs,NativeBuyOwnerKeyBcs,NativeBuyRegistrationBcs,
  readNativeMarketBuySnapshot} from '../../../web/lib/animacraft/native-market-buy-snapshot'
export const bid=(n:number)=>`0x${n.toString(16).padStart(64,'0')}`
export const kioskFamily='0x434b5bd8f6a7b05fede0ff46c6e511d71ea326ed38056e3bcd681d2d7c2a7879'
export const capOrigin='0x0cb4bcc0560340eb1a1b929cabe56b33fc6449820ec8c1980d69bb98b649b802'
export const usdcFamily='0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7'
export function nativeMarketBuyFixture() {
  const f=nativeReceiveFixture(),id=bid,buyer=id(50)
  const config={marketConfigV2Id:id(30),kioskRegistryId:id(31),soulTransferPolicyId:id(32),
    kioskPackageId:id(40),paymentCoinType:`${usdcFamily}::usdc::USDC`}
  const edit=(objectId:string,schema:any,change:(value:any)=>void)=>{
    const object=f.objects.get(objectId),value=schema.parse(object.contents.value)
    change(value);object.contents.value=schema.serialize(value).toBytes()
  }
  const put=(objectId:string,type:string,schema:any,value:any,owner:any={kind:3})=>f.objects.set(objectId,{
    objectId,version:2n,digest:'object-digest',objectType:type,owner,contents:{value:schema.serialize(value).toBytes()}})
  for(const datatypeName of ['MarketConfigV2','SoulListing','KioskRegistry','PersonalKioskOwnerKey','PersonalKioskRegistration','SoulMarketProof'])
    f.objects.get(id(5)).package.typeOrigins.push({moduleName:'market',datatypeName,packageId:id(6)})
  const pkg=(objectId:string,originalId:string,rows:string[][])=>{
    f.objects.set(objectId,{objectId,version:2n,digest:'dependency-digest',owner:{kind:4},package:{
      storageId:objectId,originalId,version:2n,linkage:[],typeOrigins:rows.map(([moduleName,datatypeName,packageId])=>({moduleName,datatypeName,packageId})),
      modules:[...new Set(rows.map(row=>row[0]))].map(name=>({name,contents:new Uint8Array([1,2,3,4,5])}))}})
    f.objects.get(id(5)).package.linkage.push({originalId,upgradedId:objectId,upgradedVersion:2n})
  }
  pkg(id(40),kioskFamily,[['personal_kiosk','PersonalKioskCap',capOrigin],['kiosk_lock_rule','Rule',id(41)],
    ['personal_kiosk_rule','Rule',id(42)],['witness_rule','Rule',id(43)]])
  pkg(id(44),usdcFamily,[['usdc','USDC',usdcFamily]])
  put(id(30),`${id(6)}::market::MarketConfigV2`,NativeMarketConfigBcs,{id:id(30),version:'2',legacy_config_id:id(0),
    fee_recipient:id(60),platform_fee_bps:250,primary_enabled:false,secondary_enabled:true})
  put(id(33),`${id(6)}::market::SoulListing`,NativeMarketListingBcs,{id:id(33),version:'8',soul_id:id(12),state_id:id(14),
    seller:id(11),seller_kiosk_id:id(18),price:'10001',creator:id(11),creator_royalty_bps:750,collection_id:null,
    purchase_cap:{id:id(34),kiosk_id:id(18),item_id:id(12),min_price:'0'},is_active:true})
  put(id(31),`${id(6)}::market::KioskRegistry`,NativeBuyRegistryBcs,{id:id(31),version:'1'})
  const rules=[`${id(41)}::kiosk_lock_rule::Rule`,`${id(42)}::personal_kiosk_rule::Rule`,`${id(43)}::witness_rule::Rule<${id(6)}::market::SoulMarketProof>`]
  put(id(32),`0x2::transfer_policy::TransferPolicy<${id(6)}::soul::Soul>`,NativeBuyPolicyBcs,{id:id(32),balance:'0',
    rules:{contents:rules.map(name=>({name:name.slice(2)}))}})
  edit(id(14),NativeSoulStateBcs,v=>{v.is_listed=true;v.creator_royalty_bps=750;v.ownership_epoch='7'})
  edit(id(13),NativeSoulBindingBcs,v=>{v.maker_creator=id(61);v.rights.soul_creator_royalty_bps=750;v.rights.maker_source_royalty_bps=250})
  put(id(18),'0x2::kiosk::Kiosk',NativeCancelKioskBcs,{id:id(18),profits:'0',owner:id(11),item_count:1,allow_extensions:false})
  const addCap=(capId=id(52),kioskId=id(51))=>{
    put(kioskId,'0x2::kiosk::Kiosk',NativeCancelKioskBcs,{id:kioskId,profits:'0',owner:buyer,item_count:0,allow_extensions:false})
    put(capId,`${capOrigin}::personal_kiosk::PersonalKioskCap`,NativeCancelPersonalKioskCapBcs,
      {id:capId,cap:{id:id(53),for:kioskId}},{kind:1,address:buyer})
    return f.objects.get(capId)
  }
  const keyType=`${id(6)}::market::PersonalKioskOwnerKey`
  const registrationId=deriveDynamicFieldID(id(31),keyType,NativeBuyOwnerKeyBcs.serialize({owner:buyer}).toBytes())
  const register=(capId=id(52),kioskId=id(51))=>{
    addCap(capId,kioskId)
    put(registrationId,`0x2::dynamic_field::Field<${keyType},${id(6)}::market::PersonalKioskRegistration>`,NativeBuyRegistrationBcs,
      {id:registrationId,name:{owner:buyer},value:{version:'1',kiosk_id:kioskId,kiosk_cap_id:capId}},{kind:2,address:id(31)})
  }
  f.client.ledgerService.batchGetObjects=async request=>({response:{objects:request.requests.map(row=>{
    const object=f.objects.get(row.objectId!)
    return {result:object?{oneofKind:'object',object}:{oneofKind:'error',error:{code:5}}}
  })}}) as never
  const pages:any[][]=[[]],scanCalls:any[]=[]
  f.client.stateService={listOwnedObjects:async(request:any)=>{
    scanCalls.push(request);const page=request.pageToken?.[0]??0
    return {response:{objects:pages[page],...(page+1<pages.length?{nextPageToken:new Uint8Array([page+1])}:{})}}
  }} as never
  const read=()=>readNativeMarketBuySnapshot(f.client,f.target,config,{soulId:id(12),stateId:id(14),listingId:id(33),buyer})
  return {...f,config,buyer,edit,put,rules,addCap,register,registrationId,pages,scanCalls,read}
}
