import {validateSoulMarketBatchListSnapshot,buildSoulMarketBatchListTransaction} from './soul-market-batch-validation'
import {validateSelectedMarketSaleSnapshot,buildSelectedMarketSaleTransaction,validateSelectedMarketSaleSelection} from './selected-market-sale-snapshot'
import {validateSelectedMarketSaleOperationRecord,type SelectedMarketSaleOperationRecord} from './selected-market-sale-operation'
import {equipmentMarketReservedAssets} from './equipment-market-operation'
import {marketListCheck as check,marketListId,marketListUint64,marketListCanonical as canonical,
  validateMarketListSnapshot} from './market-list-operation'
import {validateListingTransactionBytes} from './listing-transaction-validation'
import {runListingLifecycle,type ListingLifecycleStore,type ListingLifecycleAdapter} from './listing-operation-lifecycle'
import {validateMarketCancelCheckpoint} from './market-cancel-checkpoint'
import {withListingWalletLock,assertListingSelectionAvailable,marketListReservedAssets} from './listing-operation-scope'
import {MAX_MARKET_BATCH_LIST_ROWS,type NativeMarketBatchListSnapshot,type BatchMarketListOperationRecord,
  type MarketBatchListSelection,type MarketBatchListRow,type SoulMarketBatchListRow} from './market-batch-list-types'
export type {BatchMarketListOperationRecord,NativeMarketBatchListSnapshot,MarketBatchListRow} from './market-batch-list-types'
export type MarketBatchListOperationStore=ListingLifecycleStore<BatchMarketListOperationRecord>
export type MarketBatchListOperationAdapter=ListingLifecycleAdapter<BatchMarketListOperationRecord>
const positive=(v:unknown)=>marketListUint64(v)&&BigInt(v as string)>0n
const exact=(v:unknown,keys:string[])=>check(v!==null&&typeof v==='object'&&!Array.isArray(v)
  &&Object.keys(v).sort().join(',')===keys.sort().join(','),'Invalid selected sale fields')
export const marketBatchListOperationKey=(owner:string)=>{
  check(marketListId(owner),'Invalid batch seller');return `soulidity.market-batch-list-operation:mainnet:${owner}`
}
export const terminalMarketBatchListOperation=(r:BatchMarketListOperationRecord)=>['SUCCEEDED','FAILED','CANCELLED','RETIRED'].includes(r.phase)

export function validateMarketBatchListSelection(value:unknown):MarketBatchListSelection[]{
  const rows=structuredClone(value) as MarketBatchListSelection[]
  check(Array.isArray(rows)&&rows.length>0&&rows.length<=MAX_MARKET_BATCH_LIST_ROWS,'Select between 1 and 20 assets')
  check(rows.every(row=>row!==null&&typeof row==='object'&&!Array.isArray(row)&&(!('assetType'in row)||row.assetType==='equipment')),'Invalid selected asset type')
  if(rows.some(row=>'assetType'in row)){
    validateSelectedMarketSaleSelection(rows.map(row=>'assetType'in row?row:{assetType:'soul',...row}));return rows
  }
  for(const row of rows){check(!('assetType'in row),'Invalid Soul selection');exact(row,['soulId','stateId','priceAtomic'])
    check(marketListId(row.soulId)&&marketListId(row.stateId)&&row.soulId!==row.stateId&&positive(row.priceAtomic),'Invalid selected Soul or price')}
  check(new Set(rows.flatMap(row=>'assetType'in row?[]:[row.soulId,row.stateId])).size===rows.length*2,'Duplicate or overlapping selected Soul identities')
  return rows
}

/** Existing persisted Soul-only packets remain exact-byte recovery inputs. New
 * prepared snapshots carry grouped proof, even for the Soul-only subset. */
