import { expect,it } from 'vitest'
import { NativeMarketListingBcs } from '../../web/lib/animacraft/native-market'
import { NativeSoulStateBcs,NativeSoulBindingBcs,NativeSoulBcs } from '../../web/lib/animacraft/native-receive'
import { EquipmentPointerBcs } from '../../web/lib/animacraft/native-equipment'
import { verifyNativeMarketListing } from '../../web/lib/animacraft/native-market-listing'
import { nativeMarketListingFixture,lid } from './fixtures/native-market-listing'

it('verifies exact native listing receipt/BCS and returns only a listed-state mirror guard',async()=>{
  const f=nativeMarketListingFixture();const result=await f.read()
  expect(result).toEqual({ownerAddress:lid(11),kioskId:lid(18),ownershipEpoch:'7',listingId:lid(30),priceAtomic:10001n,verifyReadSet:expect.any(Function)})
  expect(new Set(f.calls.map(call=>call.objectId))).toEqual(new Set([lid(5),lid(4),lid(14),lid(12),f.itemFieldId,f.dfId,lid(13),lid(30)]))
  await result.verifyReadSet()
})
it('supports other Souls and a reprice cancel event while selecting the target Soul unique new listing',async()=>{
  const f=nativeMarketListingFixture()
  f.transaction.events.unshift({type:f.event.type,parsedJson:{...f.event.parsedJson,soul_id:lid(99),listing_id:lid(98)}})
  f.transaction.events.unshift({type:`${lid(6)}::market::SoulListingCancelled`,parsedJson:{listing_id:lid(80),soul_id:lid(12),seller:lid(11)}})
  expect(await f.read()).toMatchObject({listingId:lid(30),priceAtomic:10001n})
  expect(f.calls.some(call=>[lid(80),lid(98)].includes(call.objectId))).toBe(false)
})
it.each(['duplicate','other-target','missing','alias','callable','wrong-type','extra-field','seller','kiosk','listing','digest'])
  ('rejects receipt %s without successful listed proof',async problem=>{
    const f=nativeMarketListingFixture()
    if(problem==='duplicate')f.transaction.events.push(structuredClone(f.event))
    if(problem==='other-target')f.event.parsedJson.soul_id=lid(99)
    if(problem==='missing')f.transaction.events=[]
    if(problem==='alias')f.event.type=`${lid(99)}::market::SoulListed`
    if(problem==='callable')f.event.type=`${lid(5)}::market::SoulListed`
    if(problem==='wrong-type')f.event.type=`${lid(6)}::market::AnimacraftV6SoulListed`
    if(problem==='extra-field')(f.event.parsedJson as any).extra='untrusted'
    if(problem==='seller')f.event.parsedJson.seller=lid(99)
    if(problem==='kiosk')f.event.parsedJson.kiosk_id='0x18'
    if(problem==='listing')f.event.parsedJson.listing_id='0x30'
    if(problem==='digest')f.transaction.digest='other'
    await expect(f.read()).rejects.toMatchObject({status:422})
  })
it.each(['0','-1','01','1.5','1e3','0x10','18446744073709551616','9'.repeat(100),true,null,undefined,1.1,Number.MAX_SAFE_INTEGER+1])
  ('rejects non-exact or non-positive receipt price %s',async value=>{
    const f=nativeMarketListingFixture();(f.event.parsedJson as any).price=value
    await expect(f.read()).rejects.toMatchObject({code:'NATIVE_LISTING_INVALID',status:422})
  })
