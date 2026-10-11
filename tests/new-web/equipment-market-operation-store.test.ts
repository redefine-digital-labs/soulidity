import {afterEach,expect,it,vi} from 'vitest'
import {Transaction,TransactionDataBuilder} from '@mysten/sui/transactions'
import {fromBase64,toBase64} from '@mysten/sui/utils'
import {verifyTransactionSignature} from '@mysten/sui/verify'
import {buildEquipmentMarketOperationTransaction,equipmentMarketInputRoles,equipmentMarketOperationKey,
  validateEquipmentMarketOperationRecord,equipmentOperationQuote,type EquipmentMarketOperationRecord,
  type EquipmentMarketOperationSnapshot,type EquipmentMarketAction} from '../../web/lib/animacraft/equipment-market-operation'
import {browserEquipmentMarketOperationStore,runEquipmentMarketOperation,queryEquipmentMarketHistory,readBrowserEquipmentMarketJournals} from '../../web/lib/animacraft/equipment-market-operation-store'
import {browserMarketListOperationStore,marketListOperationKey} from '../../web/lib/animacraft/market-list-operation'
import {browserMarketBatchListOperationStore,marketBatchListOperationKey} from '../../web/lib/animacraft/market-batch-list-operation'
import {assertListingSelectionAvailable,marketListReservedAssets} from '../../web/lib/animacraft/listing-operation-scope'
import {nativeEquipmentMarketAuthorityFixture} from './fixtures/native-equipment-market-authority'
import {marketListFixture,listSigner,lid} from './fixtures/market-list-operation'
import {marketBatchListFixture} from './fixtures/market-batch-list-operation'
import {marketCancelCheckpointFixture} from './fixtures/market-cancel-operation'

