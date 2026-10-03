import {expect,it} from 'vitest'
import {nativeMarketListFixture} from './fixtures/native-market-list'
import {nativeEquipmentSourceFixture} from './fixtures/native-equipment-source'
import {bid as id} from './fixtures/native-market-buy'
import {NativeSoulBindingBcs} from '../../web/lib/animacraft/native-receive'
import {EquipmentBindingFieldBcs,EquipmentBaseItemBcs} from '../../web/lib/animacraft/native-equipment'
import {NativeMarketConfigBcs} from '../../web/lib/animacraft/native-market'
import {validateMarketListSnapshot} from '../../web/lib/animacraft/market-list-operation'
import {readBrowserNativeMarketList} from '../../web/lib/animacraft/browser-native-market-read'

// Both original raw readers run against one object store, without replacing
// either reader or readset verification with a precomputed snapshot.
function fixture() {
  const f=nativeMarketListFixture(),e=nativeEquipmentSourceFixture()
  for(const [key,value] of e.objects)if(!f.objects.has(key))f.objects.set(key,value)
  for(const n of [4,5]) {
    const dest=f.objects.get(id(n)).package,source=e.objects.get(id(n)).package
    for(const link of source.linkage)if(!dest.linkage.some((v:any)=>v.originalId===link.originalId))dest.linkage.push(link)
  }
  f.objects.set(id(1),e.objects.get(id(1)))
  f.objects.set(e.pointerId,e.objects.get(e.pointerId))
  f.edit(id(13),NativeSoulBindingBcs,v=>{v.root_content_commitment=Array(32).fill(1)})
  f.edit(e.bindingId,EquipmentBindingFieldBcs,v=>{v.value.ownership_epoch='7'})
  Object.assign(f.target,{runtime:e.target.runtime,equipmentWritesEnabled:true,marketWritesEnabled:true})
  f.addOwnerCap(id(170));f.request.kioskCapId=id(170)
  return {...f,e}
}
it('original LIST reader returns the complete verified detach plan, retaining instances with seller',async()=>{
  const f=fixture(),snapshot=validateMarketListSnapshot(await f.read())
  expect(snapshot).toMatchObject({equipmentId:id(80),listAvailable:true,repriceAvailable:false,
    equipmentSale:{scope:{equipmentId:id(80),expectedRevision:'1'},definitionRegistryId:id(81),baseRegistryId:id(85),
      removals:[{kind:'base',itemId:id(84)}],packs:[],writesEnabled:true,runtimeCallableDigest:f.e.target.runtime.callableDigest}})
  expect(snapshot.equipmentSale!.removals).toHaveLength(1)
})
it('the existing browser callback carries the verified equipment plan through its bounded client',async()=>{
  const f=fixture()
  const result=await readBrowserNativeMarketList({...f.request,config:{target:f.target,buyTarget:f.config}},
    {client:()=>f.client})
  expect(validateMarketListSnapshot(result).equipmentSale?.removals).toEqual([{kind:'base',itemId:id(84)}])
})
it('closes a verified empty binding without inventing equipment removals or reading wallet inventory',async()=>{
  const f=fixture()
  f.e.editLoadout(v=>{v.selections=[null];v.selection_count='0'})
  f.objects.delete(id(84))
  const result=validateMarketListSnapshot(await f.read())
  expect(result).toMatchObject({listAvailable:true,equipmentSale:{removals:[],packs:[]}})
  expect(f.scanCalls).toHaveLength(0)
})
it('browser cancellation during the equipment read cannot return actionable readiness',async()=>{
  const f=fixture(),controller=new AbortController(),get=f.client.ledgerService.getObject.bind(f.client.ledgerService)
  f.client.ledgerService.getObject=async request=>{
    if(request.objectId===id(80))controller.abort()
    return get(request)
  }
  await expect(readBrowserNativeMarketList({...f.request,signal:controller.signal,config:{target:f.target,buyTarget:f.config}},
    {client:()=>f.client})).rejects.toBeInstanceOf(Error)
})
it.each(['paused','fee','equipment-gate'])('preserves the actual %s gate without omitting the plan',async reason=>{
  const f=fixture()
  if(reason==='equipment-gate')Object.assign(f.target,{equipmentWritesEnabled:false})
  else f.edit(id(30),NativeMarketConfigBcs,v=>{if(reason==='paused')v.secondary_enabled=false;else v.platform_fee_bps=300})
  const result=validateMarketListSnapshot(await f.read())
  expect(result.listAvailable).toBe(reason==='equipment-gate')
  expect(result.equipmentSale?.writesEnabled).toBe(reason!=='equipment-gate')
})
it.each(['holder','epoch','lock','missing-instance'])('rejects incomplete equipment custody: %s',async reason=>{
  const f=fixture()
  if(reason==='missing-instance')f.objects.delete(id(84))
  else if(reason==='lock')f.edit(id(84),EquipmentBaseItemBcs,v=>{v.equip_lock=null})
  else f.edit(f.e.bindingId,EquipmentBindingFieldBcs,v=>{v.value[reason==='holder'?'holder':'ownership_epoch']=reason==='holder'?id(99):'8'})
  await expect(f.read()).rejects.toBeInstanceOf(Error)
})
it.each([14,18,31,80,81,84,85])('rejects shared-readset drift while equipment is read: %s',async n=>{
  const f=fixture(),get=f.client.ledgerService.getObject.bind(f.client.ledgerService)
  f.client.ledgerService.getObject=async request=>{
    if(request.readMask?.paths?.length===3 && request.objectId===id(n))f.objects.get(id(n)).version++
    return get(request)
  }
  await expect(f.read()).rejects.toMatchObject({status:409})
})
