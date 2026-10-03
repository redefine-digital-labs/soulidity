import {beforeEach,expect,it,vi} from 'vitest'
import {nativeMarketBuyFixture,bid as id,kioskFamily,capOrigin,usdcFamily} from './fixtures/native-market-buy'
import {NativeBuyPolicyBcs,NativeBuyRegistryBcs,NativeBuyRegistrationBcs,readNativeMarketBuySnapshot,readNativeMarketBuyTarget} from '../../web/lib/animacraft/native-market-buy-snapshot'
import {NativeMarketConfigBcs,NativeMarketListingBcs} from '../../web/lib/animacraft/native-market'
import {NativeSoulBindingBcs,NativeSoulStateBcs} from '../../web/lib/animacraft/native-receive'
import {NativeCancelKioskBcs,NativeCancelPersonalKioskCapBcs} from '../../web/lib/animacraft/native-market-cancel-snapshot'
let f:ReturnType<typeof nativeMarketBuyFixture>
beforeEach(()=>{f=nativeMarketBuyFixture()})
it('returns one exact gross native buy target with definitive no-cap/no-registration state',async()=>{
  expect(await f.read()).toEqual({schema:'native-market-buy-v1',soulId:id(12),stateId:id(14),bindingId:id(13),seller:id(11),sellerKioskId:id(18),
    ownershipEpoch:'7',listingId:id(33),priceAtomic:'10001',creator:id(11),makerCreator:id(61),soulCreatorRoyaltyBps:750,
    makerSourceRoyaltyBps:250,protocolFeeRecipient:id(60),buyer:id(50),buyerKioskId:null,buyerKioskCapId:null,purchaseAvailable:true,
    release:{network:'mainnet',protocolConfigId:id(1),soulidityOriginalPackageId:id(6),soulidityCallablePackageId:id(5),
      soulidityCallableDigest:f.target.soulidityCallableDigest,...f.config,writesEnabled:false}})
  expect(f.scanCalls[0]).toMatchObject({owner:id(50),objectType:`${capOrigin}::personal_kiosk::PersonalKioskCap`,pageSize:50})
  expect(f.calls.some(row=>[id(10),id(15),id(16)].includes(row.objectId))).toBe(false)
})
it('uses the actual registered pair first, never a different owned cap',async()=>{
  f.register();f.pages[0]=[f.addCap(id(70),id(71))]
  expect(await f.read()).toMatchObject({buyerKioskId:id(51),buyerKioskCapId:id(52)})
  expect(f.scanCalls).toHaveLength(0)
})
it('exhausts typed owned pages and selects the lowest exact valid cap deterministically',async()=>{
  f.pages.splice(0,1,[f.addCap(id(70),id(71))],[f.addCap(id(52),id(51))])
  expect(await f.read()).toMatchObject({buyerKioskId:id(51),buyerKioskCapId:id(52)})
  expect(f.scanCalls).toHaveLength(2);expect(f.scanCalls[1].pageToken).toEqual(new Uint8Array([1]))
})
it.each(['paused','fee'])('keeps validated metadata readable but unavailable for %s',async reason=>{
  f.edit(id(30),NativeMarketConfigBcs,v=>{if(reason==='paused')v.secondary_enabled=false;else v.platform_fee_bps=300})
  expect(await f.read()).toMatchObject({purchaseAvailable:false})
})
it('does not permit self purchase',async()=>{
  expect(await readNativeMarketBuySnapshot(f.client,f.target,f.config,{soulId:id(12),stateId:id(14),listingId:id(33),buyer:id(11)}))
    .toMatchObject({purchaseAvailable:false})
})
it('returns unavailable rather than inventing a price once unlisted',async()=>{
  f.edit(id(14),NativeSoulStateBcs,v=>{v.is_listed=false})
  await expect(f.read()).rejects.toMatchObject({status:409})
})
it.each(['id','name','version','kiosk','cap','custody','type'])('fails closed on inconsistent registration %s without owned-scan fallback',async what=>{
  f.register()
  if(what==='custody')f.objects.get(f.registrationId).owner.address=id(99)
  else if(what==='type')f.objects.get(f.registrationId).objectType='0x2::wrong::Field'
  else f.edit(f.registrationId,NativeBuyRegistrationBcs,v=>{
    if(what==='id')v.id=id(99);if(what==='name')v.name.owner=id(99);if(what==='version')v.value.version='2'
    if(what==='kiosk')v.value.kiosk_id=id(99);if(what==='cap')v.value.kiosk_cap_id=id(99)
  })
  await expect(f.read()).rejects.toBeInstanceOf(Error);expect(f.scanCalls).toHaveLength(0)
})
it.each(['owner','capType','capFor','capNone','capId','kioskOwner','kioskShared'])('verifies exact registered cap and Kiosk %s',async what=>{
  f.register()
  if(what==='owner')f.objects.get(id(52)).owner.address=id(99)
  if(what==='capType')f.objects.get(id(52)).objectType=`${kioskFamily}::personal_kiosk::PersonalKioskCap`
  if(what==='capFor'||what==='capNone'||what==='capId')f.edit(id(52),NativeCancelPersonalKioskCapBcs,v=>{
    if(what==='capFor')v.cap.for=id(99);if(what==='capNone')v.cap=null;if(what==='capId')v.id=id(99)
  })
  if(what==='kioskOwner')f.edit(id(51),NativeCancelKioskBcs,v=>{v.owner=id(99)})
  if(what==='kioskShared')f.objects.get(id(51)).owner.kind=1
  await expect(f.read()).rejects.toBeInstanceOf(Error);expect(f.scanCalls).toHaveLength(0)
})
it.each(['extra','missing','duplicate','wrong-proof','wrong-origin','id','type'])('requires exact full Soul policy rules %s',async what=>{
  if(what==='type')f.objects.get(id(32)).objectType=`0x2::transfer_policy::TransferPolicy<${id(6)}::soul::Other>`
  else f.edit(id(32),NativeBuyPolicyBcs,v=>{
    const rows=v.rules.contents
    if(what==='extra')rows.push({name:`${id(99).slice(2)}::extra::Rule`})
    if(what==='missing')rows.pop();if(what==='duplicate')rows[2]=rows[0]
    if(what==='wrong-proof')rows[2].name=rows[2].name.replace('SoulMarketProof','CollectionMarketProof')
    if(what==='wrong-origin')rows[0].name=`${id(99).slice(2)}::kiosk_lock_rule::Rule`
    if(what==='id')v.id=id(99)
  })
  await expect(f.read()).rejects.toBeInstanceOf(Error)
})
it.each(['kiosk-edge','kiosk-version','kiosk-config','cap-origin','usdc-edge','usdc-origin','payment','registry-origin','proof-origin'])
('rejects native dependency/target substitution: %s',async what=>{
  const native=f.objects.get(id(5)).package
  if(what==='kiosk-edge')native.linkage=native.linkage.filter((row:any)=>row.originalId!==kioskFamily)
  if(what==='kiosk-version')native.linkage.find((row:any)=>row.originalId===kioskFamily).upgradedVersion=3n
  if(what==='kiosk-config')f.config.kioskPackageId=id(99)
  if(what==='cap-origin'){f.register();f.objects.get(id(40)).package.typeOrigins[0].packageId=id(99)}
  if(what==='usdc-edge')native.linkage=native.linkage.filter((row:any)=>row.originalId!==usdcFamily)
  if(what==='usdc-origin')f.objects.get(id(44)).package.typeOrigins[0].packageId=id(99)
  if(what==='payment')f.config.paymentCoinType='0x2::sui::SUI'
  if(what==='registry-origin'||what==='proof-origin')native.typeOrigins.find((row:any)=>row.datatypeName===(what==='registry-origin'?'KioskRegistry':'SoulMarketProof')).packageId=id(99)
  await expect(f.read()).rejects.toBeInstanceOf(Error)
})
it.each(['owner','type','duplicate','repeated-cursor','rpc','registration-rpc'])('never turns owned/registry %s errors into no Kiosk',async what=>{
  const row=f.addCap();f.pages[0]=[structuredClone(row)]
  if(what==='owner')f.pages[0][0].owner.address=id(99)
  if(what==='type')f.pages[0][0].objectType=`${id(99)}::personal_kiosk::PersonalKioskCap`
  if(what==='duplicate')f.pages[0].push(row)
  if(what==='rpc')f.client.stateService.listOwnedObjects=async()=>{throw new Error('RPC unavailable')}
  if(what==='repeated-cursor')f.client.stateService.listOwnedObjects=async()=>({response:{objects:[],nextPageToken:new Uint8Array([1])}}) as never
  if(what==='registration-rpc') {
    const original=f.client.ledgerService.batchGetObjects.bind(f.client.ledgerService)
    f.client.ledgerService.batchGetObjects=async request=>request.requests[0].objectId===f.registrationId
      ?{response:{objects:[{result:{oneofKind:'error',error:{code:14}}}]}} as never:original(request)
  }
  await expect(f.read()).rejects.toBeInstanceOf(Error)
})
it.each([30,31,32,33,14,12,18,51,52])('one final readset detects object %i drift after buyer reads',async n=>{
  f.register();const original=f.client.ledgerService.getObject.bind(f.client.ledgerService)
  f.client.ledgerService.getObject=async request=>{
    const result=await original(request)
    if(request.objectId===id(51)&&request.readMask?.paths.includes('contents')) {
      const copy=structuredClone(result);f.objects.get(id(n)).version=3n;return copy
    }return result
  }
  await expect(f.read()).rejects.toMatchObject({status:409})
})
it('captures absent registry changing while an owned scan is in flight',async()=>{
  f.client.stateService.listOwnedObjects=(async()=>{f.register();f.objects.get(id(31)).version=3n;return {response:{objects:[]}}}) as never
  await expect(f.read()).rejects.toMatchObject({status:409})
})
it.each(['binding','listing','config','registry'])('retains exact upstream native %s checks',async what=>{
  if(what==='binding')f.edit(id(13),NativeSoulBindingBcs,v=>{v.original_holder=id(99)})
  if(what==='listing')f.edit(id(33),NativeMarketListingBcs,v=>{v.seller=id(99)})
  if(what==='config')f.edit(id(30),NativeMarketConfigBcs,v=>{v.legacy_config_id=id(99)})
  if(what==='registry')f.edit(id(31),NativeBuyRegistryBcs,v=>{v.version='2'})
  await expect(f.read()).rejects.toBeInstanceOf(Error)
})
function env() {return {NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_PACKAGE_ID:id(6),NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID:id(30),
  NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID:id(31),NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID:id(32),
  NEXT_PUBLIC_KIOSK_PACKAGE_ID:id(40),NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE:f.config.paymentCoinType}}
it('reads only the explicit current V2 target environment',()=>{expect(readNativeMarketBuyTarget(f.target,env())).toEqual(f.config)})
it.each(['NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_PACKAGE_ID','NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID',
  'NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID','NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID',
  'NEXT_PUBLIC_KIOSK_PACKAGE_ID','NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE'])('fails closed when target setting %s is missing',key=>{
  const config=env();delete (config as Record<string,unknown>)[key]
  expect(()=>readNativeMarketBuyTarget(f.target,config)).toThrow('target unavailable')
})
it('rejects V6/family/payment substitutions instead of accepting old aliases',()=>{
  expect(()=>readNativeMarketBuyTarget(f.target,{...env(),NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_PACKAGE_ID:id(99)})).toThrow()
  expect(()=>readNativeMarketBuyTarget(f.target,{...env(),NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE:'0x2::sui::SUI'})).toThrow()
})
