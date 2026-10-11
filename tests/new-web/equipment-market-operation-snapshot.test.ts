import {expect,it,vi} from 'vitest'
import {nativeEquipmentMarketAuthorityFixture} from './fixtures/native-equipment-market-authority'
import {equipmentMarketOperationFixture,emid} from './fixtures/equipment-market-operation'
import {readEquipmentMarketOperationSnapshot} from '../../web/lib/animacraft/equipment-market-operation-snapshot'
import {validateEquipmentMarketSnapshot} from '../../web/lib/animacraft/equipment-market-operation'
import {readBrowserEquipmentMarketOperation} from '../../web/lib/animacraft/browser-native-equipment-market-read'
import {readEquipmentMarketCustodySnapshot} from '../../web/lib/animacraft/native-equipment-market-read'
import {EquipmentBaseItemBcs} from '../../web/lib/animacraft/native-equipment'
import {EquipmentMakerBcs} from '../../web/lib/animacraft/native-equipment-source-bcs'

it('shows locked equipment without inventing a Soul scope or signable removal',async()=>{
  const f=nativeEquipmentMarketAuthorityFixture(),target={...f.target,equipmentMarket:f.marketPin}
  const result=await readEquipmentMarketOperationSnapshot(f.client,target,{rootId:f.rootId,itemId:emid(84),kind:'base',actor:emid(11)})
  expect(result.lock).not.toBeNull();expect(result.removal).toBeNull();expect(result.available.list).toBe(false)
})
it('joins actual Market and explicit Soul equipment under one readset',async()=>{
  const f=await equipmentMarketOperationFixture({equipped:true})
  expect(f.snapshot.removal).toMatchObject({soulId:emid(12),stateId:emid(14),sellSoul:false,
    selectedItems:[{kind:'base',itemId:emid(84),selectionIndex:'0',ownershipEpoch:'0'}],
    equipment:{closeBinding:false,finalRevision:'2',finalSelectionCount:'1',retainedSelectionIndexes:['1']}})
})
it.each(['soul','state','owner','kind','listing','extra'] as const)('rejects changed explicit read scope %s',async change=>{
  const f=await equipmentMarketOperationFixture({equipped:true}),request=structuredClone(f.request)
  if(change==='soul')request.equipmentScope!.soulId=emid(999)
  if(change==='state')request.equipmentScope!.stateId=emid(999)
  if(change==='owner')request.actor=emid(999)
  if(change==='kind')request.kind='external'
  if(change==='listing')Object.assign(request,{listingId:emid(999)})
  if(change==='extra')Object.assign(request,{sellAll:true})
  await expect(readEquipmentMarketOperationSnapshot(f.client,f.target,request)).rejects.toThrow()
})
it.each(['extra removal','close binding','pack pin','revision','retained slot'] as const)('rejects partial removal %s substitution',async change=>{
  const f=await equipmentMarketOperationFixture({equipped:true}),s=structuredClone(f.snapshot),e=s.removal!.equipment!
  if(change==='extra removal')e.plan.removals.push({kind:'selection',selectionIndex:'1'})
  if(change==='close binding')e.closeBinding=true
  if(change==='pack pin')e.plan.packs.push({runtimeCallablePackageId:emid(999),paymentCoinType:s.target.paymentCoinType,releaseId:emid(998),bindingIndex:'0'})
  if(change==='revision')e.finalRevision='9'
  if(change==='retained slot'){e.retainedSelectionIndexes=['0'];e.finalSelectionCount='1'}
  expect(()=>validateEquipmentMarketSnapshot(s)).toThrow()
})
it('browser operation reader uses the certified pin and captures input before async work',async()=>{
  const f=await equipmentMarketOperationFixture({equipped:true}),input={...f.request,config:{target:structuredClone(f.target)}}
  const pending=readBrowserEquipmentMarketOperation(input,{client:()=>f.client})
  input.itemId=emid(999);input.equipmentScope!.soulId=emid(998);input.config.target.equipmentMarket.callableDigest='bad'
  const result=await pending
  expect(result.asset.itemId).toBe(emid(84));expect(result.removal!.soulId).toBe(emid(12))
})
it('browser abort stops before any network request',async()=>{
  const f=nativeEquipmentMarketAuthorityFixture(),controller=new AbortController();controller.abort()
  const client=vi.fn(()=>f.client)
  await expect(readBrowserEquipmentMarketOperation({rootId:f.rootId,itemId:emid(84),kind:'base',actor:emid(11),
    config:{target:{...f.target,equipmentMarket:f.marketPin}},signal:controller.signal},{client})).rejects.toThrow()
  expect(client).not.toHaveBeenCalled()
})
it('post-sale held custody remains readable after author lifecycle changes without new admission',async()=>{
  const f=await equipmentMarketOperationFixture()
  f.set(f.rootId,EquipmentMakerBcs,root=>{root.lifecycle=3})
  for(const [id,row] of f.objects)if(row.objectType?.includes('::ItemRowV2>'))f.objects.delete(id)
  const result=await readEquipmentMarketCustodySnapshot(f.client,f.target,f.marketPin,{rootId:f.rootId,itemId:f.itemId,kind:'base'})
  expect(result).toMatchObject({addressOwner:f.owner,listingId:null,asset:{item:{holder:f.owner}}})
})
it('does not treat an arbitrary address-owner as certified escrow',async()=>{
  const f=await equipmentMarketOperationFixture()
  f.objects.get(f.itemId).owner={kind:1,address:emid(999)}
  await expect(readEquipmentMarketCustodySnapshot(f.client,f.target,f.marketPin,{rootId:f.rootId,itemId:f.itemId,kind:'base'})).rejects.toThrow()
})
it('fails the final joined readset when a lock drifts after the Soul read',async()=>{
  const f=await equipmentMarketOperationFixture({equipped:true}),get=f.client.ledgerService.getObject.bind(f.client.ledgerService)
  const batch=f.client.ledgerService.batchGetObjects.bind(f.client.ledgerService)
  let soulRead=false,changed=false
  f.client.ledgerService.getObject=(async(p:any)=>{
    if(p.objectId===emid(14))soulRead=true
    return get(p)
  }) as never
  f.client.ledgerService.batchGetObjects=(async(p:any)=>{
    if(soulRead&&!changed){changed=true;f.set(f.itemId,EquipmentBaseItemBcs,item=>{item.ownership_epoch='1'});f.objects.get(f.itemId).version=3n}
    return batch(p)
  }) as never
  await expect(readEquipmentMarketOperationSnapshot(f.client,f.target,f.request)).rejects.toThrow()
  expect(changed).toBe(true)
})