export function validateMarketBatchListSnapshot(value:unknown):NativeMarketBatchListSnapshot{
  const v=value as NativeMarketBatchListSnapshot
  if(v?.equipment===undefined)return validateSoulMarketBatchListSnapshot(value)
  exact(v,['schema','owner','rows','equipment']);check(v.schema==='native-market-batch-list-v1','Invalid batch snapshot schema')
  const s=validateSelectedMarketSaleSnapshot({schema:'selected-market-sale-v1',owner:v.owner,rows:v.rows,equipment:v.equipment})
  return {schema:'native-market-batch-list-v1',owner:s.owner,rows:s.rows,equipment:s.equipment}
}
export function selectedBatchRecord(r:BatchMarketListOperationRecord):SelectedMarketSaleOperationRecord{
  check(r.equipment!==undefined,'Grouped batch proof missing')
  return {schema:1,kind:'batch-list',bytes:r.bytes,digest:r.digest,expirationEpoch:r.expirationEpoch,phase:r.phase,signature:r.signature,
    ...(r.syncStatus!==undefined?{syncStatus:r.syncStatus}:{}),...(r.retirement!==undefined?{retirement:r.retirement}:{}),
    snapshot:{schema:'selected-market-sale-v1',owner:r.owner,rows:r.rows,equipment:r.equipment}}
}
export function buildMarketBatchListTransaction(rows:MarketBatchListRow[],equipment?:NativeMarketBatchListSnapshot['equipment']){
  check(Array.isArray(rows)&&rows.length>0&&rows.length<=MAX_MARKET_BATCH_LIST_ROWS,'Select between 1 and 20 assets')
  if(equipment!==undefined)return buildSelectedMarketSaleTransaction({schema:'selected-market-sale-v1',owner:rows[0].assetType==='soul'?rows[0].snapshot.owner:rows[0].snapshot.actor,rows,equipment})
  check(rows.every(row=>row.assetType==='soul'),'Grouped equipment proof required')
  return buildSoulMarketBatchListTransaction(rows as SoulMarketBatchListRow[])
}
export function marketBatchReservedAssets(r:Pick<BatchMarketListOperationRecord,'rows'>):string[]{
  return [...new Set(r.rows.flatMap(row=>row.assetType==='soul'?marketListReservedAssets(row.snapshot):equipmentMarketReservedAssets(row.snapshot)))]
}
export function validateMarketBatchListOperationRecord(value:unknown):BatchMarketListOperationRecord{
  const r=structuredClone(value) as BatchMarketListOperationRecord
  check(r?.schema===1&&r.kind==='batch-list','Invalid batch listing journal')
  if(r?.equipment!==undefined){
    const v=validateSelectedMarketSaleOperationRecord(selectedBatchRecord(r))
    return {...r,rows:v.snapshot.rows,equipment:v.snapshot.equipment}
  }
  const snapshot=validateMarketBatchListSnapshot({schema:'native-market-batch-list-v1',owner:r?.owner,rows:r?.rows});r.rows=snapshot.rows
  check(r.schema===1&&r.kind==='batch-list'&&marketListUint64(r.expirationEpoch)
    &&['PREPARED','SIGNING','SIGNED','SUCCEEDED','FAILED','CANCELLED','RETIRED'].includes(r.phase)
    &&(r.signature===null||typeof r.signature==='string'&&r.signature.length>0&&r.signature.length<32768)
    &&(r.phase!=='SIGNED'||r.signature!==null)
    &&(r.phase==='SUCCEEDED'?['PENDING','COMPLETE','SUPERSEDED'].includes(r.syncStatus as string):r.syncStatus===undefined)
    &&(!['PREPARED','SIGNING','CANCELLED'].includes(r.phase)||r.signature===null),'Invalid batch listing journal')
  check(r.phase!=='RETIRED'||r.retirement,'Retired batch evidence missing')
  if(r.retirement!==undefined){
    check(['RETIRED','SUCCEEDED','FAILED'].includes(r.phase)&&['SIGNING','SIGNED'].includes(r.retirement?.priorPhase)
      &&(r.retirement.priorPhase==='SIGNED'?r.signature!==null:r.signature===null),'Invalid batch retirement')
    r.retirement.checkpoint=validateMarketCancelCheckpoint(r.retirement.checkpoint,r.expirationEpoch)
  }
  const owned=new Set<string>(),mutable=new Set<string>(),forbidden=new Set<string>()
  for(const row of r.rows){
    check(row.assetType==='soul','Grouped equipment proof required');const s=row.snapshot
    for(const id of [s.bindingId,s.kioskCapId])owned.add(id)
    for(const id of [s.stateId,s.kioskId,s.release.kioskRegistryId])mutable.add(id)
    for(const id of [s.soulId,s.release.soulTransferPolicyId,s.release.protocolConfigId])forbidden.add(id)
    const e=s.equipmentSale
    if(e){mutable.add(e.scope.equipmentId);forbidden.add(e.definitionRegistryId);forbidden.add(e.baseRegistryId)
      for(const row of e.removals)if(row.kind!=='selection')owned.add(row.itemId)
      for(const pack of e.packs)forbidden.add(pack.releaseId)}
  }
  validateListingTransactionBytes(r,{owner:r.owner,expected:buildMarketBatchListTransaction(r.rows),owned,mutable,forbidden})
  return r
}

