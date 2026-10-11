import {expect,it} from 'vitest'
import {bcs} from '@mysten/sui/bcs'
import {buildSelectedAnimacraftSaleV8Tx,type SelectedAnimacraftSaleV8Row,type SelectedAnimacraftSaleV8Removal} from '@soulidity/sdk'
const id=(n:number)=>`0x${n.toString(16).padStart(64,'0')}`
function fixture(sellSoul=true){
  const equipment:SelectedAnimacraftSaleV8Removal[]=[{closeBinding:sellSoul,plan:{scope:{target:{soulidityCallablePackageId:id(1),
    runtimeOriginalPackageId:id(8),protocolConfigId:id(9)},soulStateId:id(10),equipmentId:id(12),expectedRevision:'9007199254740993'},
    definitionRegistryId:id(90),baseRegistryId:id(91),removals:[{kind:'base',itemId:id(13)},{kind:'external',itemId:id(14)},
      ...(sellSoul?[{kind:'selection' as const,selectionIndex:'8'}]:[])],
    packs:[{runtimeCallablePackageId:id(8),paymentCoinType:'0x2::sui::SUI',releaseId:id(92),bindingIndex:'0'}]}}]
  const target={marketCallablePackageId:id(200),paymentCoinType:'0x2::sui::SUI',registryId:id(201),treasuryId:id(202),
    rootId:id(203),protocolConfigId:id(9),catalogId:id(204),replacementId:id(205),packageConfigId:id(206)}
  const base:SelectedAnimacraftSaleV8Row={assetType:'equipment',equipmentId:id(12),listing:{target,
    asset:{kind:'base',itemId:id(13),definitionRegistryId:id(90),baseRegistryId:id(91),packRegistryId:id(93)},priceAtomic:100n}}
  const external:SelectedAnimacraftSaleV8Row={assetType:'equipment',equipmentId:id(12),listing:{target,
    asset:{kind:'external',itemId:id(14),productId:id(94)},priceAtomic:200n}}
  const soul:SelectedAnimacraftSaleV8Row={assetType:'soul',equipmentId:id(12),listing:{target:{soulidityCallablePackageId:id(1),
    marketConfigV2Id:id(2),kioskRegistryId:id(3),soulTransferPolicyId:id(4),kioskPackageId:id(5)},soulStateId:id(10),
    provenanceBindingId:id(11),currentKioskId:id(6),currentKioskCapOnChainId:id(7),priceAtomic:300n}}
  return {rows:sellSoul?[soul,base,external]:[base,external],equipment,base,external,soul}
}
const calls=(f:ReturnType<typeof fixture>)=>buildSelectedAnimacraftSaleV8Tx(f).getData().commands.flatMap(c=>c.MoveCall?[c.MoveCall]:[])
it('sells a Soul and its explicitly selected instances with exactly one removal/close and distinct listings',()=>{
  const f=fixture(),c=calls(f),names=c.map(row=>row.function)
  expect(names).toEqual(['begin_update_v8','unequip_base_v8','unequip_external_v8','clear_selection_v8',
    'prove_equipment_pack_definitions_v8','finish_update_v8','close_empty_equipment_v8','ensure_personal_kiosk_registered_v2',
    'list_animacraft_v8_soul_fixed_price','finalize_soul_listing','list_base_equipment_v8','list_external_equipment_v8'])
  const data=buildSelectedAnimacraftSaleV8Tx(f).getData(),close=c.find(row=>row.function==='close_empty_equipment_v8')!
  expect(bcs.u64().fromBase64(data.inputs[(close.arguments[3] as {Input:number}).Input].Pure!.bytes)).toBe('9007199254740996')
})
it('sells two instances from one unselected Soul with one begin/finish and preserves its binding',()=>{
  const c=calls(fixture(false)),names=c.map(row=>row.function)
  expect(names.filter(v=>v==='begin_update_v8')).toHaveLength(1);expect(names.filter(v=>v==='finish_update_v8')).toHaveLength(1)
  expect(names).not.toContain('close_empty_equipment_v8');expect(names).not.toContain('list_animacraft_v8_soul_fixed_price')
  expect(names.slice(-2)).toEqual(['list_base_equipment_v8','list_external_equipment_v8'])
})
it('retains unselected instances with the seller when the Soul alone is selected',()=>{
  const f=fixture();f.rows=[f.soul]
  const names=calls(f).map(row=>row.function);expect(names).toContain('unequip_external_v8')
  expect(names.some(name=>name==='list_base_equipment_v8'||name==='list_external_equipment_v8')).toBe(false)
})
it('includes an unlocked selected instance without inventing removal or a Soul sale',()=>{
  const f=fixture(false);f.rows=[{...f.external,equipmentId:null}];f.equipment=[]
  expect(calls(f).map(row=>row.function)).toEqual(['list_external_equipment_v8'])
})
it('separates two Soul groups while executing each removal once before its ordered sales',()=>{
  const f=fixture(false),second=structuredClone(f.equipment[0]);second.plan.scope.soulStateId=id(110);second.plan.scope.equipmentId=id(112)
  second.plan.removals=[{kind:'external',itemId:id(114)}];f.equipment.push(second)
  f.rows.push({assetType:'equipment',equipmentId:id(112),listing:{...(f.external as Extract<SelectedAnimacraftSaleV8Row,{assetType:'equipment'}>).listing,
    asset:{kind:'external',itemId:id(114),productId:id(94)}}})
  const names=calls(f).map(row=>row.function)
  expect(names.filter(name=>name==='begin_update_v8')).toHaveLength(2)
  expect(names.filter(name=>name.startsWith('list_'))).toEqual(['list_base_equipment_v8','list_external_equipment_v8','list_external_equipment_v8'])
  expect(names.lastIndexOf('finish_update_v8')).toBeLessThan(names.lastIndexOf('list_external_equipment_v8'))
  expect(names).not.toContain('close_empty_equipment_v8')
})
it.each(['authority alias','state alias','equipment alias','mixed market'])('rejects cross-row %s',kind=>{
  const f=fixture(false),external=f.external as Extract<SelectedAnimacraftSaleV8Row,{assetType:'equipment'}>
  if(kind==='authority alias')external.listing.target={...external.listing.target,rootId:id(13)}
  if(kind==='state alias')f.equipment[0].plan.scope.soulStateId=id(13)
  if(kind==='equipment alias')external.listing.target={...external.listing.target,rootId:id(12)}
  if(kind==='mixed market')external.listing.target={...external.listing.target,marketCallablePackageId:id(999)}
  expect(()=>buildSelectedAnimacraftSaleV8Tx(f)).toThrow()
})
it.each(['duplicate asset','missing group','duplicate group','wrong state','wrong kind','unchecked removal','unchecked usage',
  'unselected close','missing close','wrong protocol','wrong registry','false unlocked','overflow','duplicate removal'])(
  'rejects %s without returning a partial transaction',kind=>{
    const f=fixture(false),group=f.equipment[0],base=f.base as Extract<SelectedAnimacraftSaleV8Row,{assetType:'equipment'}>
    if(kind==='duplicate asset')f.rows.push(f.base)
    if(kind==='missing group')f.equipment=[]
    if(kind==='duplicate group')f.equipment.push(structuredClone(group))
    if(kind==='wrong state'){f.rows.push(f.soul);group.closeBinding=true;group.plan.scope.soulStateId=id(999)}
    if(kind==='wrong kind')group.plan.removals[0]={kind:'external',itemId:id(13)}
    if(kind==='unchecked removal')f.rows=[f.base]
    if(kind==='unchecked usage')group.plan.removals.push({kind:'selection',selectionIndex:'8'})
    if(kind==='unselected close')group.closeBinding=true
    if(kind==='missing close')f.rows.push(f.soul)
    if(kind==='wrong protocol')base.listing.target={...base.listing.target,protocolConfigId:id(999)}
    if(kind==='wrong registry'&&base.listing.asset.kind==='base')base.listing.asset.baseRegistryId=id(999)
    if(kind==='false unlocked')base.equipmentId=null
    if(kind==='overflow')group.plan.scope.expectedRevision='18446744073709551615'
    if(kind==='duplicate removal')group.plan.removals.push({kind:'base',itemId:id(13)})
    expect(()=>buildSelectedAnimacraftSaleV8Tx(f)).toThrow()
  })
it('rejects an empty selection and batches larger than twenty',()=>{
  const f=fixture();expect(()=>buildSelectedAnimacraftSaleV8Tx({rows:[],equipment:[]})).toThrow()
  expect(()=>buildSelectedAnimacraftSaleV8Tx({...f,rows:Array(21).fill(f.soul)})).toThrow()
})
