import type {SuiGrpcClient} from '@mysten/sui/grpc'
import {buildSelectedAnimacraftSaleV8Tx,type SelectedAnimacraftSaleV8Row,type AnimacraftEquipmentV8RemovalPlan} from '@soulidity/sdk'
import {marketListCheck as check,marketListId as id,marketListUint64 as uint,marketListCanonical as canonical,validateMarketListSnapshot} from './market-list-operation'
import {validateEquipmentMarketSnapshot,type EquipmentMarketOperationSnapshot} from './equipment-market-operation'
import {readEquipmentMarketOperationSnapshot} from './equipment-market-operation-snapshot'
import {readNativeMarketListSnapshot} from './native-market-list-snapshot'
import {readSelectedSaleEquipment,type SelectedSaleEquipmentPreparation,type SelectedSaleEquipmentScope} from './native-selected-equipment-sale'
import {EquipmentReadSet} from './native-equipment'
import type {NativeMarketListSnapshot} from './market-list-types'
import type {NativeReceiveTarget} from './native-receive'
import type {NativeMarketBuyTarget} from './native-market-buy-snapshot'
import {validateSoulMarketBatchListSnapshot as validateMarketBatchListSnapshot} from './soul-market-batch-validation'

export type SelectedMarketSaleSelection=
  |{assetType:'soul';soulId:string;stateId:string;priceAtomic:string}
  |{assetType:'equipment';rootId:string;itemId:string;kind:'base'|'external';priceAtomic:string;equipmentScope?:{soulId:string;stateId:string}}
export type SelectedMarketSaleRow=
  |{assetType:'soul';snapshot:NativeMarketListSnapshot;priceAtomic:string}
  |{assetType:'equipment';snapshot:EquipmentMarketOperationSnapshot;priceAtomic:string}
export interface SelectedMarketSaleSnapshot {
  schema:'selected-market-sale-v1';owner:string;rows:SelectedMarketSaleRow[];equipment:SelectedSaleEquipmentPreparation[]
}
const exact=(value:unknown,keys:string[])=>check(value!==null&&typeof value==='object'&&!Array.isArray(value)
  &&Object.keys(value).sort().join(',')===[...keys].sort().join(','),'Invalid selected market sale fields')
const price=(value:unknown,min:bigint)=>uint(value)&&BigInt(value as string)>=min
const plan=(value:AnimacraftEquipmentV8RemovalPlan):AnimacraftEquipmentV8RemovalPlan=>({scope:value.scope,
  definitionRegistryId:value.definitionRegistryId,baseRegistryId:value.baseRegistryId,removals:value.removals,packs:value.packs})
const common=(value:AnimacraftEquipmentV8RemovalPlan)=>canonical({...plan(value),removals:undefined})

