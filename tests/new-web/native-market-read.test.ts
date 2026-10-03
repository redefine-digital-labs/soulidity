import { beforeEach, expect, it } from 'vitest'
import { nativeReceiveFixture } from './fixtures/native-receive'
import { NativeMarketConfigBcs,NativeMarketListingBcs,readNativeMarketSnapshot } from '../../web/lib/animacraft/native-market'
import { NativeSoulStateBcs,NativeSoulBindingBcs,NativeSoulBcs } from '../../web/lib/animacraft/native-receive'
import { EquipmentPointerBcs } from '../../web/lib/animacraft/native-equipment'
import { quoteAnimacraftV8SoulSale } from '../../packages/soulidity-sdk/src/native-market-quote'
import { deriveDynamicFieldID } from '@mysten/sui/utils'
const id=(n:number)=>`0x${n.toString(16).padStart(64,'0')}`
let f:ReturnType<typeof nativeReceiveFixture>
const edit=(objectId:string,schema:any,change:(v:any)=>void)=>{
  const obj=f.objects.get(objectId),value=schema.parse(obj.contents.value)
  change(value);obj.contents.value=schema.serialize(value).toBytes()
}
const read=()=>readNativeMarketSnapshot(f.client,f.target,{soulId:id(12),stateId:id(14),marketConfigId:id(30),listingId:id(31)})
beforeEach(()=>{
  f=nativeReceiveFixture()
  for(const datatypeName of ['MarketConfigV2','SoulListing'])f.objects.get(id(5)).package.typeOrigins.push({moduleName:'market',datatypeName,packageId:id(6)})
  const put=(objectId:string,type:string,schema:any,value:any)=>f.objects.set(objectId,{objectId,version:2n,digest:'digest',owner:{kind:3},objectType:type,contents:{value:schema.serialize(value).toBytes()}})
  put(id(30),`${id(6)}::market::MarketConfigV2`,NativeMarketConfigBcs,{id:id(30),version:'2',legacy_config_id:id(0),fee_recipient:id(40),
    platform_fee_bps:250,primary_enabled:false,secondary_enabled:true})
  put(id(31),`${id(6)}::market::SoulListing`,NativeMarketListingBcs,{id:id(31),version:'8',soul_id:id(12),state_id:id(14),seller:id(11),
    seller_kiosk_id:id(18),price:'10001',creator:id(11),creator_royalty_bps:750,collection_id:null,
    purchase_cap:{id:id(32),kiosk_id:id(18),item_id:id(12),min_price:'0'},is_active:true})
  edit(id(14),NativeSoulStateBcs,v=>{v.creator_royalty_bps=750;v.is_listed=true})
  edit(id(13),NativeSoulBindingBcs,v=>{v.maker_creator=id(41);v.rights.soul_creator_royalty_bps=750;v.rights.maker_source_royalty_bps=250})
  f.client.ledgerService.batchGetObjects=async()=>({response:{objects:[{result:{oneofKind:'error',error:{code:5}}}]}}) as never
})
it('reads native listing, original recipients and one gross exact quote without artwork/Root access',async()=>{
  expect(await read()).toMatchObject({purchaseAvailable:true,creator:id(11),makerCreator:id(41),listing:{id:id(31),quote:{
    priceAtomic:'10001',totalAtomic:'10001',sellerPayoutAtomic:'8751',platformFeeAtomic:'250',creatorRoyaltyAtomic:'750',makerRoyaltyAtomic:'250'}}})
  expect(f.calls.some(call=>[id(10),id(15),id(16)].includes(call.objectId))).toBe(false)
})
it.each(['pause','policy'])('keeps cancel/read metadata available while purchase is disabled: %s',async reason=>{
  edit(id(30),NativeMarketConfigBcs,v=>{if(reason==='pause')v.secondary_enabled=false;else v.platform_fee_bps=300})
  expect(await read()).toMatchObject({purchaseAvailable:false,listing:{id:id(31)}})
})
it('ignores a stale listing hint after the live Soul is no longer listed',async()=>{
  edit(id(14),NativeSoulStateBcs,v=>{v.is_listed=false});f.objects.delete(id(31))
  expect(await read()).toMatchObject({listing:null,purchaseAvailable:false})
})
it.each(['id','version','soul_id','state_id','seller','seller_kiosk_id','creator','creator_royalty_bps','collection_id','purchase_cap','is_active'])('rejects a substituted listing %s',async key=>{
  edit(id(31),NativeMarketListingBcs,v=>{v[key]=key==='version'?'5':key==='creator_royalty_bps'?500:key==='is_active'?false:key==='purchase_cap'?null:id(99)})
  await expect(read()).rejects.toMatchObject({code:'NATIVE_MARKET_INVALID'})
})
it.each(['item_id','kiosk_id','min_price'])('rejects purchase cap %s substitution',async key=>{
  edit(id(31),NativeMarketListingBcs,v=>{v.purchase_cap[key]=key==='min_price'?'1':id(99)})
  await expect(read()).rejects.toMatchObject({code:'NATIVE_MARKET_INVALID'})
})
it.each(['soul_id','soul_state_id','protocol_config_id','original_holder','rates'])('rejects binding %s substitution',async key=>{
  edit(id(13),NativeSoulBindingBcs,v=>{if(key==='rates')v.rights.soul_creator_royalty_bps=500;else v[key]=id(99)})
  await expect(read()).rejects.toMatchObject({code:'NATIVE_MARKET_INVALID'})
})
it.each(['field','creator','custody','config','origin'])('rejects mismatched native evidence: %s',async what=>{
  if(what==='field')edit(f.dfId,EquipmentPointerBcs,v=>{v.value=id(99)})
  if(what==='creator')edit(id(12),NativeSoulBcs,v=>{v.creator=id(99)})
  if(what==='custody')f.objects.get(id(12)).owner.address=id(99)
  if(what==='config')edit(id(30),NativeMarketConfigBcs,v=>{v.legacy_config_id=id(99)})
  if(what==='origin')f.objects.get(id(5)).package.typeOrigins.find((v:any)=>v.datatypeName==='SoulListing').packageId=id(99)
  await expect(read()).rejects.toBeInstanceOf(Error)
})
it('rejects changed evidence before returning a quote',async()=>{
  const original=f.client.ledgerService.getObject.bind(f.client.ledgerService)
  f.client.ledgerService.getObject=async request=>{
    const result=await original(request)
    if(request.objectId===id(31))f.objects.get(id(14)).version=3n
    return result
  }
  await expect(read()).rejects.toMatchObject({status:409})
})
it('rejects a listed Soul with any DF10 equipment pointer instead of implicitly selling components',async()=>{
  const pointerId=deriveDynamicFieldID(id(14),'u8',new Uint8Array([10]))
  const pointer={
    objectId:pointerId,version:2n,digest:'pointer',owner:{kind:2,address:id(14)},objectType:'0x2::dynamic_field::Field<u8,0x2::object::ID>',
    contents:{value:EquipmentPointerBcs.serialize({id:pointerId,name:10,value:id(99)}).toBytes()},
  }
  f.objects.set(pointerId,pointer)
  f.client.ledgerService.batchGetObjects=async()=>({response:{objects:[{result:{oneofKind:'object',object:pointer}}]}}) as never
  await expect(read()).rejects.toMatchObject({code:'NATIVE_MARKET_INVALID'})
})
it('does not interpret a failed pointer lookup as no equipment',async()=>{
  f.client.ledgerService.batchGetObjects=async()=>({response:{objects:[{result:{oneofKind:'error',error:{code:14}}}]}}) as never
  await expect(read()).rejects.toMatchObject({status:503})
})
it('returns no snapshot when cancelled during dependent reads',async()=>{
  const controller=new AbortController(),original=f.client.ledgerService.getObject.bind(f.client.ledgerService)
  f.client.ledgerService.getObject=async request=>{
    const result=await original(request)
    if(request.objectId===id(31))controller.abort()
    return result
  }
  await expect(readNativeMarketSnapshot(f.client,f.target,{soulId:id(12),stateId:id(14),marketConfigId:id(30),listingId:id(31)},controller.signal)).rejects.toMatchObject({name:'AbortError'})
})
it('rejects missing listing metadata rather than falling back to a database price',async()=>{
  await expect(readNativeMarketSnapshot(f.client,f.target,{soulId:id(12),stateId:id(14),marketConfigId:id(30)})).rejects.toMatchObject({status:409})
})
it.each([[0n,0,0],[-1n,0,0],[1n<<64n,0,0],[1n,1001,0],[1n,25,0],[1n,750,500],[1n,NaN,0]])('rejects invalid native quote %s/%s/%s',(price,creator,source)=>{
  expect(()=>quoteAnimacraftV8SoulSale(price as bigint,{soulCreatorRoyaltyBps:Number(creator),makerSourceRoyaltyBps:Number(source)})).toThrow()
})
it('floors independently at one atomic unit and supports the exact u64 maximum',()=>{
  expect(quoteAnimacraftV8SoulSale(1n,{soulCreatorRoyaltyBps:1000,makerSourceRoyaltyBps:0})).toMatchObject({sellerPayoutAtomic:1n,protocolFeeAtomic:0n})
  expect(quoteAnimacraftV8SoulSale((1n<<64n)-1n,{soulCreatorRoyaltyBps:0,makerSourceRoyaltyBps:1000}).totalAtomic).toBe((1n<<64n)-1n)
})
