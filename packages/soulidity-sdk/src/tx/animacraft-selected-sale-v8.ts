import {Transaction} from '@mysten/sui/transactions'
import {appendListAnimacraftV8Soul,type AnimacraftV8SoulListingScope} from './animacraft-market-v8'
import {appendListAnimacraftEquipmentV8,type AnimacraftEquipmentMarketV8Asset,type AnimacraftEquipmentMarketV8Target} from './animacraft-equipment-market-v8'
import {appendAnimacraftEquipmentV8RemovalPlan,type AnimacraftEquipmentV8RemovalPlan} from './animacraft-equipment-removal-v8'
import {appendCloseEmptyAnimacraftEquipmentV8} from './animacraft-equipment-v8'

export type SelectedAnimacraftSaleV8Row=
  |{assetType:'soul';listing:AnimacraftV8SoulListingScope&{priceAtomic:bigint};equipmentId:string|null}
  |{assetType:'equipment';listing:{target:AnimacraftEquipmentMarketV8Target;asset:AnimacraftEquipmentMarketV8Asset;priceAtomic:bigint};equipmentId:string|null}
export interface SelectedAnimacraftSaleV8Removal {plan:AnimacraftEquipmentV8RemovalPlan;closeBinding:boolean}
function check(value:unknown,message:string):asserts value {if(!value)throw new Error(`Selected sale: ${message}`)}
function id(value:unknown):asserts value is string {
  check(typeof value==='string'&&/^0x[0-9a-f]{64}$/.test(value)&&!/^0x0+$/.test(value),'canonical nonzero ID required')
}

/** One explicit mixed sale and one certified removal plan per affected Soul.
 * Each group's removal precedes its first selected listing; no builder can add
 * an unselected listing. This retains existing Soul-only command ordering.
 * This proves command composition only. Callers still certify ownership, locks,
 * release pins, exact references, fees and final readback from chain evidence. */
