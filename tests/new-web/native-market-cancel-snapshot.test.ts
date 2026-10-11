import {beforeEach,expect,it,vi} from 'vitest'
import {nativeReceiveFixture} from './fixtures/native-receive'
import {NativeMarketListingBcs} from '../../web/lib/animacraft/native-market'
import {NativeSoulBindingBcs,NativeSoulStateBcs,NativeSoulBcs,readNativeReceiveTarget} from '../../web/lib/animacraft/native-receive'
import {EquipmentPointerBcs} from '../../web/lib/animacraft/native-equipment'
import {NativeCancelKioskBcs,NativeCancelPersonalKioskCapBcs,readNativeMarketCancelSnapshot} from '../../web/lib/animacraft/native-market-cancel-snapshot'
const id=(n:number)=>`0x${n.toString(16).padStart(64,'0')}`
const family='0x434b5bd8f6a7b05fede0ff46c6e511d71ea326ed38056e3bcd681d2d7c2a7879'
const capOrigin='0x0cb4bcc0560340eb1a1b929cabe56b33fc6449820ec8c1980d69bb98b649b802'
let f:ReturnType<typeof nativeReceiveFixture>
let scan:ReturnType<typeof vi.fn>
const edit=(objectId:string,schema:any,change:(v:any)=>void)=>{
  const object=f.objects.get(objectId),value=schema.parse(object.contents.value)
  change(value);object.contents.value=schema.serialize(value).toBytes()
}
const read=(cap:string|null=id(33),listing:string|null=id(30),signal?:AbortSignal)=>readNativeMarketCancelSnapshot(
  f.client,f.target,{soulId:id(12),stateId:id(14),listingId:listing,kioskCapId:cap},signal,scan as never)
