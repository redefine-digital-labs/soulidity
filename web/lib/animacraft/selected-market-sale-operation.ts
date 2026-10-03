import {Transaction} from '@mysten/sui/transactions'
import {fromBase64} from '@mysten/sui/utils'
import {marketListCheck as check,marketListUint64 as uint,marketListId as id} from './market-list-operation'
import {validateSelectedMarketSaleSnapshot,buildSelectedMarketSaleTransaction,type SelectedMarketSaleSnapshot} from './selected-market-sale-snapshot'
import {equipmentMarketInputRoles} from './equipment-market-operation'
import {validateListingTransactionBytes} from './listing-transaction-validation'
import {validateMarketCancelCheckpoint} from './market-cancel-checkpoint'
import type {ListingLifecycleRecord} from './listing-operation-lifecycle'

/** Selected-sale packet shape for the existing batch lifecycle cutover. No
 * separate storage prefix or parallel mutation engine is introduced here. */
export interface SelectedMarketSaleOperationRecord extends ListingLifecycleRecord {
  schema:1;kind:'batch-list';snapshot:SelectedMarketSaleSnapshot
}
export function selectedMarketSaleInputRoles(snapshot:SelectedMarketSaleSnapshot){
  const owned=new Set<string>(),mutable=new Set<string>(),forbidden=new Set<string>()
  for(const row of snapshot.rows){
    const s=row.snapshot
    if(row.assetType==='soul'){
      const soul=row.snapshot
      for(const value of [soul.bindingId,soul.kioskCapId])owned.add(value)
      for(const value of [soul.stateId,soul.kioskId,soul.release.kioskRegistryId])mutable.add(value)
      forbidden.add(soul.soulId)
    }else{
      const roles=equipmentMarketInputRoles({action:'list',snapshot:row.snapshot,paymentCoins:[]})
      for(const value of roles.owned)owned.add(value)
      for(const value of roles.mutable)mutable.add(value)
      forbidden.add(row.snapshot.asset.itemId)
    }
    const reserve=(value:unknown):void=>{if(id(value))forbidden.add(value as string)
      else if(value&&typeof value==='object')Object.values(value).forEach(reserve)}
    reserve(s.release)
    if(row.assetType==='equipment'){reserve(row.snapshot.target);reserve(row.snapshot.asset)}
  }
  for(const group of snapshot.equipment){
    if(!group.equipment)continue
    const {plan}=group.equipment;mutable.add(plan.scope.equipmentId)
    for(const row of plan.removals)if(row.kind!=='selection')owned.add(row.itemId)
    for(const value of [group.soulId,group.stateId,plan.scope.equipmentId,plan.definitionRegistryId,plan.baseRegistryId,
      ...Object.values(plan.scope.target),...plan.packs.flatMap(row=>[row.runtimeCallablePackageId,row.releaseId])])forbidden.add(value)
  }
  check([...owned].every(value=>!mutable.has(value)),'Mixed sale object ownership roles overlap')
  return {owned,mutable,forbidden}
}
export function validateSelectedMarketSaleOperationRecord(input:unknown):SelectedMarketSaleOperationRecord{
  const r=structuredClone(input) as SelectedMarketSaleOperationRecord
  check(r?.schema===1&&r.kind==='batch-list','Invalid selected sale record')
  r.snapshot=validateSelectedMarketSaleSnapshot(r.snapshot)
  check(uint(r.expirationEpoch)&&['PREPARED','SIGNING','SIGNED','SUCCEEDED','FAILED','CANCELLED','RETIRED'].includes(r.phase)
    &&(r.signature===null||typeof r.signature==='string'&&r.signature.length>0&&r.signature.length<32768)
    &&(r.phase!=='SIGNED'||r.signature!==null)
    &&(r.phase==='SUCCEEDED'?['PENDING','COMPLETE','SUPERSEDED'].includes(r.syncStatus as string):r.syncStatus===undefined)
    &&(!['PREPARED','SIGNING','CANCELLED'].includes(r.phase)||r.signature===null),'Invalid selected sale journal phase')
  check(r.phase!=='RETIRED'||r.retirement,'Retired selected sale checkpoint missing')
  if(r.retirement!==undefined){
    check(['RETIRED','SUCCEEDED','FAILED'].includes(r.phase)&&['SIGNING','SIGNED'].includes(r.retirement.priorPhase)
      &&(r.retirement.priorPhase==='SIGNED'?r.signature!==null:r.signature===null),'Invalid selected sale retirement')
    r.retirement.checkpoint=validateMarketCancelCheckpoint(r.retirement.checkpoint,r.expirationEpoch)
  }
  validateListingTransactionBytes(r,{owner:r.snapshot.owner,expected:buildSelectedMarketSaleTransaction(r.snapshot),...selectedMarketSaleInputRoles(r.snapshot)})
  const inputs=Transaction.from(fromBase64(r.bytes)).getData().inputs
  for(const row of r.snapshot.rows)if(row.assetType==='equipment'){
    const expected=row.snapshot.reference,actual=inputs.find(value=>value.Object?.ImmOrOwnedObject?.objectId===expected.objectId)?.Object?.ImmOrOwnedObject
    check(actual?.version===expected.version&&actual.digest===expected.digest,'Selected instance exact reference changed')
  }
  return r
}