export function buildSelectedAnimacraftSaleV8Tx(input:{rows:readonly SelectedAnimacraftSaleV8Row[];
  equipment:readonly SelectedAnimacraftSaleV8Removal[]}):Transaction{
  const value=structuredClone(input),{rows,equipment}=value
  check(Array.isArray(rows)&&rows.length>0&&rows.length<=20&&Array.isArray(equipment)&&equipment.length<=20,'select 1–20 explicit assets')
  const selected=new Set<string>(),states=new Map<string,Extract<SelectedAnimacraftSaleV8Row,{assetType:'soul'}>>()
  const instances=new Map<string,Extract<SelectedAnimacraftSaleV8Row,{assetType:'equipment'}>>()
  for(const row of rows){
    check(row&&['soul','equipment'].includes(row.assetType),'unsupported asset kind')
    if(row.equipmentId!==null)id(row.equipmentId)
    const objectId=row.assetType==='soul'?row.listing.soulStateId:row.listing.asset.itemId
    id(objectId);check(!selected.has(objectId),'duplicate selected asset');selected.add(objectId)
    if(row.assetType==='soul')states.set(objectId,row);else instances.set(objectId,row)
  }
  const groups=new Map<string,SelectedAnimacraftSaleV8Removal>(),groupStates=new Set<string>(),removed=new Map<string,string>()
  let nativePackage:string|undefined,runtimePackage:string|undefined,protocol:string|undefined
  for(const group of equipment){
    check(group&&typeof group.closeBinding==='boolean'&&group.plan,'invalid removal group')
    const {scope}=group.plan;id(scope.equipmentId);id(scope.soulStateId)
    check(!groups.has(scope.equipmentId)&&!groupStates.has(scope.soulStateId),'equipment must bind a unique selected Soul')
    check(!selected.has(scope.equipmentId),'equipment aliases selected asset')
    check(!instances.has(scope.soulStateId),'Soul state aliases selected instance')
    check(nativePackage===undefined||nativePackage===scope.target.soulidityCallablePackageId,'mixed native equipment release')
    check(runtimePackage===undefined||runtimePackage===scope.target.runtimeOriginalPackageId,'mixed Runtime release')
    check(protocol===undefined||protocol===scope.target.protocolConfigId,'mixed protocol')
    nativePackage=scope.target.soulidityCallablePackageId;runtimePackage=scope.target.runtimeOriginalPackageId;protocol=scope.target.protocolConfigId
    groups.set(scope.equipmentId,group);groupStates.add(scope.soulStateId)
    const soul=states.get(scope.soulStateId)
    check(group.closeBinding===Boolean(soul),'close binding only for a selected Soul')
    if(soul)check(soul.equipmentId===scope.equipmentId&&soul.listing.target.soulidityCallablePackageId===nativePackage,'selected Soul removal scope mismatch')
    const choices=[...instances.values()].filter(row=>row.equipmentId===scope.equipmentId)
    check(soul||choices.length>0,'unselected removal group')
    const actual=new Map<string,string>()
    check(Array.isArray(group.plan.removals),'missing removals')
    for(const removal of group.plan.removals){
      if(removal.kind==='selection'){check(group.closeBinding,'unchecked usage selection removal');continue}
      id(removal.itemId);check(!removed.has(removal.itemId),'Duplicate equipped instance')
      removed.set(removal.itemId,scope.equipmentId);actual.set(removal.itemId,removal.kind)
      const choice=instances.get(removal.itemId)
      check(!choice||choice.equipmentId===scope.equipmentId,'selected instance lock scope mismatch')
      check(!states.has(removal.itemId),'instance aliases Soul state')
    }
    check(group.closeBinding||actual.size===choices.length,'partial removal includes an unchecked instance')
    for(const choice of choices){
      const {asset,target}=choice.listing
      check(actual.get(asset.itemId)===asset.kind,'selected instance missing from removal group')
      check(target.protocolConfigId===scope.target.protocolConfigId,'instance protocol differs from equipment')
      if(asset.kind==='base')check(asset.definitionRegistryId===group.plan.definitionRegistryId&&asset.baseRegistryId===group.plan.baseRegistryId,
        'Base instance registry differs from equipment')
    }
  }
  for(const row of rows){
    if(row.equipmentId!==null){
      const group=groups.get(row.equipmentId);check(group,'selected asset removal group missing')
      if(row.assetType==='soul')check(group.plan.scope.soulStateId===row.listing.soulStateId&&group.closeBinding,'Soul equipment scope mismatch')
    }else if(row.assetType==='equipment')check(!removed.has(row.listing.asset.itemId),'unlocked instance also has a removal')
    if(row.assetType==='soul'&&nativePackage)check(row.listing.target.soulidityCallablePackageId===nativePackage,'mixed Soul release')
  }
  // Per-command builders check their own inputs. Cross-row aliases must also be
  // rejected before an asset can be mistaken for another listing's authority.
  const infrastructure=new Set<string>(),bindings=new Set<string>(),caps=new Map<string,string>()
  let soulRelease:string|undefined,marketRelease:string|undefined
  for(const row of rows){
    const target=row.listing.target
    const targetIds=row.assetType==='soul'
      ?['soulidityCallablePackageId','marketConfigV2Id','kioskRegistryId','soulTransferPolicyId','kioskPackageId']
      :['marketCallablePackageId','registryId','treasuryId','rootId','protocolConfigId','catalogId','replacementId','packageConfigId']
    for(const key of targetIds){const value=(target as unknown as Record<string,unknown>)[key];id(value);infrastructure.add(value)}
    if(row.assetType==='soul'){
      const s=row.listing,pkg=s.target.soulidityCallablePackageId
      check(soulRelease===undefined||soulRelease===pkg,'mixed Soul listing release');soulRelease=pkg
      check(!bindings.has(s.provenanceBindingId),'duplicate Soul provenance binding');bindings.add(s.provenanceBindingId)
      check(!caps.has(s.currentKioskCapOnChainId)||caps.get(s.currentKioskCapOnChainId)===s.currentKioskId,'Kiosk cap scope mismatch')
      caps.set(s.currentKioskCapOnChainId,s.currentKioskId)
      for(const value of [s.provenanceBindingId,s.currentKioskId,s.currentKioskCapOnChainId]){id(value);infrastructure.add(value)}
    }else{
      const pkg=row.listing.target.marketCallablePackageId
      check(marketRelease===undefined||marketRelease===pkg,'mixed equipment Market release');marketRelease=pkg
      const a=row.listing.asset
      for(const value of a.kind==='base'?[a.packRegistryId,a.definitionRegistryId,a.baseRegistryId]:[a.productId]){id(value);infrastructure.add(value)}
    }
  }
  for(const {plan} of equipment){
    for(const value of [...Object.values(plan.scope.target),plan.definitionRegistryId,plan.baseRegistryId,
      ...plan.packs.flatMap((pack:AnimacraftEquipmentV8RemovalPlan['packs'][number])=>[pack.releaseId,pack.runtimeCallablePackageId])]){id(value);infrastructure.add(value)}
  }
  for(const value of [...selected,...groups.keys(),...groupStates,...removed.keys()])check(!infrastructure.has(value),'asset aliases shared infrastructure')
  for(const value of groups.keys())check(!groupStates.has(value)&&!removed.has(value),'equipment aliases state or instance')
  const tx=new Transaction()
  const applied=new Set<string>()
  for(const row of rows){
    if(row.equipmentId!==null&&!applied.has(row.equipmentId)){
      const group=groups.get(row.equipmentId)!,finalRevision=appendAnimacraftEquipmentV8RemovalPlan(tx,group.plan)
      if(group.closeBinding)appendCloseEmptyAnimacraftEquipmentV8(tx,{...group.plan.scope,expectedRevision:finalRevision})
      applied.add(row.equipmentId)
    }
    if(row.assetType==='soul')appendListAnimacraftV8Soul(tx,row.listing)
    else appendListAnimacraftEquipmentV8(tx,row.listing)
  }
  return tx
}