it.each(['1','18446744073709551615',10001,10001n])('accepts exact bounded receipt price %s',async value=>{
  const f=nativeMarketListingFixture();(f.event.parsedJson as any).price=value
  f.edit(lid(30),NativeMarketListingBcs,v=>{v.price=String(value)})
  expect((await f.read()).priceAtomic).toBe(BigInt(value))
})
it.each(['owner','kiosk','unlisted','sold','cancelled','reprice','cap-removed','equipment'])
  ('returns typed superseded state for actual later %s',async change=>{
    const f=nativeMarketListingFixture()
    if(change==='owner')f.edit(lid(14),NativeSoulStateBcs,v=>{v.current_owner=lid(99)})
    if(change==='kiosk')f.edit(lid(14),NativeSoulStateBcs,v=>{v.current_kiosk_id=lid(99)})
    if(change==='unlisted')f.edit(lid(14),NativeSoulStateBcs,v=>{v.is_listed=false})
    if(change==='sold'||change==='cancelled')f.edit(lid(30),NativeMarketListingBcs,v=>{v.is_active=false;v.purchase_cap=null})
    if(change==='reprice')f.edit(lid(30),NativeMarketListingBcs,v=>{v.price='10002'})
    if(change==='cap-removed')f.edit(lid(30),NativeMarketListingBcs,v=>{v.purchase_cap=null})
    if(change==='equipment')f.addEquipment()
    await expect(f.read()).rejects.toMatchObject({code:'NATIVE_LISTING_STATE_CHANGED',status:409})
  })
it.each(['id','version','soul_id','state_id','seller','seller_kiosk_id','creator','creator_royalty_bps','collection_id'])
  ('rejects structurally substituted V8 listing %s, not a superseded receipt',async key=>{
    const f=nativeMarketListingFixture();f.edit(lid(30),NativeMarketListingBcs,v=>{v[key]=key==='version'?'5':key==='creator_royalty_bps'?500:lid(99)})
    await expect(f.read()).rejects.toMatchObject({code:'NATIVE_LISTING_INVALID',status:422})
  })
it.each(['id','item_id','kiosk_id','min_price'])('requires exact native PurchaseCap %s',async key=>{
  const f=nativeMarketListingFixture();f.edit(lid(30),NativeMarketListingBcs,v=>{v.purchase_cap[key]=key==='id'?lid(0):key==='min_price'?'1':lid(99)})
  await expect(f.read()).rejects.toMatchObject({status:422})
})
it.each(['id','version','soul_id','soul_state_id','protocol_config_id','original_holder','creator-rate','source-rate'])
  ('rejects immutable binding %s substitution',async key=>{
    const f=nativeMarketListingFixture();f.edit(lid(13),NativeSoulBindingBcs,v=>{
      if(key==='creator-rate')v.rights.soul_creator_royalty_bps=500
      else if(key==='source-rate')v.rights.maker_source_royalty_bps=1000
      else v[key]=key==='version'?'7':lid(99)
    })
    await expect(f.read()).rejects.toMatchObject({code:'NATIVE_LISTING_INVALID',status:422})
  })
it.each(['field-id','field-key','field-value','field-owner','binding-type','binding-owner','soul-custody','soul-kind','soul-creator','state-id','state-soul','state-collection','listing-type','listing-owner','origin'])
  ('requires exact native type, key and custody: %s',async what=>{
    const f=nativeMarketListingFixture()
    if(what.startsWith('field-')&&what!=='field-owner')f.edit(f.dfId,EquipmentPointerBcs,v=>{if(what==='field-id')v.id=lid(99);else if(what==='field-key')v.name=8;else v.value=lid(0)})
    if(what==='field-owner')f.objects.get(f.dfId).owner.address=lid(99)
    if(what==='binding-type')f.objects.get(lid(13)).objectType=`${lid(6)}::animacraft_provenance::AnimacraftProvenance`
    if(what==='binding-owner')f.objects.get(lid(13)).owner.kind=3
    if(what==='soul-custody')f.objects.get(lid(12)).owner.address=lid(99)
    if(what==='soul-kind')f.edit(lid(12),NativeSoulBcs,v=>{v.provenance_kind=0})
    if(what==='soul-creator')f.edit(lid(12),NativeSoulBcs,v=>{v.creator=lid(99)})
    if(what==='state-id')f.edit(lid(14),NativeSoulStateBcs,v=>{v.id=lid(99)})
    if(what==='state-soul')f.edit(lid(14),NativeSoulStateBcs,v=>{v.soul_id=lid(99)})
    if(what==='state-collection')f.edit(lid(14),NativeSoulStateBcs,v=>{v.collection_id=lid(99)})
    if(what==='listing-type')f.objects.get(lid(30)).objectType=`${lid(99)}::market::SoulListing`
    if(what==='listing-owner')f.objects.get(lid(30)).owner.kind=1
    if(what==='origin')f.objects.get(lid(5)).package.typeOrigins.find((r:any)=>r.datatypeName==='SoulListing').packageId=lid(99)
    await expect(f.read()).rejects.toMatchObject({status:422})
  })
