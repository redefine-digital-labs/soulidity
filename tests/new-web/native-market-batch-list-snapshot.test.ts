import {expect,it} from 'vitest'
import {deriveDynamicFieldID} from '@mysten/sui/utils'
import {nativeMarketListFixture} from './fixtures/native-market-list'
import {bid as id} from './fixtures/native-market-buy'
import {fixtureKioskItem} from './fixtures/native-receive'
import {NativeSoulBcs,NativeSoulStateBcs,NativeSoulBindingBcs} from '../../web/lib/animacraft/native-receive'
import {EquipmentPointerBcs} from '../../web/lib/animacraft/native-equipment'
import {NativeCancelKioskBcs} from '../../web/lib/animacraft/native-market-cancel-snapshot'
import {readBrowserNativeMarketBatchList} from '../../web/lib/animacraft/browser-native-market-read'

function fixture(){
  const f=nativeMarketListFixture()
  for(const [source,target,codec] of [[12,112,NativeSoulBcs],[14,114,NativeSoulStateBcs],[13,113,NativeSoulBindingBcs]] as const){
    const row=structuredClone(f.objects.get(id(source)));row.objectId=id(target)
    const value:any=codec.parse(row.contents.value);value.id=id(target)
    if(source===14)value.soul_id=id(112)
    if(source===13){value.soul_id=id(112);value.soul_state_id=id(114)}
    row.contents.value=(codec as any).serialize(value).toBytes();f.objects.set(id(target),row)
  }
  fixtureKioskItem(f.objects,id(18),id(112))
  f.edit(id(18),NativeCancelKioskBcs,v=>{v.item_count=2})
  const pointer=deriveDynamicFieldID(id(114),'u8',new Uint8Array([9]))
  f.put(pointer,'0x2::dynamic_field::Field<u8,0x2::object::ID>',EquipmentPointerBcs,{id:pointer,name:9,value:id(113)},{kind:2,address:id(114)})
  const selection=[{soulId:id(12),stateId:id(14),priceAtomic:'100'},{soulId:id(112),stateId:id(114),priceAtomic:'200'}]
  const read=(signal?:AbortSignal)=>readBrowserNativeMarketBatchList({owner:id(11),selection,config:{target:f.target,buyTarget:f.config},signal},{client:()=>f.client})
  return {...f,selection,read}
}
it('existing browser batch callback reads only exact selected Souls with distinct prices under one readset',async()=>{
  const f=fixture(),result=await f.read()
  expect(result.rows.map(row=>[row.snapshot.soulId,row.priceAtomic])).toEqual([[id(12),'100'],[id(112),'200']])
  expect(result.rows.every(row=>row.assetType==='soul'&&row.snapshot.listAvailable&&row.snapshot.equipmentId===null)).toBe(true)
})
it.each(['first-state','first-soul','cap','registry'])('does not lose earlier %s drift while reading a later selection',async reason=>{
  const f=fixture(),get=f.client.ledgerService.getObject.bind(f.client.ledgerService),batch=f.client.ledgerService.batchGetObjects.bind(f.client.ledgerService)
  const changed=reason==='first-state'?14:reason==='first-soul'?12:reason==='cap'?70:31
  let injected=false
  const mutate=()=>{injected=true;f.objects.get(id(changed)).version++}
  f.client.ledgerService.getObject=async req=>{
    if(req.objectId===id(114)&&req.readMask?.paths?.includes('contents'))mutate()
    return get(req)
  }
  f.client.ledgerService.batchGetObjects=async req=>{
    if(req.requests.some(row=>row.objectId===id(114))&&req.readMask?.paths?.includes('contents'))mutate()
    return batch(req)
  }
  await expect(f.read()).rejects.toMatchObject({status:409})
  expect(injected).toBe(true)
})
it.each(['owner','listed','missing','extra','duplicate'])('never returns a partial selected batch when %s is invalid',async reason=>{
  const f=fixture()
  if(reason==='owner')f.edit(id(114),NativeSoulStateBcs,v=>{v.current_owner=id(99)})
  if(reason==='listed')f.edit(id(114),NativeSoulStateBcs,v=>{v.is_listed=true})
  if(reason==='missing')f.objects.delete(id(112))
  if(reason==='extra')(f.selection[0] as any).equipment=[id(84)]
  if(reason==='duplicate')f.selection.push(f.selection[0])
  await expect(f.read()).rejects.toBeInstanceOf(Error)
})
it('captures selection/prices before the first await and rejects pre-cancelled input without reads',async()=>{
  const f=fixture(),get=f.client.core.getChainIdentifier.bind(f.client.core)
  f.client.core.getChainIdentifier=async()=>{if(f.selection.length===2){f.selection[1].priceAtomic='1';f.selection.pop()}return get()}
  expect((await f.read()).rows.map(row=>row.priceAtomic)).toEqual(['100','200'])
  const another=fixture(),controller=new AbortController();controller.abort()
  await expect(another.read(controller.signal)).rejects.toBeInstanceOf(Error);expect(another.calls).toHaveLength(0)
})
