import {beforeEach,expect,it} from 'vitest'
import {nativeMarketListFixture} from './fixtures/native-market-list'
import {bid as id,kioskFamily,capOrigin} from './fixtures/native-market-buy'
import {NativeBuyPolicyBcs,NativeBuyRegistrationBcs,NativeBuyRegistryBcs} from '../../web/lib/animacraft/native-market-buy-snapshot'
import {NativeMarketConfigBcs,NativeMarketListingBcs} from '../../web/lib/animacraft/native-market'
import {NativeSoulBindingBcs,NativeSoulStateBcs} from '../../web/lib/animacraft/native-receive'
import {NativeCancelKioskBcs,NativeCancelPersonalKioskCapBcs} from '../../web/lib/animacraft/native-market-cancel-snapshot'
let f:ReturnType<typeof nativeMarketListFixture>
beforeEach(()=>{f=nativeMarketListFixture()})
it('returns held LIST facts from exact current custody, not stale DB listing, with writes disabled',async()=>{
  f.request.listingId=id(99)
  expect(await f.read()).toEqual({schema:'native-market-list-v1',soulId:id(12),stateId:id(14),bindingId:id(13),owner:id(11),
    kioskId:id(18),kioskCapId:id(70),ownershipEpoch:'7',creator:id(11),makerCreator:id(61),soulCreatorRoyaltyBps:750,
    makerSourceRoyaltyBps:250,protocolFeeRecipient:id(60),listed:false,listingId:null,priceAtomic:null,equipmentId:null,
    listAvailable:true,repriceAvailable:false,release:{network:'mainnet',protocolConfigId:id(1),soulidityOriginalPackageId:id(6),
      soulidityCallablePackageId:id(5),soulidityCallableDigest:f.target.soulidityCallableDigest,...f.config,writesEnabled:false}})
  expect(f.scanCalls[0]).toMatchObject({owner:id(11),objectType:`${capOrigin}::personal_kiosk::PersonalKioskCap`})
})
it('returns exact active listing and gross price for atomic REPRICE',async()=>{
  f=nativeMarketListFixture(true);f.register()
  expect(await f.read()).toMatchObject({listed:true,listingId:id(33),priceAtomic:'10001',listAvailable:false,repriceAvailable:true})
  expect(f.scanCalls).toHaveLength(0)
})
it('rejects a bound Soul without complete authenticated equipment proof',async()=>{
  f.equip()
  await expect(f.read()).rejects.toBeInstanceOf(Error)
})
it('rejects inconsistent already-listed equipment',async()=>{
  f=nativeMarketListFixture(true);f.equip();await expect(f.read()).rejects.toBeInstanceOf(Error)
})
it.each(['paused','fee'])('returns unavailable metadata for %s without enabling writes',async reason=>{
  f.edit(id(30),NativeMarketConfigBcs,v=>{if(reason==='paused')v.secondary_enabled=false;else v.platform_fee_bps=300})
  expect(await f.read()).toMatchObject({listAvailable:false,repriceAvailable:false,release:{writesEnabled:false}})
})
it('keeps exact policy/registry readiness even for paused pre-sign metadata',async()=>{
  f.edit(id(30),NativeMarketConfigBcs,v=>{v.secondary_enabled=false});f.objects.delete(id(32))
  await expect(f.read()).rejects.toBeInstanceOf(Error)
})
it('only reflects an explicitly enabled target flag',async()=>{
  f.target.marketWritesEnabled=true;expect(await f.read()).toMatchObject({release:{writesEnabled:true}})
})
it('uses the registered current pair before discovery',async()=>{
  f.register();f.pages[0]=[];expect(await f.read()).toMatchObject({kioskCapId:id(70)});expect(f.scanCalls).toHaveLength(0)
})
it('verifies a current cap hint without owned scan when registration is definitively absent',async()=>{
  f.request.kioskCapId=id(70);expect(await f.read()).toMatchObject({kioskCapId:id(70)});expect(f.scanCalls).toHaveLength(0)
})
it('never substitutes another owned Kiosk when registered row points elsewhere',async()=>{
  f.register(id(70),id(99));await expect(f.read()).rejects.toBeInstanceOf(Error);expect(f.scanCalls).toHaveLength(0)
})
it('rejects a hint conflicting with registration',async()=>{
  f.register();f.request.kioskCapId=id(72);f.addOwnerCap(id(72))
  await expect(f.read()).rejects.toBeInstanceOf(Error);expect(f.scanCalls).toHaveLength(0)
})
it('exhausts pages and ignores a valid owner cap for a different Kiosk',async()=>{
  f.pages.splice(0,1,[f.addOwnerCap(id(60),id(90))],[f.addOwnerCap(id(70))])
  expect(await f.read()).toMatchObject({kioskCapId:id(70)});expect(f.scanCalls).toHaveLength(2)
})
it.each(['none','only-other'])('cannot create another seller Kiosk: %s',async mode=>{
  f.pages[0]=mode==='none'?[]:[f.addOwnerCap(id(60),id(90))]
  await expect(f.read()).rejects.toMatchObject({code:'NATIVE_MARKET_LIST_INVALID'})
})
it.each(['id','owner','version','custody','type'])('rejects malformed registration %s',async what=>{
  f.register()
  if(what==='custody')f.objects.get(f.registrationId).owner.address=id(99)
  else if(what==='type')f.objects.get(f.registrationId).objectType='0x2::wrong::Field'
  else f.edit(f.registrationId,NativeBuyRegistrationBcs,v=>{
    if(what==='id')v.id=id(99);if(what==='owner')v.name.owner=id(99);if(what==='version')v.value.version='2'
  })
  await expect(f.read()).rejects.toBeInstanceOf(Error);expect(f.scanCalls).toHaveLength(0)
})
it.each(['owner','capType','capFor','capNone','capId','innerCapId','kioskOwner','kioskShared'])('rejects custody substitution %s',async what=>{
  f.register()
  if(what==='owner')f.objects.get(id(70)).owner.address=id(99)
  if(what==='capType')f.objects.get(id(70)).objectType=`${kioskFamily}::personal_kiosk::PersonalKioskCap`
  if(['capFor','capNone','capId','innerCapId'].includes(what))f.edit(id(70),NativeCancelPersonalKioskCapBcs,v=>{
    if(what==='capFor')v.cap.for=id(99);if(what==='capNone')v.cap=null;if(what==='capId')v.id=id(99);if(what==='innerCapId')v.cap.id=id(0)
  })
  if(what==='kioskOwner')f.edit(id(18),NativeCancelKioskBcs,v=>{v.owner=id(99)})
  if(what==='kioskShared')f.objects.get(id(18)).owner.kind=1
  await expect(f.read()).rejects.toBeInstanceOf(Error)
})
it.each(['extra','missing','duplicate','wrong-proof','wrong-origin'])('rejects policy readiness %s',async what=>{
  f.edit(id(32),NativeBuyPolicyBcs,v=>{
    const rows=v.rules.contents
    if(what==='extra')rows.push({name:`${id(99).slice(2)}::extra::Rule`})
    if(what==='missing')rows.pop();if(what==='duplicate')rows[2]=rows[0]
    if(what==='wrong-proof')rows[2].name=rows[2].name.replace('SoulMarketProof','CollectionMarketProof')
    if(what==='wrong-origin')rows[0].name=`${id(99).slice(2)}::kiosk_lock_rule::Rule`
  });await expect(f.read()).rejects.toBeInstanceOf(Error)
})
it.each(['namespace','binding','rights','state-owner','registry','config-history','chain-short','chain-wrong','kiosk-linkage','payment'])
('rejects source/authority substitution %s',async what=>{
  if(what==='namespace')f.objects.get(id(13)).objectType=`${id(99)}::output_v8::NativeSoulBindingV8`
  if(what==='binding')f.edit(id(13),NativeSoulBindingBcs,v=>{v.soul_state_id=id(99)})
  if(what==='rights')f.edit(id(13),NativeSoulBindingBcs,v=>{v.rights.soul_creator_royalty_bps=500})
  if(what==='state-owner')f.edit(id(14),NativeSoulStateBcs,v=>{v.current_owner=id(99)})
  if(what==='registry')f.edit(id(31),NativeBuyRegistryBcs,v=>{v.version='2'})
  if(what==='config-history')f.edit(id(30),NativeMarketConfigBcs,v=>{v.legacy_config_id=id(99)})
  if(what==='chain-short'||what==='chain-wrong')f.client.core.getChainIdentifier=async()=>what==='chain-short'?'35834a8a':'5btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S'
  if(what==='kiosk-linkage')f.config.kioskPackageId=id(99)
  if(what==='payment')f.config.paymentCoinType='0x2::sui::SUI'
  await expect(f.read()).rejects.toBeInstanceOf(Error)
})
it.each(['id','seller','state','inactive','version','cap-none','cap-item','cap-price','price'])('rejects active listing substitution %s',async what=>{
  f=nativeMarketListFixture(true)
  f.edit(id(33),NativeMarketListingBcs,v=>{
    if(what==='id')v.id=id(99);if(what==='seller')v.seller=id(99);if(what==='state')v.state_id=id(99)
    if(what==='inactive')v.is_active=false;if(what==='version')v.version='5';if(what==='cap-none')v.purchase_cap=null
    if(what==='cap-item')v.purchase_cap.item_id=id(99);if(what==='cap-price')v.purchase_cap.min_price='1';if(what==='price')v.price='0'
  });await expect(f.read()).rejects.toBeInstanceOf(Error)
})
it('requires a real active listing hint when chain state is listed',async()=>{
  f=nativeMarketListFixture(true);f.request.listingId=id(99);await expect(f.read()).rejects.toBeInstanceOf(Error)
})
it.each([12,14,18,30,31,32,70])('rejects final readset drift after cap discovery for object %s',async n=>{
  const original=f.client.stateService.listOwnedObjects.bind(f.client.stateService)
  f.client.stateService.listOwnedObjects=async req=>{
    const result=await original(req);f.objects.get(id(n)).digest='changed';return result
  }
  // The selected cap is first read after discovery; drift it during the final verification instead.
  if(n===70) {
    const get=f.client.ledgerService.getObject.bind(f.client.ledgerService);let seen=0
    f.client.ledgerService.getObject=async req=>{
      if(req.objectId===id(70)&&++seen===2)f.objects.get(id(70)).digest='changed-again'
      return get(req)
    }
  }
  await expect(f.read()).rejects.toMatchObject({status:409})
})
it('detects registry absence becoming presence during scan',async()=>{
  const original=f.client.stateService.listOwnedObjects.bind(f.client.stateService)
  f.client.stateService.listOwnedObjects=async req=>{
    const result=await original(req);f.register();f.objects.get(id(31)).version++;return result
  };await expect(f.read()).rejects.toMatchObject({status:409})
})
it('detects absent equipment becoming present while owner-cap discovery awaits',async()=>{
  const original=f.client.stateService.listOwnedObjects.bind(f.client.stateService)
  f.client.stateService.listOwnedObjects=async req=>{
    const result=await original(req);f.equip();f.objects.get(id(14)).version++;return result
  };await expect(f.read()).rejects.toMatchObject({status:409})
})
it('detects an existing equipment pointer changing after it was read',async()=>{
  f.equip()
  const original=f.client.stateService.listOwnedObjects.bind(f.client.stateService)
  f.client.stateService.listOwnedObjects=async req=>{
    const result=await original(req);f.objects.get(f.pointerId).digest='changed';return result
  };await expect(f.read()).rejects.toBeInstanceOf(Error)
})
it.each(['equipment','registration'])('never treats a %s RPC error as proof of absence',async field=>{
  const original=f.client.ledgerService.batchGetObjects.bind(f.client.ledgerService)
  f.client.ledgerService.batchGetObjects=async req=>{
    if(req.requests[0].objectId===(field==='equipment'?f.pointerId:f.registrationId))
      return {response:{objects:[{result:{oneofKind:'error',error:{code:14}}}]}} as never
    return original(req)
  };await expect(f.read()).rejects.toMatchObject({status:503})
})
it('snapshots caller input and configuration once across awaits',async()=>{
  const original=f.client.core.getChainIdentifier.bind(f.client.core)
  f.client.core.getChainIdentifier=async()=>{
    f.request.soulId=id(99);f.request.kioskCapId=id(99);f.config.kioskRegistryId=id(99);return original()
  };expect(await f.read()).toMatchObject({soulId:id(12),kioskCapId:id(70),release:{kioskRegistryId:id(31)}})
})
it.each(['rpc','duplicate','wrong-owner','repeat-cursor'])('fails closed on incomplete discovery %s',async what=>{
  if(what==='rpc')f.client.stateService.listOwnedObjects=async()=>{throw new Error('RPC failed')}
  if(what==='duplicate')f.pages[0].push(f.pages[0][0])
  if(what==='wrong-owner')f.pages[0][0].owner.address=id(99)
  if(what==='repeat-cursor')f.client.stateService.listOwnedObjects=async()=>({response:{objects:[],nextPageToken:new Uint8Array([1])}}) as never
  await expect(f.read()).rejects.toBeInstanceOf(Error)
})
it('aborts before any network work',async()=>{
  const controller=new AbortController();controller.abort();await expect(f.read(controller.signal)).rejects.toBeInstanceOf(Error)
  expect(f.calls).toHaveLength(0)
})
it('accepts explicit empty next-page bytes as definitive pagination completion',async()=>{
  f.client.stateService.listOwnedObjects=async()=>({response:{objects:f.pages[0],nextPageToken:new Uint8Array()}}) as never
  expect(await f.read()).toMatchObject({kioskCapId:id(70),listAvailable:true})
})
it.each(['oversized-page','oversized-token','nonbytes-token'])('rejects unbounded owned-cap response %s',async what=>{
  f.client.stateService.listOwnedObjects=async()=>({response:{
    objects:what==='oversized-page'?Array.from({length:51},()=>f.pages[0][0]):f.pages[0],
    nextPageToken:what==='oversized-token'?new Uint8Array(4097):what==='nonbytes-token'?'cursor':undefined,
  }}) as never
  await expect(f.read()).rejects.toMatchObject({code:'NATIVE_MARKET_LIST_INVALID'})
})
