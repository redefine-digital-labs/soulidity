// @vitest-environment jsdom
import React,{act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {beforeEach,afterEach,expect,it,vi} from 'vitest'
import {Transaction,TransactionDataBuilder} from '@mysten/sui/transactions'
import {toBase64} from '@mysten/sui/utils'
import {useNativeMarketBatchListActions} from '../../web/lib/hooks/use-native-market-batch-list-actions'
import {marketListFixture,lid} from './fixtures/market-list-operation'
import {buildMarketBatchListTransaction} from '../../web/lib/animacraft/market-batch-list-operation'
import type {NativeMarketBatchListSnapshot,BatchMarketListOperationRecord,MarketBatchListSelection} from '../../web/lib/animacraft/market-batch-list-types'
import {selectedMarketSaleEvidenceFixture} from './fixtures/selected-market-sale-evidence'
import {batchListingSelection} from '../../web/lib/animacraft/market-batch-list-operation-adapter'

const m=vi.hoisted(()=>({account:null as any,wallet:{} as any,client:{} as any,run:vi.fn(),read:vi.fn(),history:vi.fn(),
  queryHistory:vi.fn(),sign:vi.fn(),chainRead:vi.fn(),confirm:vi.fn(),config:vi.fn(),targetConfig:vi.fn(),invalidate:vi.fn(),
  adapter:null as any,realAdapter:false,broadcast:vi.fn(),mixedConfirm:vi.fn()}))
vi.mock('@mysten/dapp-kit',()=>({useCurrentAccount:()=>m.account,useCurrentWallet:()=>({currentWallet:m.wallet}),
  useSuiClient:()=>m.client,useSignTransaction:()=>({mutateAsync:m.sign})}))
vi.mock('@tanstack/react-query',()=>({useQueryClient:()=>({invalidateQueries:m.invalidate})}))
vi.mock('../../web/lib/animacraft/browser-native-market-read',()=>({getBrowserNativeMarketConfig:m.config,
  getBrowserNativeMarketCancelConfig:m.targetConfig,readBrowserNativeMarketBatchList:m.chainRead}))
vi.mock('../../web/lib/animacraft/browser-native-market-readback',()=>({confirmBrowserNativeMarketBatchList:m.confirm}))
vi.mock('../../web/lib/animacraft/browser-selected-market-sale-readback',()=>({confirmBrowserSelectedMarketSale:m.mixedConfirm}))
vi.mock('../../web/lib/animacraft/market-batch-list-operation',async original=>({
  ...await original<typeof import('../../web/lib/animacraft/market-batch-list-operation')>(),
  browserMarketBatchListOperationStore:()=>({read:m.read,history:m.history}),runMarketBatchListOperation:m.run,queryMarketBatchListHistory:m.queryHistory,
}))
vi.mock('../../web/lib/animacraft/market-batch-list-operation-adapter',async original=>{
  const actual=await original<typeof import('../../web/lib/animacraft/market-batch-list-operation-adapter')>()
  return {...actual,createMarketBatchListOperationAdapter:(params:any)=>{m.adapter=params;return m.realAdapter?actual.createMarketBatchListOperationAdapter(params):params}}
})
let root:Root,host:HTMLDivElement,state:ReturnType<typeof useNativeMarketBatchListActions>
let snapshot:NativeMarketBatchListSnapshot,record:BatchMarketListOperationRecord,selection:MarketBatchListSelection[],owner:string|null,identityKey:string
function Probe(){state=useNativeMarketBatchListActions({owner,identityKey,selection});return <span>{String(state.canStart)}</span>}
const render=()=>act(async()=>root.render(<Probe/>))
beforeEach(async()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});vi.clearAllMocks();m.realAdapter=false
  const f=await marketListFixture(),second=structuredClone(f.snapshot)
  second.soulId=lid(112);second.stateId=lid(114);second.bindingId=lid(113)
  snapshot={schema:'native-market-batch-list-v1',owner:f.snapshot.owner,rows:[
    {assetType:'soul',snapshot:f.snapshot,priceAtomic:'1000001'},
    {assetType:'soul',snapshot:second,priceAtomic:'2000002'},
  ]}
  // Real batch commands and resolved bytes; readers/store/engine are isolated
  // here while the concrete snapshot and adapter validators remain available.
  const data=buildMarketBatchListTransaction(snapshot.rows).getData()
  const owned=new Set(snapshot.rows.flatMap(row=>row.assetType==='soul'?[row.snapshot.bindingId,row.snapshot.kioskCapId]:[]))
  const tx=Transaction.from(JSON.stringify({...data,inputs:data.inputs.map(input=>{
    if(!input.UnresolvedObject)return input
    const objectId=input.UnresolvedObject.objectId
    return {Object:owned.has(objectId)?{ImmOrOwnedObject:{objectId,version:'2',digest:f.snapshot.release.soulidityCallableDigest}}
      :{SharedObject:{objectId,initialSharedVersion:'1',mutable:objectId!==f.snapshot.release.marketConfigV2Id}}}
  })}))
  tx.setSender(snapshot.owner);tx.setGasOwner(snapshot.owner);tx.setGasPrice('1000');tx.setGasBudget('1000000')
  tx.setGasPayment([{objectId:lid(200),version:'1',digest:f.snapshot.release.soulidityCallableDigest}]);tx.setExpiration({Epoch:'10'})
  const bytes=await tx.build()
  record={schema:1,kind:'batch-list',owner:snapshot.owner,rows:structuredClone(snapshot.rows),bytes:toBase64(bytes),
    digest:TransactionDataBuilder.getDigestFromBytes(bytes),expirationEpoch:'10',phase:'PREPARED',signature:null}
  owner=snapshot.owner;identityKey='owner:1';selection=batchListingSelection(snapshot)
  m.account={address:owner};m.wallet={name:'wallet-a'};m.client={grpc:{core:{executeTransaction:m.broadcast}}}
  m.read.mockReset().mockReturnValue(null);m.history.mockReset().mockReturnValue([]);m.queryHistory.mockReset().mockResolvedValue('MISSING')
  m.run.mockReset().mockResolvedValue({...record,phase:'SIGNING'});m.sign.mockReset().mockResolvedValue({bytes:record.bytes,signature:'signature'})
  m.chainRead.mockReset().mockImplementation(async()=>structuredClone(snapshot));m.confirm.mockReset().mockResolvedValue('COMPLETE')
  m.mixedConfirm.mockReset().mockResolvedValue('COMPLETE')
  m.config.mockReset().mockReturnValue({target:{protocolConfigId:'release-a'},buyTarget:{}})
  m.targetConfig.mockReset().mockReturnValue({target:{protocolConfigId:'release-a'}})
  host=document.createElement('div');document.body.appendChild(host);root=createRoot(host)
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.useRealTimers()})

