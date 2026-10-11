import {afterEach,expect,it,vi} from 'vitest'
import {bcs} from '@mysten/sui/bcs'
import {TransactionDataBuilder} from '@mysten/sui/transactions'
import {fromBase64,toBase64} from '@mysten/sui/utils'
import {validateMarketBatchListSnapshot,validateMarketBatchListOperationRecord,validateMarketBatchListSelection,
  marketBatchListOperationKey,runMarketBatchListOperation,browserMarketBatchListOperationStore} from '../../web/lib/animacraft/market-batch-list-operation'
import {browserMarketListOperationStore,marketListOperationKey} from '../../web/lib/animacraft/market-list-operation'
import {marketBatchListFixture} from './fixtures/market-batch-list-operation'
import {marketListFixture,listSigner,lid} from './fixtures/market-list-operation'
import {marketCancelCheckpointFixture} from './fixtures/market-cancel-operation'

afterEach(()=>vi.unstubAllGlobals())
it('freezes only selected rows, shares infrastructure and preserves exact distinct prices',async()=>{
  const f=await marketBatchListFixture(),record=validateMarketBatchListOperationRecord(f.record)
  expect(record.rows.map(row=>[row.assetType,row.assetType==='soul'?row.snapshot.soulId:null,row.priceAtomic])).toEqual([
    ['soul',lid(12),'10001'],['soul',lid(112),'20002']])
  expect(f.tx.getData().inputs.filter(i=>i.Object?.ImmOrOwnedObject?.objectId===lid(21))).toHaveLength(1)
  f.record.rows[0].priceAtomic='1';expect(record.rows[0].priceAtomic).toBe('10001')
})
it.each(['duplicate','state-alias','instance-alias','resource-alias','package-alias','owner','release','cap-kiosk','runtime','type','price','missing-plan','extra-field'])(
  'rejects cross-row scope substitution: %s',async reason=>{
    const f=await marketBatchListFixture(),value=f.snapshot,a=value.rows[0],z=value.rows[1]
    if(reason==='duplicate')value.rows[1]=structuredClone(a)
    if(reason==='state-alias')z.snapshot.stateId=a.snapshot.soulId
    if(reason==='instance-alias')z.snapshot.equipmentSale!.removals=[{kind:'base',itemId:lid(94)}]
    if(reason==='resource-alias')z.snapshot.equipmentSale!.definitionRegistryId=a.snapshot.bindingId
    if(reason==='package-alias')z.snapshot.bindingId=a.snapshot.equipmentSale!.packs[0].runtimeCallablePackageId
    if(reason==='owner')z.snapshot.owner=lid(999)
    if(reason==='release')z.snapshot.release.marketConfigV2Id=lid(999)
    if(reason==='cap-kiosk')z.snapshot.kioskId=lid(999)
    if(reason==='runtime')z.snapshot.equipmentSale!.runtimeCallableDigest=f.record.digest
    if(reason==='type')(z as any).assetType='equipment'
    if(reason==='price')z.priceAtomic='0'
    if(reason==='missing-plan'){delete z.snapshot.equipmentSale;z.snapshot.listAvailable=false}
    if(reason==='extra-field')(z as any).inventory=[lid(999)]
    expect(()=>validateMarketBatchListSnapshot(value)).toThrow()
  })
it.each(['empty','too-many','zero','precision','extra','duplicate'])('rejects ambiguous selection before RPC: %s',reason=>{
  const value:any=[{soulId:lid(12),stateId:lid(14),priceAtomic:'100'}]
  if(reason==='empty')value.pop();if(reason==='too-many')for(let i=0;i<20;i++)value.push({soulId:lid(1000+i*2),stateId:lid(1001+i*2),priceAtomic:'100'})
  if(reason==='zero')value[0].priceAtomic='0';if(reason==='precision')value[0].priceAtomic=1.5
  if(reason==='extra')value[0].equipmentIds=[lid(84)];if(reason==='duplicate')value.push(value[0])
  expect(()=>validateMarketBatchListSelection(value)).toThrow()
})
it.each(['price','order','remove-row','extra-command','owned','shared','gas','sender','expiration'])(
  'rejects exact packet substitution: %s',async reason=>{
    const f=await marketBatchListFixture(),r=f.record,wire=bcs.TransactionData.parse(f.bytes)
    if(reason==='price')r.rows[1].priceAtomic='1'
    if(reason==='order')r.rows.reverse()
    if(reason==='remove-row')r.rows.pop()
    const tx=wire.V1!.kind.ProgrammableTransaction!
    if(reason==='extra-command')tx.commands.push(tx.commands.at(-1)!)
    if(reason==='owned')tx.inputs.find(i=>i.Object?.ImmOrOwnedObject)!.Object!.ImmOrOwnedObject!.objectId=lid(999)
    if(reason==='shared')tx.inputs.find(i=>i.Object?.SharedObject)!.Object!.SharedObject!.mutable=false
    if(reason==='gas')wire.V1!.gasData.payment[0].objectId=f.snapshot.rows[1].snapshot.soulId
    if(reason==='sender')wire.V1!.sender=lid(999)
    if(reason==='expiration')wire.V1!.expiration={Epoch:11,$kind:'Epoch'}
    const bytes=bcs.TransactionData.serialize(wire).toBytes();r.bytes=toBase64(bytes);r.digest=TransactionDataBuilder.getDigestFromBytes(bytes)
    expect(()=>validateMarketBatchListOperationRecord(r)).toThrow()
  })
