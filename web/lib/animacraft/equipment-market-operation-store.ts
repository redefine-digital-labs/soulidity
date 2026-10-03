import {marketListCheck as check,marketListCanonical as canonical,marketListDigest} from './market-list-operation'
import {equipmentMarketOperationKey,validateEquipmentMarketOperationRecord,equipmentMarketReservedAssets,
  type EquipmentMarketOperationRecord} from './equipment-market-operation'
import {runListingLifecycle,type ListingLifecycleStore,type ListingLifecycleAdapter,type ListingQueryResult} from './listing-operation-lifecycle'
import {withListingWalletLock,assertListingSelectionAvailable} from './listing-operation-scope'

export type EquipmentMarketOperationStore=ListingLifecycleStore<EquipmentMarketOperationRecord>
export type EquipmentMarketOperationAdapter=ListingLifecycleAdapter<EquipmentMarketOperationRecord>
const maxSize=250000
/** Discover only this wallet's existing journals, never inventory or new intent.
 * A malformed matching entry is reported rather than silently losing recovery. */
export function readBrowserEquipmentMarketJournals(actor:string):EquipmentMarketOperationRecord[]{
  equipmentMarketOperationKey(actor,actor)
  const store=browserEquipmentMarketOperationStore(),storage=window.localStorage
  const prefix='soulidity.equipment-market-operation:mainnet:',suffix=`:${actor}`
  const records:EquipmentMarketOperationRecord[]=[]
  for(let i=0;i<storage.length;i++){
    const key=storage.key(i)
    if(!key?.startsWith(prefix)||!key.endsWith(suffix))continue
    const value=store.read(key);if(value)records.push(value)
  }
  return records.sort((a,b)=>a.snapshot.asset.itemId.localeCompare(b.snapshot.asset.itemId))
}
function scoped(value:unknown,key:string){
  const record=validateEquipmentMarketOperationRecord(value)
  check(equipmentMarketOperationKey(record.snapshot.asset.itemId,record.snapshot.actor)===key,'Equipment journal scope mismatch')
  return record
}
function archived(value:unknown,key:string){
  const record=scoped(value,key)
  check(record.phase==='RETIRED','Equipment archive state mismatch');return record
}
/** Durable full packets, verified on every read and write. No expiry deletion or
 * in-memory fallback: a failed storage commit prevents the next wallet action. */
export function browserEquipmentMarketOperationStore():EquipmentMarketOperationStore{
  check(typeof window!=='undefined'&&navigator.locks?.request,'Persistent equipment recovery requires browser storage and Web Locks')
  const storage=window.localStorage
  return {
    exclusive:withListingWalletLock,
    assertAvailable:(key,record)=>assertListingSelectionAvailable(storage,key,record.snapshot.actor,equipmentMarketReservedAssets(record.snapshot)),
    read:key=>{
      const raw=storage.getItem(key);if(raw===null)return null
      check(raw.length<=maxSize,'Equipment journal exceeds its size limit');return scoped(JSON.parse(raw),key)
    },
    write:(key,value)=>{
      const encoded=JSON.stringify(scoped(value,key))
      check(encoded.length<=maxSize,'Equipment journal exceeds its size limit');storage.setItem(key,encoded)
      check(storage.getItem(key)===encoded,'Equipment recovery could not be persisted')
    },
    archive:(key,value)=>{
      const record=archived(value,key),name=`${key}:retired:${record.digest}`,encoded=canonical(record)
      check(encoded.length<=maxSize,'Equipment archive exceeds its size limit')
      const existing=storage.getItem(name)
      if(existing!==null)check(existing===encoded,'Equipment archive is immutable');else storage.setItem(name,encoded)
      check(storage.getItem(name)===encoded,'Equipment archive could not be persisted')
    },
    history:key=>{
      const prefix=`${key}:retired:`,records:EquipmentMarketOperationRecord[]=[]
      for(let i=0;i<storage.length;i++){
        const name=storage.key(i);if(!name?.startsWith(prefix))continue
        const raw=storage.getItem(name);check(raw&&raw.length<=maxSize,'Invalid equipment archive size')
        const record=archived(JSON.parse(raw),key)
        check(name===`${prefix}${record.digest}`,'Equipment archive digest mismatch');records.push(record)
      }
      return records.sort((a,b)=>a.digest.localeCompare(b.digest))
    },
  }
}
/** All actions use one item/actor key, so an unknown purchase or cancellation
 * cannot be replaced by a different intent after navigation or a reload. */
export function runEquipmentMarketOperation(params:{itemId:string;actor:string;start?:boolean;
  store:EquipmentMarketOperationStore;adapter:EquipmentMarketOperationAdapter;queryOnly?:boolean;
  cancelUnsigned?:boolean;retireExpired?:boolean;onRecord?:(record:EquipmentMarketOperationRecord)=>void}){
  const {itemId,actor}=params,key=equipmentMarketOperationKey(itemId,actor)
  return runListingLifecycle({...params,key,validate:validateEquipmentMarketOperationRecord,
    assertScope:record=>{scoped(record,key)}})
}
/** History only observes ledger status; it cannot sign, synchronize custody or
 * overwrite the active operation or immutable retirement checkpoint. */
export async function queryEquipmentMarketHistory(params:{itemId:string;actor:string;digest:string;
  store:EquipmentMarketOperationStore;adapter:EquipmentMarketOperationAdapter}):Promise<ListingQueryResult>{
  const {itemId,actor,digest,store,adapter}=params,key=equipmentMarketOperationKey(itemId,actor)
  check(marketListDigest(digest),'Invalid equipment history digest')
  return store.exclusive(key,async()=>{
    const records=store.history(key).map(value=>archived(value,key)).filter(record=>record.digest===digest)
    check(records.length===1,'Exact equipment history record required')
    const status=await adapter.query(structuredClone(records[0]))
    check(['MISSING','PENDING','SUCCEEDED','FAILED'].includes(status),'Invalid equipment query result');return status
  })
}