export function validateSelectedMarketSaleSelection(input:unknown):SelectedMarketSaleSelection[]{
  const rows=structuredClone(input) as SelectedMarketSaleSelection[]
  check(Array.isArray(rows)&&rows.length>0&&rows.length<=20,'Select 1–20 explicit assets')
  const ids=new Set<string>()
  for(const row of rows){
    check(row&&['soul','equipment'].includes(row.assetType),'Invalid selected asset type')
    if(row.assetType==='soul'){
      exact(row,['assetType','soulId','stateId','priceAtomic']);check(id(row.soulId)&&id(row.stateId)&&row.soulId!==row.stateId&&price(row.priceAtomic,1n),'Invalid selected Soul')
      for(const value of [row.soulId,row.stateId]){check(!ids.has(value),'Duplicate selected asset identity');ids.add(value)}
    }else{
      exact(row,['assetType','rootId','itemId','kind','priceAtomic',...(row.equipmentScope?['equipmentScope']:[])])
      check(id(row.rootId)&&id(row.itemId)&&row.rootId!==row.itemId&&['base','external'].includes(row.kind)&&price(row.priceAtomic,40n),'Invalid selected equipment')
      check(!ids.has(row.itemId),'Duplicate selected asset identity');ids.add(row.itemId)
      if(row.equipmentScope){exact(row.equipmentScope,['soulId','stateId']);check(id(row.equipmentScope.soulId)&&id(row.equipmentScope.stateId)
        &&row.equipmentScope.soulId!==row.equipmentScope.stateId,'Invalid selected equipment scope')}
    }
  }
  return rows
}
export function selectedMarketSaleSelection(value:SelectedMarketSaleSnapshot):SelectedMarketSaleSelection[]{
  return value.rows.map(row=>row.assetType==='soul'?{assetType:'soul',soulId:row.snapshot.soulId,stateId:row.snapshot.stateId,priceAtomic:row.priceAtomic}
    :{assetType:'equipment',rootId:row.snapshot.target.rootId,itemId:row.snapshot.asset.itemId,kind:row.snapshot.asset.kind,priceAtomic:row.priceAtomic,
      ...(row.snapshot.removal?{equipmentScope:{soulId:row.snapshot.removal.soulId,stateId:row.snapshot.removal.stateId}}:{})})
}
function scopes(rows:SelectedMarketSaleRow[]):SelectedSaleEquipmentScope[]{
  const groups=new Map<string,SelectedSaleEquipmentScope>()
  function group(soulId:string,stateId:string){
    const existing=groups.get(stateId)
    check(!existing||existing.soulId===soulId,'Selected Soul identity changed')
    if(existing)return existing
    const value={soulId,stateId,sellSoul:false,items:[] as SelectedSaleEquipmentScope['items']};groups.set(stateId,value);return value
  }
  for(const row of rows){
    if(row.assetType==='soul'&&row.snapshot.equipmentId!==null)group(row.snapshot.soulId,row.snapshot.stateId).sellSoul=true
    if(row.assetType==='equipment'&&row.snapshot.removal){const r=row.snapshot.removal
      group(r.soulId,r.stateId).items.push({kind:row.snapshot.asset.kind,itemId:row.snapshot.asset.itemId})}
  }
  return [...groups.values()]
}
export function buildSelectedMarketSaleTransaction(value:SelectedMarketSaleSnapshot){
  const rows:SelectedAnimacraftSaleV8Row[]=value.rows.map(row=>row.assetType==='soul'?{
    assetType:'soul',equipmentId:row.snapshot.equipmentId,listing:{target:row.snapshot.release,soulStateId:row.snapshot.stateId,
      provenanceBindingId:row.snapshot.bindingId,currentKioskId:row.snapshot.kioskId,currentKioskCapOnChainId:row.snapshot.kioskCapId,priceAtomic:BigInt(row.priceAtomic)}}
    :{assetType:'equipment',equipmentId:row.snapshot.lock?.equipmentId??null,
      listing:{target:row.snapshot.target,asset:row.snapshot.asset,priceAtomic:BigInt(row.priceAtomic)}})
  return buildSelectedAnimacraftSaleV8Tx({rows,equipment:value.equipment.flatMap(row=>row.equipment?[{
    plan:row.equipment.plan,closeBinding:row.equipment.closeBinding}]:[])})
}

/** Validate the joined per-asset proofs and shared group, without converting any
 * unchecked removal into a sale. Final commitments are re-proved on chain readback. */