async function lifecycle(){
  const f=await marketBatchListFixture();let saved:any=null,submitted=false
  const history=new Map<string,any>(),events:string[]=[]
  const store={exclusive:async(_k:string,work:()=>Promise<any>)=>work(),read:()=>structuredClone(saved),
    write:vi.fn((_k:string,r:any)=>{events.push(`save:${r.phase}`);saved=structuredClone(r)}),archive:(_k:string,r:any)=>{history.set(r.digest,structuredClone(r))},history:()=>[...history.values()]}
  const adapter={prepare:vi.fn(async()=>f.record),query:vi.fn(async()=>submitted?'SUCCEEDED' as const:'MISSING' as const),preflight:vi.fn(async()=>{}),
    sign:vi.fn(async(r:any)=>{events.push('sign');return listSigner.signTransaction(fromBase64(r.bytes))}),verifySignature:vi.fn(async()=>{}),
    broadcast:vi.fn(async(_record:any)=>{events.push('broadcast');submitted=true}),sync:vi.fn(async()=>'COMPLETE' as const),expiryCheckpoint:vi.fn(async()=>marketCancelCheckpointFixture().evidence)}
  return {...f,store,adapter,events,history,params:{owner:f.record.owner,store,adapter},saved:()=>saved,setSaved:(v:any)=>{saved=structuredClone(v)}}
}
it('batch uses the same durable query-first lifecycle and one signature, not a per-row loop',async()=>{
  const f=await lifecycle(),result=await runMarketBatchListOperation({...f.params,start:true})
  expect(result).toMatchObject({phase:'SUCCEEDED',syncStatus:'COMPLETE',bytes:f.record.bytes})
  expect(f.adapter.sign).toHaveBeenCalledOnce();expect(f.adapter.broadcast).toHaveBeenCalledOnce()
  expect(f.events.indexOf('save:SIGNING')).toBeLessThan(f.events.indexOf('sign'))
  expect(f.events.indexOf('save:SIGNED')).toBeLessThan(f.events.indexOf('broadcast'))
  f.adapter.sign.mockClear();await runMarketBatchListOperation({...f.params,queryOnly:true});expect(f.adapter.sign).not.toHaveBeenCalled()
})
it('lost broadcast response preserves the complete saved packet and resumes without another signature',async()=>{
  const f=await lifecycle();f.adapter.broadcast.mockRejectedValueOnce(new Error('unknown'))
  await expect(runMarketBatchListOperation({...f.params,start:true})).rejects.toThrow('unknown')
  expect(f.saved()).toMatchObject({phase:'SIGNED',bytes:f.record.bytes,rows:f.record.rows})
  await runMarketBatchListOperation(f.params);expect(f.adapter.sign).toHaveBeenCalledOnce()
  expect(f.adapter.broadcast.mock.calls[1][0].bytes).toBe(f.record.bytes)
})
it('a prepared-store failure cannot request any signature',async()=>{
  const f=await lifecycle();f.store.write.mockImplementation(()=>{throw new Error('quota')})
  await expect(runMarketBatchListOperation({...f.params,start:true})).rejects.toThrow('quota');expect(f.adapter.sign).not.toHaveBeenCalled()
})
it('unknown signing cannot be discarded, but can retire after exact expiry and remain queryable',async()=>{
  const f=await lifecycle();f.setSaved({...f.record,phase:'SIGNING'})
  await expect(runMarketBatchListOperation({...f.params,cancelUnsigned:true})).rejects.toThrow('cannot be discarded')
  const result=await runMarketBatchListOperation({...f.params,retireExpired:true})
  expect(result.phase).toBe('RETIRED');expect(f.history.get(result.digest).bytes).toBe(f.record.bytes)
  expect(f.adapter.sign).not.toHaveBeenCalled()
})
function storageFixture(){
  const values=new Map<string,string>(),locks:string[]=[]
  const storage={get length(){return values.size},key:(i:number)=>[...values.keys()][i]??null,getItem:(k:string)=>values.get(k)??null,
    setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k),clear:()=>values.clear()}
  vi.stubGlobal('window',{localStorage:storage});vi.stubGlobal('navigator',{locks:{request:async(key:string,_options:any,work:(lock:object)=>Promise<any>)=>{locks.push(key);return work({})}}})
  return {values,locks}
}
it('single and batch journals share a wallet lock and block overlapping pending packets, not recovery or unrelated Souls',async()=>{
  const f=await marketBatchListFixture(),single=await marketListFixture(),{locks}=storageFixture()
  const batchStore=browserMarketBatchListOperationStore(),singleStore=browserMarketListOperationStore(),bk=marketBatchListOperationKey(f.record.owner),sk=marketListOperationKey(single.record.snapshot.soulId,single.record.snapshot.owner)
  singleStore.write(sk,{...single.record,phase:'SIGNING'})
  expect(()=>batchStore.assertAvailable!(bk,f.record)).toThrow('pending single-Soul')
  await batchStore.exclusive(bk,async()=>expect(batchStore.read(bk)).toBeNull())
  singleStore.write(sk,{...single.record,phase:'CANCELLED'})
  batchStore.assertAvailable!(bk,f.record);batchStore.write(bk,{...f.record,phase:'SIGNING'})
  expect(()=>singleStore.assertAvailable!(sk,single.record)).toThrow('pending batch')
  await singleStore.exclusive(sk,async()=>expect(singleStore.read(sk)?.phase).toBe('CANCELLED'))
  expect(locks.filter(k=>k.startsWith('soulidity.market-sale-wallet:'))).toEqual(Array(2).fill(`soulidity.market-sale-wallet:mainnet:${f.record.owner}`))
})