async function fixture(action:EquipmentMarketAction='list',itemId=lid(94)){
  const f=nativeEquipmentMarketAuthorityFixture(),actor=listSigner.toSuiAddress()
  const snapshot:EquipmentMarketOperationSnapshot={schema:'equipment-market-operation-v1',actor,
    seller:action==='buy'?lid(11):actor,ownershipEpoch:'0',
    asset:{kind:'base',itemId,packRegistryId:lid(82),definitionRegistryId:lid(81),baseRegistryId:lid(85)},
    reference:{objectId:itemId,version:'2',digest:f.target.outputCallableDigest},assetCommitment:'01'.repeat(32),
    quoteContext:{makerVersion:'1',rootContentCommitment:'01'.repeat(32),economicsCommitment:'02'.repeat(32),rightsCommitment:'03'.repeat(32)},
    target:{marketCallablePackageId:f.marketPin.callablePackageId,paymentCoinType:f.coin,registryId:f.ids.registry,
      treasuryId:f.ids.treasury,rootId:f.rootId,protocolConfigId:f.target.protocolConfigId,
      catalogId:f.ids.catalog,replacementId:f.ids.replacement,packageConfigId:f.ids.config},
    release:{...f.target,equipmentMarket:f.marketPin},protocolTreasuryId:f.ids.protocolTreasury,
    listing:null,lock:null,removal:null,available:{list:action==='list',buy:action==='buy',reprice:action==='reprice',cancel:action==='cancel',recover:action==='recover'}}
  if(action!=='list')snapshot.listing={id:lid(220),revision:'0',priceAtomic:'1000000',
    quoteCommitment:equipmentOperationQuote(snapshot,'1000000').commitment}
  const intent={action,snapshot,priceAtomic:'1000000',paymentCoins:action==='buy'?
    [{objectId:lid(230),version:'2',digest:f.target.outputCallableDigest,balanceAtomic:'1000000'}]:[]}
  const data=buildEquipmentMarketOperationTransaction(intent).getData(),roles=equipmentMarketInputRoles(intent)
  const tx=Transaction.from(JSON.stringify({...data,inputs:data.inputs.map(input=>{
    if(!input.UnresolvedObject)return input
    const objectId=input.UnresolvedObject.objectId
    return {Object:roles.owned.has(objectId)?{ImmOrOwnedObject:{objectId,version:'2',digest:f.target.outputCallableDigest}}:
      {SharedObject:{objectId,initialSharedVersion:'1',mutable:roles.mutable.has(objectId)}}}
  })}))
  tx.setSender(actor);tx.setGasOwner(actor);tx.setGasPrice('1000');tx.setGasBudget('1000000')
  tx.setGasPayment([{objectId:lid(240),version:'1',digest:f.target.outputCallableDigest}]);tx.setExpiration({Epoch:'10'})
  const bytes=await tx.build()
  const record=validateEquipmentMarketOperationRecord({...intent,schema:1,kind:'equipment-market',
    bytes:toBase64(bytes),digest:TransactionDataBuilder.getDigestFromBytes(bytes),expirationEpoch:'10',phase:'PREPARED',signature:null})
  return {record,key:equipmentMarketOperationKey(itemId,actor),itemId,actor}
}
function browser(){
  const values=new Map<string,string>(),held=new Set<string>(),locks:string[]=[]
  const storage={get length(){return values.size},key:(i:number)=>[...values.keys()][i]??null,
    getItem:(key:string)=>values.get(key)??null,setItem:vi.fn((key:string,value:string)=>{values.set(key,value)}),
    removeItem:vi.fn(),clear:vi.fn()} satisfies Storage
  vi.stubGlobal('window',{localStorage:storage})
  vi.stubGlobal('navigator',{locks:{request:async(key:string,_options:unknown,work:(lock:object|null)=>Promise<unknown>)=>{
    locks.push(key);if(held.has(key))return work(null)
    held.add(key);try{return await work({})}finally{held.delete(key)}
  }}})
  return {values,storage,held,locks,store:browserEquipmentMarketOperationStore()}
}
function adapter(record:EquipmentMarketOperationRecord){
  return {prepare:vi.fn(async()=>structuredClone(record)),query:vi.fn(async(_r:EquipmentMarketOperationRecord):Promise<'MISSING'|'PENDING'|'SUCCEEDED'|'FAILED'>=>'MISSING'),
    preflight:vi.fn(async()=>{}),sign:vi.fn(async(r:EquipmentMarketOperationRecord)=>listSigner.signTransaction(fromBase64(r.bytes))),
    verifySignature:vi.fn(async(r:EquipmentMarketOperationRecord)=>{await verifyTransactionSignature(fromBase64(r.bytes),r.signature!,{address:r.snapshot.actor})}),
    broadcast:vi.fn(async(_r:EquipmentMarketOperationRecord)=>{}),sync:vi.fn(async():Promise<'COMPLETE'>=> 'COMPLETE'),
    expiryCheckpoint:vi.fn(async()=>marketCancelCheckpointFixture().evidence)}
}
afterEach(()=>vi.unstubAllGlobals())
it('discovers saved item scopes after reload without chain inventory and excludes other wallets and archives',async()=>{
  const f=await fixture(),b=browser();b.store.write(f.key,f.record)
  b.values.set(`${f.key}:retired:archive`,'unrelated archive')
  b.values.set(equipmentMarketOperationKey(lid(999),lid(998)),'other wallet data')
  b.values.set('other-app','unrelated')
  expect(readBrowserEquipmentMarketJournals(f.actor)).toEqual([f.record])
  expect(readBrowserEquipmentMarketJournals(lid(997))).toEqual([])
})
it('reports a damaged matching journal rather than hiding missing recovery',async()=>{
  const f=await fixture(),b=browser();b.values.set(f.key,'invalid JSON')
  expect(()=>readBrowserEquipmentMarketJournals(f.actor)).toThrow()
})
it.each(['list','buy','reprice','cancel','recover'] as const)('persists and recovers exact valid %s packets under the same item/actor scope',async action=>{
  const f=await fixture(action),b=browser();b.store.write(f.key,f.record)
  expect(browserEquipmentMarketOperationStore().read(f.key)).toEqual(f.record)
  const a=adapter(f.record);const result=await runEquipmentMarketOperation({...f,store:b.store,adapter:a})
  expect(result).toMatchObject({phase:'SIGNED',bytes:f.record.bytes,digest:f.record.digest,action})
  expect(b.locks).toEqual([`soulidity.market-sale-wallet:mainnet:${f.actor}`,f.key])
  expect(a.prepare).not.toHaveBeenCalled();expect(a.sign).toHaveBeenCalledTimes(1)
  await expect(runEquipmentMarketOperation({...f,store:b.store,adapter:a,start:true})).rejects.toThrow('Recover the pending')
  expect(a.prepare).not.toHaveBeenCalled();expect(a.sign).toHaveBeenCalledTimes(1)
})
it('unknown broadcast recovery queries first and resends only the saved bytes without a new signature',async()=>{
  const f=await fixture(),b=browser(),a=adapter(f.record),params={...f,store:b.store,adapter:a}
  a.broadcast.mockRejectedValueOnce(new Error('connection lost'))
  await expect(runEquipmentMarketOperation({...params,start:true})).rejects.toThrow('connection lost')
  expect(b.store.read(f.key)?.phase).toBe('SIGNED')
  await runEquipmentMarketOperation({...params,queryOnly:true})
  expect(a.broadcast).toHaveBeenCalledTimes(1)
  await runEquipmentMarketOperation(params)
  expect(a.prepare).toHaveBeenCalledTimes(1);expect(a.sign).toHaveBeenCalledTimes(1)
  expect(a.broadcast.mock.calls.map(([r])=>r.bytes)).toEqual([f.record.bytes,f.record.bytes])
})
it('quota and readback failures block signing before any wallet prompt',async()=>{
  const f=await fixture(),b=browser(),a=adapter(f.record)
  b.storage.setItem.mockImplementation(()=>{throw new Error('quota')})
  await expect(runEquipmentMarketOperation({...f,store:b.store,adapter:a,start:true})).rejects.toThrow('quota')
  b.storage.setItem.mockImplementation(()=>{})
  await expect(runEquipmentMarketOperation({...f,store:b.store,adapter:a,start:true})).rejects.toThrow('could not be persisted')
  expect(a.sign).not.toHaveBeenCalled();expect(a.broadcast).not.toHaveBeenCalled()
})
it('a failed SIGNING commit retains PREPARED and never prompts for a signature',async()=>{
  const f=await fixture(),b=browser(),a=adapter(f.record)
  b.store.write(f.key,f.record)
  b.storage.setItem.mockImplementation(()=>{throw new Error('quota at signing')})
  await expect(runEquipmentMarketOperation({...f,store:b.store,adapter:a})).rejects.toThrow('quota at signing')
  expect(b.store.read(f.key)).toEqual(f.record);expect(a.sign).not.toHaveBeenCalled()
})
it('retirement history is immutable, query-only and preserved without deleting the active pointer',async()=>{
  const f=await fixture(),b=browser(),a=adapter(f.record),params={...f,store:b.store,adapter:a}
  b.store.write(f.key,{...f.record,phase:'SIGNING'})
  const retired=await runEquipmentMarketOperation({...params,retireExpired:true})
  expect(b.store.history(f.key)).toEqual([retired]);const saved=b.storage.getItem(f.key)
  a.query.mockResolvedValue('SUCCEEDED')
  expect(await queryEquipmentMarketHistory({...params,digest:retired.digest})).toBe('SUCCEEDED')
  expect(b.storage.getItem(f.key)).toBe(saved);expect(b.store.history(f.key)).toEqual([retired])
  expect(()=>b.store.archive(f.key,{...retired,snapshot:{...retired.snapshot,ownershipEpoch:'1'}})).toThrow('immutable')
  expect(a.sign).not.toHaveBeenCalled();expect(a.sync).not.toHaveBeenCalled()
  expect(b.storage.removeItem).not.toHaveBeenCalled();expect(b.storage.clear).not.toHaveBeenCalled()
})
it('pending Soul atomic removal and individual equipment journals block each other in both directions',async()=>{
  const f=await fixture(),soul=await marketListFixture({equipped:true}),b=browser(),single=browserMarketListOperationStore()
  const soulKey=marketListOperationKey(soul.snapshot.soulId,soul.snapshot.owner)
  single.write(soulKey,soul.record)
  expect(()=>b.store.assertAvailable!(f.key,f.record)).toThrow('pending single-Soul')
  single.write(soulKey,{...soul.record,phase:'CANCELLED'})
  expect(()=>b.store.assertAvailable!(f.key,f.record)).not.toThrow()
  b.store.write(f.key,f.record)
  expect(()=>single.assertAvailable!(soulKey,soul.record)).toThrow('pending equipment')
  b.store.write(f.key,{...f.record,phase:'CANCELLED'})
  expect(()=>single.assertAvailable!(soulKey,soul.record)).not.toThrow()
  expect(marketListReservedAssets(soul.snapshot)).toEqual(expect.arrayContaining([lid(12),lid(14),lid(90),lid(94),lid(95)]))
})
it('batch reservations include each Soul removal and block equipment in both directions',async()=>{
  const f=await fixture(),batch=await marketBatchListFixture(),b=browser(),store=browserMarketBatchListOperationStore()
  const key=marketBatchListOperationKey(batch.record.owner)
  store.write(key,batch.record)
  expect(()=>b.store.assertAvailable!(f.key,f.record)).toThrow('pending batch')
  store.write(key,{...batch.record,phase:'CANCELLED'});b.store.write(f.key,f.record)
  expect(()=>store.assertAvailable!(key,batch.record)).toThrow('pending equipment')
  b.store.write(f.key,{...f.record,phase:'FAILED'})
  expect(()=>store.assertAvailable!(key,batch.record)).not.toThrow()
})
it('other malformed equipment journals fail closed and wallet locks serialize distinct items',async()=>{
  const f=await fixture(),b=browser(),a=adapter(f.record),other=equipmentMarketOperationKey(lid(250),f.actor)
  b.values.set(other,'{}')
  expect(()=>assertListingSelectionAvailable(b.storage,f.key,f.actor,[f.itemId])).toThrow()
  b.held.add(`soulidity.market-sale-wallet:mainnet:${f.actor}`)
  await expect(runEquipmentMarketOperation({...f,store:b.store,adapter:a,start:true})).rejects.toThrow('another tab')
  expect(a.prepare).not.toHaveBeenCalled();expect(a.sign).not.toHaveBeenCalled()
})
it('rejects journal scope substitution and malformed or misnamed archives',async()=>{
  const f=await fixture(),b=browser(),other=equipmentMarketOperationKey(lid(250),f.actor)
  expect(()=>b.store.write(other,f.record)).toThrow('scope mismatch')
  b.values.set(other,JSON.stringify(f.record));expect(()=>b.store.read(other)).toThrow('scope mismatch')
  b.values.set(`${f.key}:retired:wrong`,JSON.stringify({...f.record,phase:'RETIRED',
    retirement:{priorPhase:'SIGNING',checkpoint:marketCancelCheckpointFixture().evidence}}))
  expect(()=>b.store.history(f.key)).toThrow('digest mismatch')
})
