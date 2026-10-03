import {expect,it} from 'vitest'
import {equipmentMarketOperationFixture,emid} from './fixtures/equipment-market-operation'
import {marketListFixture} from './fixtures/market-list-operation'
import {readSelectedMarketSaleSnapshot,validateSelectedMarketSaleSnapshot,validateSelectedMarketSaleSelection,
  buildSelectedMarketSaleTransaction,type SelectedMarketSaleSelection,type SelectedMarketSaleSnapshot} from '../../web/lib/animacraft/selected-market-sale-snapshot'
import {readSelectedSaleEquipment} from '../../web/lib/animacraft/native-selected-equipment-sale'
import type {NativeMarketBuyTarget} from '../../web/lib/animacraft/native-market-buy-snapshot'
import {EquipmentExternalItemBcs} from '../../web/lib/animacraft/native-equipment'
async function fixture(){
  const f=await equipmentMarketOperationFixture({equipped:true}),equipmentScope={soulId:emid(12),stateId:emid(14)}
  const selection:SelectedMarketSaleSelection[]=[{assetType:'equipment',rootId:f.rootId,itemId:f.itemId,kind:'base',priceAtomic:'10001',equipmentScope},
    {assetType:'equipment',rootId:f.rootId,itemId:emid(102),kind:'external',priceAtomic:'20001',equipmentScope}]
  const read=(rows=selection)=>readSelectedMarketSaleSnapshot(f.client,f.target,{} as NativeMarketBuyTarget,{owner:f.owner,selection:rows})
  return {...f,selection,read}
}
it('raw-verifies two selected instances in one shared group and preserves the unselected Soul binding',async()=>{
  const f=await fixture(),s=await f.read();expect(s.rows).toHaveLength(2);expect(s.equipment).toHaveLength(1)
  expect(s.equipment[0]).toMatchObject({sellSoul:false,selectedItems:[{itemId:f.itemId},{itemId:emid(102)}],
    equipment:{closeBinding:false,finalRevision:'3',finalSelectionCount:'0',retainedSelectionIndexes:[]}})
  const names=buildSelectedMarketSaleTransaction(s).getData().commands.flatMap(c=>c.MoveCall?[c.MoveCall.function]:[])
  expect(names.filter(name=>name==='begin_update_v8')).toHaveLength(1);expect(names).not.toContain('close_empty_equipment_v8')
  expect(names.slice(-2)).toEqual(['list_base_equipment_v8','list_external_equipment_v8'])
})
it('retains the unchecked instance when only one equipped item is selected',async()=>{
  const f=await fixture(),s=await f.read(f.selection.slice(0,1))
  expect(s.equipment[0].equipment).toMatchObject({finalSelectionCount:'1',retainedSelectionIndexes:['1']})
  expect(buildSelectedMarketSaleTransaction(s).getData().commands.filter(c=>c.MoveCall?.function==='list_external_equipment_v8')).toHaveLength(0)
})
it('joins a selected Soul and its selected equipment without duplicate removal',async()=>{
  const f=await fixture(),s=await f.read(),soul=(await marketListFixture()).snapshot
  Object.assign(soul,{owner:f.owner,soulId:emid(12),stateId:emid(14),equipmentId:emid(80),ownershipEpoch:s.rows[0].snapshot.ownershipEpoch})
  Object.assign(soul.release,{soulidityOriginalPackageId:f.target.soulidityOriginalPackageId,soulidityCallablePackageId:f.target.soulidityCallablePackageId,
    soulidityCallableDigest:f.target.soulidityCallableDigest,protocolConfigId:f.target.protocolConfigId,
    marketConfigV2Id:emid(700),kioskRegistryId:emid(701),soulTransferPolicyId:emid(702),kioskPackageId:emid(703)})
  const grouped=await readSelectedSaleEquipment(f.client,f.target,f.owner,[{soulId:soul.soulId,stateId:soul.stateId,sellSoul:true,
    items:[{kind:'base',itemId:f.itemId},{kind:'external',itemId:emid(102)}]}])
  soul.equipmentSale={...grouped.preparations[0].equipment!.plan,runtimeCallableDigest:f.target.runtime!.callableDigest,writesEnabled:true}
  const mixed:SelectedMarketSaleSnapshot={...s,rows:[{assetType:'soul',snapshot:soul,priceAtomic:'30001'},...s.rows],equipment:grouped.preparations}
  const validated=validateSelectedMarketSaleSnapshot(mixed),names=buildSelectedMarketSaleTransaction(validated).getData().commands.flatMap(c=>c.MoveCall?[c.MoveCall.function]:[])
  expect(names.filter(name=>name==='begin_update_v8')).toHaveLength(1);expect(names.filter(name=>name==='close_empty_equipment_v8')).toHaveLength(1)
  expect(names.filter(name=>name.startsWith('list_'))).toEqual(['list_animacraft_v8_soul_fixed_price','list_base_equipment_v8','list_external_equipment_v8'])
})
it.each(['extra removal','wrong group','wrong source','wrong retained','wrong final revision','dropped row','dropped group','duplicate row','wrong owner'])(
  'rejects joined snapshot substitution: %s',async kind=>{
    const f=await fixture(),s=await f.read(),e=s.equipment[0].equipment!
    if(kind==='extra removal')e.plan.removals.push({kind:'selection',selectionIndex:'4'})
    if(kind==='wrong group')s.equipment[0].stateId=emid(999)
    if(kind==='wrong source')e.plan.scope.expectedRevision='2'
    if(kind==='wrong retained'){e.retainedSelectionIndexes=['0'];e.finalSelectionCount='1'}
    if(kind==='wrong final revision')e.finalRevision='4'
    if(kind==='dropped row')s.rows.pop()
    if(kind==='dropped group')s.equipment=[]
    if(kind==='duplicate row')s.rows.push(s.rows[0])
    if(kind==='wrong owner')s.owner=emid(999)
    expect(()=>validateSelectedMarketSaleSnapshot(s)).toThrow()
  })
it('rejects a selected lock that moved before the common readset finalized',async()=>{
  const f=await fixture();f.set(emid(102),EquipmentExternalItemBcs,item=>{item.equip_lock=null})
  await expect(f.read()).rejects.toThrow('lock/owner mismatch')
})
it.each(['empty','duplicate','invalid price','extra field'])('rejects selection %s before reading',async kind=>{
  const f=await fixture(),selection:any[]=structuredClone(f.selection)
  if(kind==='empty')selection.length=0
  if(kind==='duplicate')selection.push(selection[0])
  if(kind==='invalid price')selection[0].priceAtomic='39'
  if(kind==='extra field')selection[0].includeInventory=true
  expect(()=>validateSelectedMarketSaleSelection(selection)).toThrow()
})