beforeEach(()=>{
  f=nativeReceiveFixture();scan=vi.fn().mockResolvedValue([{ownerAddress:id(11),currentKioskId:id(18),currentKioskCapOnChainId:id(33)}])
  for(const datatypeName of ['MarketConfigV2','SoulListing'])f.objects.get(id(5)).package.typeOrigins.push({moduleName:'market',datatypeName,packageId:id(6)})
  f.objects.get(id(5)).package.linkage.push({originalId:family,upgradedId:id(40),upgradedVersion:2n})
  f.objects.set(id(40),{objectId:id(40),version:2n,digest:'linked-package',owner:{kind:4},package:{
    storageId:id(40),originalId:family,version:2n,linkage:[],
    modules:[{name:'personal_kiosk',contents:new Uint8Array([1,2,3,4,5])}],
    typeOrigins:[{moduleName:'personal_kiosk',datatypeName:'PersonalKioskCap',packageId:capOrigin}]}})
  const put=(objectId:string,type:string,schema:any,value:any,owner:any={kind:3})=>f.objects.set(objectId,{
    objectId,version:2n,digest:'mutable-object',owner,objectType:type,contents:{value:schema.serialize(value).toBytes()}})
  put(id(30),`${id(6)}::market::SoulListing`,NativeMarketListingBcs,{id:id(30),version:'8',soul_id:id(12),state_id:id(14),
    seller:id(11),seller_kiosk_id:id(18),price:'10001',creator:id(11),creator_royalty_bps:750,collection_id:null,
    purchase_cap:{id:id(32),kiosk_id:id(18),item_id:id(12),min_price:'0'},is_active:true})
  put(id(18),'0x2::kiosk::Kiosk',NativeCancelKioskBcs,{id:id(18),profits:'0',owner:id(11),item_count:1,allow_extensions:false})
  put(id(33),`${capOrigin}::personal_kiosk::PersonalKioskCap`,NativeCancelPersonalKioskCapBcs,
    {id:id(33),cap:{id:id(34),for:id(18)}},{kind:1,address:id(11)})
  edit(id(14),NativeSoulStateBcs,v=>{v.creator_royalty_bps=750;v.is_listed=true;v.ownership_epoch='7'})
  edit(id(13),NativeSoulBindingBcs,v=>{v.rights.soul_creator_royalty_bps=750;v.rights.maker_source_royalty_bps=250})
})
it('reads exact active native cancellation inputs without config/fee/Root/DF10/media requests',async()=>{
  expect(await read()).toEqual({schema:'native-market-cancel-v1',soulId:id(12),stateId:id(14),bindingId:id(13),owner:id(11),
    kioskId:id(18),kioskCapId:id(33),ownershipEpoch:'7',listingId:id(30),listed:true,listingActive:true,
    release:{network:'mainnet',protocolConfigId:id(1),soulidityCallablePackageId:id(5),soulidityCallableDigest:f.target.soulidityCallableDigest,writesEnabled:false}})
  expect(new Set(f.calls.map(row=>row.objectId))).toEqual(new Set([id(5),id(4),id(40),id(14),id(12),f.itemFieldId,f.dfId,id(13),id(30),id(18),id(33)]))
  expect(scan).not.toHaveBeenCalled()
})
it('discovers a candidate cap but verifies its exact type/BCS/custody again',async()=>{
  expect(await read(null)).toMatchObject({kioskCapId:id(33)})
  expect(scan).toHaveBeenCalledWith(id(11))
  f.objects.get(id(33)).owner.address=id(99)
  await expect(read(null)).rejects.toBeInstanceOf(Error)
})
it.each([[],[{ownerAddress:id(99),currentKioskId:id(18),currentKioskCapOnChainId:id(33)}],
  [{ownerAddress:id(11),currentKioskId:id(99),currentKioskCapOnChainId:id(33)}]])('rejects missing/mismatched owned-scan candidates',async rows=>{
  scan.mockResolvedValue(rows);await expect(read(null)).rejects.toBeInstanceOf(Error)
})
it('rejects ambiguous owned-scan candidates',async()=>{
  const row={ownerAddress:id(11),currentKioskId:id(18),currentKioskCapOnChainId:id(33)}
  scan.mockResolvedValue([row,row]);await expect(read(null)).rejects.toBeInstanceOf(Error)
})
it('reports inactive listing without requiring the old seller to remain current owner',async()=>{
  edit(id(30),NativeMarketListingBcs,v=>{v.is_active=false;v.purchase_cap=null;v.seller=id(99);v.seller_kiosk_id=id(98)})
  edit(id(14),NativeSoulStateBcs,v=>{v.is_listed=false})
  expect(await read()).toMatchObject({listed:false,listingActive:false,owner:id(11)})
})
it('reports an old inactive listing even if a later listing is active, never as cancellable',async()=>{
  edit(id(30),NativeMarketListingBcs,v=>{v.is_active=false;v.purchase_cap=null})
  expect(await read()).toMatchObject({listed:true,listingActive:false})
})
it('requires listing lookup when no cached or supplied ID exists',async()=>{
  await expect(read(id(33),null)).rejects.toMatchObject({status:409})
  expect(f.calls).toHaveLength(0)
})
it.each(['cap-id','cap-for','cap-none','inner-id','owner','owner-kind','cap-type','kiosk-id','kiosk-owner','kiosk-kind'])
('rejects current Kiosk/cap substitution %s',async what=>{
  if(what==='owner')f.objects.get(id(33)).owner.address=id(99)
  else if(what==='owner-kind')f.objects.get(id(33)).owner.kind=3
  else if(what==='cap-type')f.objects.get(id(33)).objectType=`${family}::personal_kiosk::PersonalKioskCap`
  else if(what==='kiosk-kind')f.objects.get(id(18)).owner.kind=1
  else if(what.startsWith('kiosk'))edit(id(18),NativeCancelKioskBcs,v=>{if(what==='kiosk-id')v.id=id(99);else v.owner=id(99)})
  else edit(id(33),NativeCancelPersonalKioskCapBcs,v=>{
    if(what==='cap-id')v.id=id(99)
    if(what==='cap-for')v.cap.for=id(99)
    if(what==='cap-none')v.cap=null
    if(what==='inner-id')v.cap.id=id(0)
  })
  await expect(read()).rejects.toBeInstanceOf(Error)
})
it.each(['missing','duplicate','version','family','storage','owner','origin-missing','origin-duplicate','module'])
('rejects Kiosk dependency/type-origin mismatch: %s',async what=>{
  const pkg=f.objects.get(id(40)).package
  if(what==='missing')f.objects.get(id(5)).package.linkage.pop()
  if(what==='duplicate')f.objects.get(id(5)).package.linkage.push({originalId:family,upgradedId:id(40),upgradedVersion:2n})
  if(what==='version')f.objects.get(id(5)).package.linkage.at(-1).upgradedVersion=3n
  if(what==='family')pkg.originalId=id(99)
  if(what==='storage')pkg.storageId=id(99)
  if(what==='owner')f.objects.get(id(40)).owner.kind=3
  if(what==='origin-missing')pkg.typeOrigins=[]
  if(what==='origin-duplicate')pkg.typeOrigins.push({...pkg.typeOrigins[0]})
  if(what==='module')pkg.modules=[]
  await expect(read()).rejects.toBeInstanceOf(Error)
})
it.each(['id','version','soul_id','state_id','creator','creator_royalty_bps','collection_id','seller','seller_kiosk_id','purchase_cap'])
('rejects listing %s substitution',async key=>{
  edit(id(30),NativeMarketListingBcs,v=>{v[key]=key==='version'?'5':key==='creator_royalty_bps'?500:key==='purchase_cap'?null:id(99)})
  await expect(read()).rejects.toBeInstanceOf(Error)
})
it.each(['item_id','kiosk_id','min_price'])('rejects active PurchaseCap %s substitution',async key=>{
  edit(id(30),NativeMarketListingBcs,v=>{v.purchase_cap[key]=key==='min_price'?'1':id(99)})
  await expect(read()).rejects.toBeInstanceOf(Error)
})
it('rejects active listing with unlisted state and inactive listing with an unreturned cap',async()=>{
  edit(id(14),NativeSoulStateBcs,v=>{v.is_listed=false});await expect(read()).rejects.toBeInstanceOf(Error)
  edit(id(30),NativeMarketListingBcs,v=>{v.is_active=false});await expect(read()).rejects.toBeInstanceOf(Error)
})
it.each(['df9','binding','rights','immutable','custody','soul','state'])('rejects native identity substitution: %s',async what=>{
  if(what==='df9')edit(f.dfId,EquipmentPointerBcs,v=>{v.name=8})
  if(what==='binding')edit(id(13),NativeSoulBindingBcs,v=>{v.soul_state_id=id(99)})
  if(what==='rights')edit(id(13),NativeSoulBindingBcs,v=>{v.rights.soul_creator_royalty_bps=500})
  if(what==='immutable')f.objects.get(id(13)).owner.kind=3
  if(what==='custody')f.objects.get(id(12)).owner.address=id(99)
  if(what==='soul')edit(id(12),NativeSoulBcs,v=>{v.creator=id(99)})
  if(what==='state')edit(id(14),NativeSoulStateBcs,v=>{v.soul_id=id(99)})
  await expect(read()).rejects.toBeInstanceOf(Error)
})
it.each([id(14),id(12),id(30),id(18),id(33)])('final-verifies mutable evidence %s after owned scan',async objectId=>{
  scan.mockImplementation(async()=>{f.objects.get(objectId).version=3n;return [{ownerAddress:id(11),currentKioskId:id(18),currentKioskCapOnChainId:id(33)}]})
  // The cap is read after discovery, so change it only after its first read.
  if(objectId===id(33)) {
    const original=f.client.ledgerService.getObject.bind(f.client.ledgerService)
    f.client.ledgerService.getObject=async request=>{const result=await original(request)
      if(request.objectId===id(33) && request.readMask?.paths.includes('contents')) {
        const copy=structuredClone(result);f.objects.get(id(33)).version=4n;return copy
      }return result}
  }
  await expect(read(null)).rejects.toMatchObject({status:409})
})
it('snapshots request/pin before await and keeps writes disabled unless explicitly true',async()=>{
  const request={soulId:id(12),stateId:id(14),listingId:id(30),kioskCapId:id(33)}
  const target={...f.target,marketWritesEnabled:true}
  const pending=readNativeMarketCancelSnapshot(f.client,target,request)
  request.soulId=id(99);target.marketWritesEnabled=false
  expect(await pending).toMatchObject({soulId:id(12),release:{writesEnabled:true}})
})
it('bounds a stalled owned scan by the abort signal',async()=>{
  const controller=new AbortController()
  scan.mockImplementation(()=>{controller.abort(new Error('cancelled'));return new Promise(()=>{})})
  await expect(read(null,id(30),controller.signal)).rejects.toThrow('cancelled')
})
it.each([true,false,undefined])('strict optional market write switch %s does not borrow equipment enablement',value=>{
  const target={...f.target,...(value===undefined?{}:{marketWritesEnabled:value})}
  const env={NEXT_PUBLIC_SUI_NETWORK:'mainnet',NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID:target.soulidityCallablePackageId,
    NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID:target.soulidityOriginalPackageId,NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON:JSON.stringify(target)}
  expect(readNativeReceiveTarget(env).marketWritesEnabled===true).toBe(value===true)
})
it.each(['true',1,null,{}])('rejects malformed market write switch %s',value=>{
  const target={...f.target,marketWritesEnabled:value}
  expect(()=>readNativeReceiveTarget({NEXT_PUBLIC_SUI_NETWORK:'mainnet',NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID:target.soulidityCallablePackageId,
    NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID:target.soulidityOriginalPackageId,NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON:JSON.stringify(target)})).toThrow()
})
