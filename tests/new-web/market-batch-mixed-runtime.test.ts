import {afterEach,expect,it,vi} from 'vitest'
import {Transaction} from '@mysten/sui/transactions'
import {selectedMarketSaleEvidenceFixture} from './fixtures/selected-market-sale-evidence'
import {validateMarketBatchListOperationRecord,validateMarketBatchListSelection,selectedBatchRecord,
  browserMarketBatchListOperationStore,marketBatchListOperationKey,marketBatchReservedAssets,runMarketBatchListOperation} from '../../web/lib/animacraft/market-batch-list-operation'
import {createMarketBatchListOperationAdapter,batchListingSelection} from '../../web/lib/animacraft/market-batch-list-operation-adapter'
import {assertListingSelectionAvailable} from '../../web/lib/animacraft/listing-operation-scope'
import type {BatchMarketListOperationRecord,NativeMarketBatchListSnapshot} from '../../web/lib/animacraft/market-batch-list-types'
import type {MarketBatchListSelection} from '../../web/lib/animacraft/market-batch-list-types'
import {equipmentMarketOperationFixture} from './fixtures/equipment-market-operation'
import {equipmentMarketOperationKey,equipmentMarketReservedAssets} from '../../web/lib/animacraft/equipment-market-operation'

afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers()})
async function fixture(includeSoul=true){
  const f=await selectedMarketSaleEvidenceFixture(includeSoul),{snapshot,...packet}=f.record
  const record:BatchMarketListOperationRecord={...packet,owner:snapshot.owner,rows:snapshot.rows,equipment:snapshot.equipment}
  const observed:NativeMarketBatchListSnapshot={schema:'native-market-batch-list-v1',owner:snapshot.owner,rows:snapshot.rows,equipment:snapshot.equipment}
  const original=Transaction.from(record.bytes).getData()
  const client:any={...f.client,ledgerService:{...f.client.ledgerService,getEpoch:vi.fn(async()=>({response:{epoch:{epoch:8n}}}))},core:{resolveTransactionPlugin:()=>async(data:any,_options:any,next:()=>Promise<void>)=>{
    data.inputs=data.inputs.map((input:any)=>{
      if(!input.UnresolvedObject)return input
      const id=input.UnresolvedObject.objectId
      const resolved=original.inputs.find(i=>(i.Object?.ImmOrOwnedObject?.objectId??i.Object?.SharedObject?.objectId)===id)
      if(!resolved)throw new Error('Missing fixture input');return structuredClone(resolved)
    });data.gasData=structuredClone(original.gasData);await next()
  }}}
  const read=vi.fn(async(_selection:MarketBatchListSelection[],_signal:AbortSignal)=>structuredClone(observed)),sign=vi.fn(),sync=vi.fn(async()=>'COMPLETE' as const)
  const adapter=createMarketBatchListOperationAdapter({client,read,sign,sync,observed:structuredClone(observed),getAddress:()=>snapshot.owner})
  return {...f,record,observed,read,sign,sync,adapter}
}
function storageFixture(){
  const values=new Map<string,string>(),storage={get length(){return values.size},key:(i:number)=>[...values.keys()][i]??null,
    getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v)},removeItem:(k:string)=>{values.delete(k)},clear:()=>values.clear()}
  vi.stubGlobal('window',{localStorage:storage});vi.stubGlobal('navigator',{locks:{request:async(_key:string,_opts:any,work:(lock:object)=>Promise<unknown>)=>work({})}})
  return storage
}
it.each([true,false])('prepares and queries the same complete packet in the existing batch adapter (Soul=%s)',async includeSoul=>{
  const f=await fixture(includeSoul)
  expect(selectedBatchRecord(validateMarketBatchListOperationRecord(f.record))).toEqual(selectedBatchRecord(f.record))
  const prepared=await f.adapter.prepare()
  expect(prepared.bytes).toBe(f.record.bytes);expect(prepared.digest).toBe(f.record.digest)
  await f.adapter.preflight(prepared,true)
  expect(f.read.mock.calls[0][0]).toEqual(batchListingSelection(f.observed))
  expect(await f.adapter.query(prepared)).toBe('SUCCEEDED');expect(f.sign).not.toHaveBeenCalled()
})
it('persists mixed rows and their grouped proof under the original wallet journal key',async()=>{
  const f=await fixture(),storage=storageFixture(),store=browserMarketBatchListOperationStore(),key=marketBatchListOperationKey(f.record.owner)
  await store.exclusive(key,async()=>{store.assertAvailable!(key,f.record);store.write(key,f.record)})
  const restored=browserMarketBatchListOperationStore().read(key)!
  expect(restored).toEqual(f.record);expect(storage.length).toBe(1)
  expect(restored.bytes).toBe(f.record.bytes);expect(restored.equipment).toHaveLength(1)
  const reserved=marketBatchReservedAssets(restored)
  for(const row of restored.rows)expect(reserved).toContain(row.assetType==='soul'?row.snapshot.soulId:row.snapshot.asset.itemId)
  expect(()=>assertListingSelectionAvailable(storage,'other-scope',restored.owner,[reserved.at(-1)!])).toThrow('pending batch')
  store.write(key,{...restored,phase:'CANCELLED'})
  expect(()=>assertListingSelectionAvailable(storage,'other-scope',restored.owner,[reserved.at(-1)!])).not.toThrow()
})
it.each(['kind','schema','price','group','order','omit-group'])('rejects mixed saved-record substitution: %s',async reason=>{
  const f=await fixture(),r:any=structuredClone(f.record)
  if(reason==='kind')r.kind='list';if(reason==='schema')r.schema=2;if(reason==='price')r.rows[1].priceAtomic='1'
  if(reason==='group')r.equipment[0].sellSoul=false;if(reason==='order')r.rows.reverse();if(reason==='omit-group')delete r.equipment
  expect(()=>validateMarketBatchListOperationRecord(r)).toThrow()
})
it('blocks equipment and mixed batches in both directions under the shared wallet reservation',async()=>{
  const f=await fixture(),single=await equipmentMarketOperationFixture({equipped:true}),storage=storageFixture(),store=browserMarketBatchListOperationStore(),
    bk=marketBatchListOperationKey(f.record.owner),sk=equipmentMarketOperationKey(single.record.snapshot.asset.itemId,single.record.snapshot.actor)
  expect(single.record.snapshot.actor).toBe(f.record.owner)
  storage.setItem(sk,JSON.stringify({...single.record,phase:'SIGNING'}))
  expect(()=>store.assertAvailable!(bk,f.record)).toThrow('pending equipment')
  storage.removeItem(sk);store.write(bk,{...f.record,phase:'SIGNING'})
  expect(()=>assertListingSelectionAvailable(storage,sk,f.record.owner,equipmentMarketReservedAssets(single.record.snapshot))).toThrow('pending batch')
})
it('recovers saved mixed bytes without a draft and leaves failed readback pending until retry',async()=>{
  const f=await fixture();storageFixture();const store=browserMarketBatchListOperationStore(),key=marketBatchListOperationKey(f.record.owner)
  store.write(key,{...f.record,phase:'SIGNING'});f.read.mockRejectedValue(new Error('Current read unavailable'))
  f.sync.mockRejectedValueOnce(new Error('History unavailable'))
  await expect(runMarketBatchListOperation({owner:f.record.owner,store,adapter:f.adapter,queryOnly:true})).rejects.toThrow('History unavailable')
  expect(store.read(key)).toMatchObject({phase:'SUCCEEDED',syncStatus:'PENDING',bytes:f.record.bytes,equipment:f.record.equipment})
  const recovered=await runMarketBatchListOperation({owner:f.record.owner,store,adapter:f.adapter,queryOnly:true})
  expect(recovered).toMatchObject({phase:'SUCCEEDED',syncStatus:'COMPLETE',bytes:f.record.bytes})
  expect(f.sign).not.toHaveBeenCalled();expect(f.read).not.toHaveBeenCalled()
})
it.each(['price','gate','group'])('rejects a changed mixed review before any wallet request: %s',async reason=>{
  const f=await fixture(),r=f.observed.rows.find(row=>row.assetType==='equipment')!
  if(r.assetType!=='equipment')throw new Error('Equipment row required')
  if(reason==='price')r.priceAtomic='1';if(reason==='gate')r.snapshot.release.equipmentWritesEnabled=false
  if(reason==='group')f.observed.equipment![0].sellSoul=false
  await expect(f.adapter.prepare()).rejects.toThrow();await expect(f.adapter.preflight(f.record,false)).rejects.toThrow()
  expect(f.sign).not.toHaveBeenCalled()
})
it.each([null,[],{assetType:'soul',soulId:'x',stateId:'y',priceAtomic:'1'}])('rejects invalid batch selection rows without implicit conversion',row=>{
  expect(()=>validateMarketBatchListSelection([row])).toThrow()
})
it('allows the grouped readback budget instead of timing out at the single RPC limit',async()=>{
  const f=await fixture();vi.useFakeTimers()
  f.sync.mockImplementation(()=>new Promise(resolve=>setTimeout(()=>resolve('COMPLETE'),30_000)))
  const result=f.adapter.sync({...f.record,phase:'SUCCEEDED',syncStatus:'PENDING'})
  const assertion=expect(result).resolves.toBe('COMPLETE')
  await vi.advanceTimersByTimeAsync(30_001);await assertion
})