it('pins exactly the ordered selected identities and prices before explicit start',async()=>{
  await render();expect(state.canStart).toBe(true);expect(m.run).not.toHaveBeenCalled()
  expect(m.chainRead).toHaveBeenCalledWith(expect.objectContaining({owner,selection,config:m.config(),signal:expect.any(AbortSignal)}))
  await act(async()=>{await state.start()})
  expect(m.run).toHaveBeenCalledWith(expect.objectContaining({owner,start:true}));expect(m.adapter.observed).toEqual(snapshot)
  expect(m.sign).not.toHaveBeenCalled()
})
it('routes saved grouped mixed recovery through the unified readback with the full group budget',async()=>{
  const f=await selectedMarketSaleEvidenceFixture(),{snapshot:s,...packet}=f.record
  record={...packet,owner:s.owner,rows:s.rows,equipment:s.equipment}
  snapshot={schema:'native-market-batch-list-v1',owner:s.owner,rows:s.rows,equipment:s.equipment}
  owner=s.owner;m.account={address:owner};selection=batchListingSelection(snapshot)
  await render();expect(state.canStart).toBe(true)
  await act(async()=>{await state.start()})
  const saved={...record,phase:'SUCCEEDED',syncStatus:'PENDING'}
  vi.useFakeTimers()
  m.mixedConfirm.mockImplementation(async(_record:any,{signal}:any)=>{
    await new Promise(resolve=>setTimeout(resolve,30_000));signal.throwIfAborted();return 'COMPLETE'
  })
  const pending=m.adapter.sync(saved),assertion=expect(pending).resolves.toBe('COMPLETE')
  await vi.advanceTimersByTimeAsync(30_001);await assertion
  expect(m.mixedConfirm).toHaveBeenCalledWith({...f.record,phase:'SUCCEEDED',syncStatus:'PENDING'},
    expect.objectContaining({signal:expect.any(AbortSignal)}),expect.objectContaining({client:m.client.grpc}))
  expect(m.confirm).not.toHaveBeenCalled();expect(m.sign).not.toHaveBeenCalled()
})
it.each(['order','price','owner','state','extra'])('rejects readback %s drift rather than silently revising selection',async kind=>{
  const wrong=structuredClone(snapshot)
  if(kind==='order')wrong.rows.reverse()
  if(kind==='price')wrong.rows[0].priceAtomic='9'
  if(kind==='owner'){wrong.owner=lid(400);wrong.rows.forEach(row=>{if(row.assetType==='soul')row.snapshot.owner=wrong.owner})}
  if(kind==='state'&&wrong.rows[0].assetType==='soul')wrong.rows[0].snapshot.stateId=lid(400)
  if(kind==='extra')wrong.rows.push(wrong.rows[0])
  m.chainRead.mockResolvedValue(wrong);await render()
  expect(state.snapshot).toBeNull();expect(state.canStart).toBe(false);expect(state.error).toBeTruthy()
  await act(async()=>{await state.start()});expect(m.run).not.toHaveBeenCalled()
})
it.each(['empty','duplicate','invalid price','over limit','different wallet'])('does not read or start an invalid scope: %s',async kind=>{
  if(kind==='empty')selection=[]
  if(kind==='duplicate')selection.push(selection[0])
  if(kind==='invalid price')selection[0].priceAtomic='0'
  if(kind==='over limit')selection=Array(21).fill(selection[0])
  if(kind==='different wallet')m.account={address:lid(400)}
  await render();expect(state.canStart).toBe(false);expect(m.chainRead).not.toHaveBeenCalled()
  await act(async()=>{await state.start()});expect(m.run).not.toHaveBeenCalled()
})
it.each(['no selection','no config','read failure'])('recovers a pending owner batch with %s',async kind=>{
  m.read.mockReturnValue({...record,phase:'SIGNED',signature:'saved'})
  if(kind==='no selection')selection=[]
  if(kind==='no config')m.config.mockImplementation(()=>{throw new Error('Config unavailable')})
  if(kind==='read failure')m.chainRead.mockRejectedValue(new Error('Read unavailable'))
  await render();expect(state.pending).toBe(true);expect(state.canStart).toBe(false)
  await act(async()=>{await state.check()});expect(m.run).toHaveBeenCalledWith(expect.objectContaining({queryOnly:true,start:false,owner}))
  expect(m.adapter.observed).toBeUndefined();expect(m.sign).not.toHaveBeenCalled()
})
it.each(['owner','wallet','account','client','config','selection','identity'])('invalidates old signer/readback after %s ABA',async kind=>{
  await render();await act(async()=>{await state.start()});const adapter=m.adapter
  const old={owner,account:m.account,wallet:m.wallet,client:m.client,config:m.config(),selection,identityKey}
  if(kind==='owner'){owner=lid(400);m.account={address:owner}}
  if(kind==='wallet')m.wallet={name:'wallet-b'}
  if(kind==='account')m.account={...m.account}
  if(kind==='client')m.client={grpc:{replacement:true}}
  if(kind==='config')m.config.mockReturnValue({target:{protocolConfigId:'release-b'},buyTarget:{}})
  if(kind==='selection')selection=[{...selection[0],priceAtomic:'3'}]
  if(kind==='identity')identityKey='owner:2'
  await render()
  owner=old.owner;m.account=old.account;m.wallet=old.wallet;m.client=old.client;m.config.mockReturnValue(old.config);selection=old.selection;identityKey=old.identityKey
  await render();expect(adapter.getAddress()).toBeNull();expect(()=>adapter.sign({})).toThrow('changed')
  await expect(adapter.sync(record)).rejects.toThrow('changed');expect(m.sign).not.toHaveBeenCalled()
})
it('aborts old readiness and ignores its late response after a selection change',async()=>{
  let finish!:(value:NativeMarketBatchListSnapshot)=>void,signal!:AbortSignal
  m.chainRead.mockImplementationOnce(options=>{signal=options.signal;return new Promise(resolve=>{finish=resolve})})
  await render();expect(state.loading).toBe(true)
  selection=[];await render();expect(signal.aborted).toBe(true)
  await act(async()=>{finish(snapshot);await Promise.resolve()});expect(state.snapshot).toBeNull();expect(state.canStart).toBe(false)
})
it('never broadcasts through the real adapter after the wallet changes while signing',async()=>{
  m.realAdapter=true;await render()
  let finish!:(value:any)=>void;m.sign.mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
  m.run.mockImplementation(async({adapter})=>{
    const signed=await adapter.sign(record)
    await adapter.broadcast({...record,phase:'SIGNED',signature:signed.signature})
    return record
  })
  let pending!:Promise<unknown>;await act(async()=>{pending=state.start()})
  await vi.waitFor(()=>expect(m.sign).toHaveBeenCalledOnce())
  m.wallet={name:'wallet-b'};await render()
  await act(async()=>{finish({bytes:record.bytes,signature:'saved'});expect(await pending).toBeNull()})
  expect(m.broadcast).not.toHaveBeenCalled();expect(m.invalidate).not.toHaveBeenCalled()
})
it('serializes duplicate start, recovery and history clicks in the same session',async()=>{
  await render();let finish!:(value:any)=>void;m.run.mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
  let pending!:Promise<unknown>;await act(async()=>{pending=state.start();await state.start();await state.resume();await state.checkHistory(record.digest)})
  expect(m.run).toHaveBeenCalledOnce();expect(m.queryHistory).not.toHaveBeenCalled()
  await act(async()=>{finish({...record,phase:'SIGNING'});await pending})
})
it('invalidates Soul detail, portfolio and public market only after current-session success',async()=>{
  await render();m.run.mockResolvedValue({...record,phase:'SUCCEEDED',syncStatus:'COMPLETE'})
  await act(async()=>{await state.check()})
  for(const key of ['soul','my-souls','souls','owned-equipment','native-equipment','native-equipment-source','native-equipment-pack'])expect(m.invalidate).toHaveBeenCalledWith({queryKey:[key]})
  expect(state.snapshot).toBeNull();expect(m.sign).not.toHaveBeenCalled()
})
it('ignores late transaction success after the owner session changes',async()=>{
  await render();let finish!:(value:any)=>void;m.run.mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
  let pending!:Promise<unknown>;await act(async()=>{pending=state.start()})
  owner=lid(400);m.account={address:owner};await render()
  await act(async()=>{finish({...record,phase:'SUCCEEDED',syncStatus:'COMPLETE'});expect(await pending).toBeNull()})
  expect(state.record).toBeNull();expect(m.invalidate).not.toHaveBeenCalled()
})
it('queries archived history without signing, syncing or replacing the active batch',async()=>{
  selection=[];const active={...record,phase:'SIGNING'};m.read.mockReturnValue(active);m.history.mockReturnValue([{...record,phase:'RETIRED'}])
  m.queryHistory.mockResolvedValue('SUCCEEDED');await render()
  await act(async()=>{await state.checkHistory(record.digest)})
  expect(state.record).toEqual(active);expect(state.historyResults[record.digest]).toBe('SUCCEEDED')
  expect(m.run).not.toHaveBeenCalled();expect(m.confirm).not.toHaveBeenCalled();expect(m.sign).not.toHaveBeenCalled();expect(m.invalidate).not.toHaveBeenCalled()
})
it('suppresses old history observations after selection ABA and keeps the active record',async()=>{
  m.read.mockReturnValue({...record,phase:'SIGNING'});await render()
  let finish!:(value:any)=>void;m.queryHistory.mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
  let pending!:Promise<unknown>;await act(async()=>{pending=state.checkHistory(record.digest)})
  const old=selection;selection=[];await render();selection=old;await render()
  await act(async()=>{finish('SUCCEEDED');expect(await pending).toBeNull()})
  expect(state.historyResults).toEqual({});expect(state.record?.digest).toBe(record.digest)
})
it('forwards explicit cancellation and expiry actions without preparing a new selection',async()=>{
  selection=[];m.read.mockReturnValue(record);await render()
  await act(async()=>{await state.cancelUnsigned();await state.retireExpired()})
  expect(m.run).toHaveBeenCalledWith(expect.objectContaining({start:false,cancelUnsigned:true}))
  expect(m.run).toHaveBeenCalledWith(expect.objectContaining({start:false,retireExpired:true}))
  expect(m.chainRead).not.toHaveBeenCalled();expect(m.sign).not.toHaveBeenCalled()
})