const archived=(value:unknown,key:string)=>{
  const r=validateMarketBatchListOperationRecord(value)
  check(r.phase==='RETIRED'&&marketBatchListOperationKey(r.owner)===key,'Batch archive scope/state mismatch');return r
}
export function browserMarketBatchListOperationStore():MarketBatchListOperationStore{
  check(typeof window!=='undefined'&&navigator.locks?.request,'Persistent batch recovery requires browser storage and Web Locks')
  const storage=window.localStorage,maxSize=750000
  return {
    exclusive:withListingWalletLock,
    assertAvailable:(key,record)=>assertListingSelectionAvailable(storage,key,record.owner,marketBatchReservedAssets(record)),
    read:key=>{const raw=storage.getItem(key);if(raw===null)return null;check(raw.length<=maxSize,'Batch journal exceeds its size limit');return validateMarketBatchListOperationRecord(JSON.parse(raw))},
    write:(key,value)=>{const r=validateMarketBatchListOperationRecord(value);check(marketBatchListOperationKey(r.owner)===key,'Batch journal owner mismatch')
      const encoded=JSON.stringify(r);check(encoded.length<=maxSize,'Batch journal exceeds its size limit');storage.setItem(key,encoded)
      check(storage.getItem(key)===encoded,'Batch recovery could not be persisted')},
    archive:(key,value)=>{const r=archived(value,key),name=`${key}:retired:${r.digest}`,encoded=canonical(r),existing=storage.getItem(name)
      check(encoded.length<=maxSize,'Batch archive exceeds its size limit')
      if(existing!==null)check(existing===encoded,'Batch archive is immutable');else storage.setItem(name,encoded)
      check(storage.getItem(name)===encoded,'Batch archive could not be persisted')},
    history:key=>{const result:BatchMarketListOperationRecord[]=[]
      for(let i=0;i<storage.length;i++){const name=storage.key(i);if(!name?.startsWith(`${key}:retired:`))continue
        const raw=storage.getItem(name);check(raw&&raw.length<=maxSize,'Invalid batch archive size');const r=archived(JSON.parse(raw),key)
        check(name===`${key}:retired:${r.digest}`,'Batch archive digest mismatch');result.push(r)}
      return result.sort((a,b)=>a.digest.localeCompare(b.digest))},
  }
}
export function runMarketBatchListOperation(params:{owner:string;start?:boolean;store:MarketBatchListOperationStore;adapter:MarketBatchListOperationAdapter;
  queryOnly?:boolean;cancelUnsigned?:boolean;retireExpired?:boolean;onRecord?:(record:BatchMarketListOperationRecord)=>void}){
  const owner=params.owner
  return runListingLifecycle({...params,key:marketBatchListOperationKey(owner),validate:validateMarketBatchListOperationRecord,
    assertScope:r=>check(r.owner===owner,'Batch listing owner mismatch')})
}
export async function queryMarketBatchListHistory(params:{owner:string;digest:string;store:MarketBatchListOperationStore;adapter:MarketBatchListOperationAdapter}){
  const {owner,digest,store,adapter}=params,key=marketBatchListOperationKey(owner)
  return store.exclusive(key,async()=>{
    const rows=store.history(key).map(row=>archived(row,key)).filter(row=>row.digest===digest)
    check(rows.length===1,'Exact batch archive required');const status=await adapter.query(rows[0])
    check(['MISSING','PENDING','SUCCEEDED','FAILED'].includes(status),'Invalid batch query result');return status
  })
}