export function validateSelectedMarketSaleSnapshot(input:unknown):SelectedMarketSaleSnapshot{
  const value=structuredClone(input) as SelectedMarketSaleSnapshot
  exact(value,['schema','owner','rows','equipment'])
  check(value.schema==='selected-market-sale-v1'&&id(value.owner)&&Array.isArray(value.rows)&&value.rows.length>0&&value.rows.length<=20
    &&Array.isArray(value.equipment),'Invalid selected sale snapshot')
  let native:string|undefined,runtime:string|undefined,equipmentRelease:string|undefined
  for(const row of value.rows){
    exact(row,['assetType','snapshot','priceAtomic'])
    check(row.assetType==='soul'||row.assetType==='equipment','Invalid selected sale row')
    if(row.assetType==='soul'){
      row.snapshot=validateMarketListSnapshot(row.snapshot);const s=row.snapshot
      check(s.owner===value.owner&&!s.listed&&s.listingId===null&&price(row.priceAtomic,1n),'Selected Soul is not held')
      const release=canonical([s.release.soulidityOriginalPackageId,s.release.soulidityCallablePackageId,s.release.soulidityCallableDigest,s.release.protocolConfigId])
      check(native===undefined||native===release,'Mixed native release');native=release
      if(s.equipmentSale){const r=canonical([s.equipmentSale.scope.target.runtimeOriginalPackageId,s.equipmentSale.runtimeCallableDigest])
        check(runtime===undefined||runtime===r,'Mixed equipment release');runtime=r}
    }else{
      row.snapshot=validateEquipmentMarketSnapshot(row.snapshot);const s=row.snapshot
      check(s.actor===value.owner&&s.seller===value.owner&&s.listing===null&&(!s.lock||s.removal)&&price(row.priceAtomic,40n),'Selected equipment is not held or lacks removal')
      const release=canonical([s.release.soulidityOriginalPackageId,s.release.soulidityCallablePackageId,s.release.soulidityCallableDigest,s.release.protocolConfigId])
      check(native===undefined||native===release,'Mixed native release');native=release
      const r=canonical([s.release.runtime!.originalPackageId,s.release.runtime!.callableDigest])
      check(runtime===undefined||runtime===r,'Mixed equipment release');runtime=r
      const e=canonical(s.release);check(equipmentRelease===undefined||equipmentRelease===e,'Mixed equipment Market release');equipmentRelease=e
    }
  }
  const souls=value.rows.filter((row):row is Extract<SelectedMarketSaleRow,{assetType:'soul'}>=>row.assetType==='soul')
  if(souls.length)validateMarketBatchListSnapshot({schema:'native-market-batch-list-v1',owner:value.owner,rows:souls})
  validateSelectedMarketSaleSelection(selectedMarketSaleSelection(value))
  const expected=scopes(value.rows)
  check(value.equipment.length===expected.length,'Missing or extra equipment group')
  for(const [index,group] of value.equipment.entries()){
    exact(group,['soulId','stateId','sellSoul','selectedItems','equipment'])
    const wanted=expected[index],e=group.equipment
    check(group.soulId===wanted.soulId&&group.stateId===wanted.stateId&&group.sellSoul===wanted.sellSoul&&e,'Equipment group scope mismatch')
    exact(e,['closeBinding','plan','finalRevision','finalSelectionCount','finalCommitment','retainedSelectionIndexes'])
    const soul=value.rows.find(row=>row.assetType==='soul'&&row.snapshot.stateId===group.stateId)
    const items=value.rows.filter((row):row is Extract<SelectedMarketSaleRow,{assetType:'equipment'}>=>row.assetType==='equipment'&&row.snapshot.removal?.stateId===group.stateId)
    const selected=items.map(row=>row.snapshot.removal!.selectedItems[0])
    check(canonical(group.selectedItems)===canonical(selected),'Grouped selected instances changed')
    const full=soul?.assetType==='soul'?soul.snapshot.equipmentSale:null
    const reference=full??items[0]?.snapshot.removal?.equipment?.plan
    check(reference&&common(e.plan)===common(reference),'Grouped removal source changed')
    for(const item of items)check(common(item.snapshot.removal!.equipment!.plan)===common(reference),'Instance removal source differs from group')
    const removals=full?full.removals:[...selected].sort((a,b)=>Number(a.selectionIndex)-Number(b.selectionIndex)).map(row=>({kind:row.kind,itemId:row.itemId}))
    exact(e.plan,['scope','definitionRegistryId','baseRegistryId','removals','packs'])
    check(canonical(e.plan.removals)===canonical(removals)&&e.closeBinding===group.sellSoul,'Grouped removal includes unchecked selections')
    check(uint(e.finalRevision)&&BigInt(e.finalRevision)===BigInt(e.plan.scope.expectedRevision)+BigInt(removals.length)
      &&/^[0-9a-f]{64}$/.test(e.finalCommitment),'Invalid grouped final state')
    const retained=full?[]:items[0].snapshot.removal!.equipment!.retainedSelectionIndexes.filter(slot=>items.every(row=>row.snapshot.removal!.equipment!.retainedSelectionIndexes.includes(slot)))
    check(canonical(e.retainedSelectionIndexes)===canonical(retained)&&e.finalSelectionCount===String(retained.length),'Grouped retained selections changed')
  }
  buildSelectedMarketSaleTransaction(value)
  return value
}

/** One mutable readset spans all selected Souls, exact instances and final group
 * plans. This does not enumerate inventory and never signs or broadcasts. */
export async function readSelectedMarketSaleSnapshot(client:SuiGrpcClient,target:NativeReceiveTarget,marketTarget:NativeMarketBuyTarget,
  input:{owner:string;selection:SelectedMarketSaleSelection[]},signal?:AbortSignal){
  const {owner,selection}=structuredClone(input),pin=structuredClone(target),config=structuredClone(marketTarget)
  check(id(owner),'Invalid selected seller');const selected=validateSelectedMarketSaleSelection(selection),reads=new EquipmentReadSet(client,true)
  const rows:SelectedMarketSaleRow[]=[]
  for(const row of selected){signal?.throwIfAborted()
    if(row.assetType==='soul')rows.push({assetType:'soul',priceAtomic:row.priceAtomic,snapshot:await readNativeMarketListSnapshot(client,pin,config,
      {soulId:row.soulId,stateId:row.stateId},signal,reads)})
    else rows.push({assetType:'equipment',priceAtomic:row.priceAtomic,snapshot:await readEquipmentMarketOperationSnapshot(client,pin,
      {actor:owner,rootId:row.rootId,itemId:row.itemId,kind:row.kind,...(row.equipmentScope?{equipmentScope:row.equipmentScope}:{})},signal,reads)})
  }
  const groups=scopes(rows),equipment=groups.length?(await readSelectedSaleEquipment(client,pin,owner,groups,reads)).preparations:[]
  await reads.verify();signal?.throwIfAborted()
  return validateSelectedMarketSaleSnapshot({schema:'selected-market-sale-v1',owner,rows,equipment})
}