it('rejects noncanonical/truncated BCS instead of accepting field-shaped JSON',async()=>{
  const f=nativeMarketListingFixture();const object=f.objects.get(lid(30));object.contents.value=new Uint8Array([...object.contents.value,0])
  await expect(f.read()).rejects.toBeInstanceOf(Error)
})
it.each([lid(14),lid(12),lid(30)])('preserves retryable read drift at initial and pre-mirror verification of %s',async objectId=>{
  const f=nativeMarketListingFixture();const result=await f.read();f.objects.get(objectId).version=3n
  await expect(result.verifyReadSet()).rejects.toMatchObject({code:'NATIVE_EQUIPMENT_CHANGED',status:409})
  const g=nativeMarketListingFixture();const get=g.client.ledgerService.getObject.bind(g.client.ledgerService)
  g.client.ledgerService.getObject=async request=>{const response=await get(request);if(request.objectId===lid(30))g.objects.get(lid(14)).version=3n;return response}
  await expect(g.read()).rejects.toMatchObject({code:'NATIVE_EQUIPMENT_CHANGED',status:409})
})
it('rechecks DF10 absence on the returned mirror guard, even if a fixture omits parent version advancement',async()=>{
  const f=nativeMarketListingFixture();const result=await f.read();f.addEquipment()
  await expect(result.verifyReadSet()).rejects.toMatchObject({code:'NATIVE_EQUIPMENT_CHANGED',status:409})
})
it.each(['missing-object','missing-contents','rpc','pointer-rpc','pointer-missing'])('keeps unavailable %s retryable, never superseded',async problem=>{
  const f=nativeMarketListingFixture()
  if(problem==='missing-object')f.objects.delete(lid(30))
  if(problem==='missing-contents')f.objects.get(lid(30)).contents=undefined
  if(problem==='rpc'){const get=f.client.ledgerService.getObject.bind(f.client.ledgerService);f.client.ledgerService.getObject=async request=>{if(request.objectId===lid(30))throw new Error('RPC timeout');return get(request)}}
  if(problem==='pointer-rpc')f.client.ledgerService.batchGetObjects=async()=>({response:{objects:[{result:{oneofKind:'error',error:{code:14}}}]}}) as never
  if(problem==='pointer-missing')f.client.ledgerService.batchGetObjects=async()=>({response:{objects:[]}}) as never
  const error=await f.read().catch(error=>error)
  expect(error).toBeInstanceOf(Error);expect(error.code).not.toBe('NATIVE_LISTING_STATE_CHANGED')
  if(problem==='missing-object'||problem==='missing-contents')expect(error).toMatchObject({code:'NATIVE_LISTING_UNAVAILABLE',status:503})
})
it('captures caller input/target and exposes an abort-aware final guard without any additional gate/config read',async()=>{
  const f=nativeMarketListingFixture();const controller=new AbortController()
  const promise=f.read(controller.signal);f.listingInput.soulId=lid(99);f.event.parsedJson.price='1';f.target.protocolConfigId=lid(99)
  const result=await promise;expect(result.priceAtomic).toBe(10001n)
  controller.abort();await expect(result.verifyReadSet()).rejects.toMatchObject({name:'AbortError'})
  const g=nativeMarketListingFixture();controller.abort()
  await expect(verifyNativeMarketListing(g.client,g.target,g.listingInput,controller.signal)).rejects.toMatchObject({name:'AbortError'})
})
