import {marketListCheck as check,marketListId,marketListOperationKey,validateMarketListOperationRecord,
  terminalMarketListOperation} from './market-list-operation'
import {marketBatchListOperationKey,validateMarketBatchListOperationRecord,terminalMarketBatchListOperation,marketBatchReservedAssets} from './market-batch-list-operation'
import {equipmentMarketOperationKey,validateEquipmentMarketOperationRecord,terminalEquipmentMarketOperation,
  equipmentMarketReservedAssets} from './equipment-market-operation'
import type {NativeMarketListSnapshot} from './market-list-operation'

export function marketListReservedAssets(snapshot:NativeMarketListSnapshot):string[]{
  return [...new Set([snapshot.soulId,snapshot.stateId,...(snapshot.equipmentId?[snapshot.equipmentId]:[]),
    ...(snapshot.equipmentSale?.removals.flatMap(row=>row.kind==='selection'?[]:[row.itemId])??[])])]
}

/** Soul and equipment operations take this wallet lock before touching their durable scope.
 * No reservation pointer or second write is needed: the full packet is the lock
 * across reloads, and the browser lock serializes all prepare/save transitions. */
export function withListingWalletLock<T>(key:string,work:()=>Promise<T>):Promise<T>{
  const owner=key.split(':').at(-1)!
  check(marketListId(owner),'Invalid listing lock owner')
  return navigator.locks.request(`soulidity.market-sale-wallet:mainnet:${owner}`,{mode:'exclusive',ifAvailable:true},async wallet=>{
    check(wallet,'This wallet has a listing operation open in another tab')
    return navigator.locks.request(key,{mode:'exclusive',ifAvailable:true},async lock=>{
      check(lock,'This listing is open in another tab');return work()})
  })
}
/** Called under the wallet lock after validating a prepared packet but before
 * persisting or asking for a signature. Recovery of either scope remains allowed. */
export function assertListingSelectionAvailable(storage:Storage,ownKey:string,owner:string,selected:string[]){
  const wanted=new Set(selected)
  for(let index=0;index<storage.length;index++){
    const key=storage.key(index)
    if(!key||key===ownKey||key.includes(':retired:'))continue
    const single=key.startsWith('soulidity.market-list-operation:mainnet:')&&key.endsWith(`:${owner}`)
    const batch=key===marketBatchListOperationKey(owner)
    const equipment=key.startsWith('soulidity.equipment-market-operation:mainnet:')&&key.endsWith(`:${owner}`)
    if(!single&&!batch&&!equipment)continue
    const raw=storage.getItem(key);check(raw&&raw.length<=(batch?750000:250000),'Other listing recovery record is invalid')
    if(single){
      const record=validateMarketListOperationRecord(JSON.parse(raw))
      check(marketListOperationKey(record.snapshot.soulId,record.snapshot.owner)===key,'Other listing scope mismatch')
      check(terminalMarketListOperation(record)||!marketListReservedAssets(record.snapshot).some(asset=>wanted.has(asset)),
        'Recover the pending single-Soul listing before selling its assets separately')
    }else if(batch){
      const record=validateMarketBatchListOperationRecord(JSON.parse(raw))
      check(record.owner===owner,'Other batch owner mismatch')
      check(terminalMarketBatchListOperation(record)||!marketBatchReservedAssets(record).some(asset=>wanted.has(asset)),
        'Recover the pending batch before listing one of its Souls separately')
    }else{
      const record=validateEquipmentMarketOperationRecord(JSON.parse(raw))
      check(equipmentMarketOperationKey(record.snapshot.asset.itemId,record.snapshot.actor)===key,'Other equipment scope mismatch')
      check(terminalEquipmentMarketOperation(record)||!equipmentMarketReservedAssets(record.snapshot).some(asset=>wanted.has(asset)),
        'Recover the pending equipment operation before selling overlapping assets')
    }
  }
}
