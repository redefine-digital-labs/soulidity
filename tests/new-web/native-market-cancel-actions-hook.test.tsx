// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useNativeMarketCancelActions } from '../../web/lib/hooks/use-native-market-cancel-actions'
import { marketCancelFixture, cid } from './fixtures/market-cancel-operation'
const m=vi.hoisted(()=>({account:null as any,wallet:{} as any,client:{} as any,run:vi.fn(),read:vi.fn(),sign:vi.fn(),
  headers:vi.fn(),chainRead:vi.fn(),confirm:vi.fn(),config:vi.fn(),fetch:vi.fn(),changed:vi.fn(),history:vi.fn(),queryHistory:vi.fn(),adapter:null as any}))
vi.mock('../../web/lib/animacraft/browser-native-market-read',()=>({getBrowserNativeMarketCancelConfig:m.config,readBrowserNativeMarketCancel:m.chainRead}))
vi.mock('../../web/lib/animacraft/browser-native-market-readback',()=>({confirmBrowserNativeMarketCancel:m.confirm}))
vi.mock('@mysten/dapp-kit',()=>({useCurrentAccount:()=>m.account,useCurrentWallet:()=>({currentWallet:m.wallet}),
  useSuiClient:()=>m.client,useSignTransaction:()=>({mutateAsync:m.sign})}))
vi.mock('../../web/components/providers/auth-provider',()=>({useAuth:()=>({getAuthHeaders:m.headers})}))
vi.mock('../../web/lib/animacraft/market-cancel-operation',async original=>({
  ...await original<typeof import('../../web/lib/animacraft/market-cancel-operation')>(),
  browserMarketCancelOperationStore:()=>({read:m.read,history:m.history}),runMarketCancelOperation:m.run,queryMarketCancelHistory:m.queryHistory,
}))
vi.mock('../../web/lib/animacraft/market-cancel-operation-adapter',()=>({createMarketCancelOperationAdapter:(params:any)=>{m.adapter=params;return params}}))
let host:HTMLDivElement,root:Root,state:ReturnType<typeof useNativeMarketCancelActions>
let f:Awaited<ReturnType<typeof marketCancelFixture>>
let enabled=true
function Probe(){state=useNativeMarketCancelActions({soulId:f.snapshot.soulId,stateId:f.snapshot.stateId,
  listingId:f.snapshot.listingId,kioskCapId:f.snapshot.kioskCapId,enabled,onChanged:m.changed});return <span>{String(state.canStart)}</span>}
const render=()=>act(async()=>root.render(<Probe/>))
beforeEach(async()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});vi.clearAllMocks();f=await marketCancelFixture();enabled=true
  m.account={address:f.snapshot.owner};m.wallet={name:'wallet-a'};m.client={grpc:{}};m.read.mockReset().mockReturnValue(null)
  m.history.mockReset().mockReturnValue([]);m.queryHistory.mockReset().mockResolvedValue('MISSING')
  m.run.mockReset().mockResolvedValue({...f.record,phase:'SIGNING'});m.headers.mockResolvedValue({Authorization:'fixture-auth'})
  m.chainRead.mockReset().mockImplementation(async()=>structuredClone(f.snapshot));m.fetch.mockReset().mockImplementation(()=>{throw new Error('Retired owned API')});vi.stubGlobal('fetch',m.fetch)
  m.confirm.mockReset().mockResolvedValue('COMPLETE')
  m.config.mockReset().mockReturnValue({target:{protocolConfigId:'fixture-release'},buyTarget:{}})
  host=document.createElement('div');document.body.appendChild(host);root=createRoot(host)
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();vi.restoreAllMocks()})
it('loads only verified native cancellation facts and never signs automatically',async()=>{
  await render();expect(state.canStart).toBe(true);expect(m.run).not.toHaveBeenCalled();expect(m.sign).not.toHaveBeenCalled()
  expect(m.chainRead).toHaveBeenCalledWith(expect.objectContaining({soulId:f.snapshot.soulId,stateId:f.snapshot.stateId,
    listingId:f.snapshot.listingId,kioskCapId:f.snapshot.kioskCapId,config:m.config(),signal:expect.any(AbortSignal)}))
  expect(m.fetch).not.toHaveBeenCalled();expect(m.headers).not.toHaveBeenCalled()
  await act(async()=>{await state.start()});expect(m.run).toHaveBeenCalledWith(expect.objectContaining({start:true,owner:f.snapshot.owner}))
})
it('does not start with a closed write gate, disconnected wallet or different current owner',async()=>{
  f.snapshot.release.writesEnabled=false;await render();expect(state.canStart).toBe(false)
  await act(async()=>{await state.start()});expect(m.run).not.toHaveBeenCalled()
  f.snapshot.release.writesEnabled=true;f.snapshot.owner=cid(99);await act(async()=>state.refresh());expect(state.canStart).toBe(false)
  m.wallet=null;await render();expect(state.canStart).toBe(false)
})
it('restored SIGNING blocks a new intent but remains queryable even when current chain reads are unavailable',async()=>{
  m.read.mockReturnValue({...f.record,phase:'SIGNING'});m.chainRead.mockRejectedValue(new Error('offline'));await render()
  expect(state.pending).toBe(true);expect(state.canStart).toBe(false);expect(state.needsRecovery).toBe(true)
  await act(async()=>{await state.check()});expect(m.run).toHaveBeenCalledWith(expect.objectContaining({queryOnly:true,start:false}))
})
it('missing current config blocks readiness but not same-digest signed recovery or history',async()=>{
  m.config.mockImplementation(()=>{throw new Error('Public release config missing')})
  m.read.mockReturnValue({...f.record,phase:'SIGNED',signature:'sig'});await render()
  expect(state.pending).toBe(true);expect(state.canStart).toBe(false);expect(state.error).toContain('config missing')
  expect(m.chainRead).not.toHaveBeenCalled()
  await act(async()=>{await state.check();await state.checkHistory(f.record.digest)})
  expect(m.run).toHaveBeenCalledWith(expect.objectContaining({queryOnly:true,start:false}))
  expect(m.queryHistory).toHaveBeenCalled();expect(m.confirm).not.toHaveBeenCalled();expect(m.fetch).not.toHaveBeenCalled()
})
it('release change aborts old readiness and cannot restore its Cancel action from a late response',async()=>{
  let finish!:(value:any)=>void,signal!:AbortSignal
  m.chainRead.mockImplementationOnce(options=>{signal=options.signal;return new Promise(resolve=>{finish=resolve})})
  await render();expect(state.loading).toBe(true)
  m.config.mockReturnValue({target:{protocolConfigId:'new-release'}});f.snapshot.listingActive=false
  await render();expect(signal.aborted).toBe(true);expect(state.canStart).toBe(false)
  await act(async()=>{finish({...f.snapshot,listingActive:true});await Promise.resolve()})
  expect(state.snapshot?.listingActive).toBe(false);expect(state.canStart).toBe(false)
})
it('reads persisted recovery while the modal is closed without requiring live target configuration',async()=>{
  enabled=false;m.read.mockReturnValue({...f.record,phase:'SIGNED',signature:'sig'});await render()
  expect(m.chainRead).not.toHaveBeenCalled();expect(state.needsRecovery).toBe(true)
  await act(async()=>{await state.check()});expect(m.run).toHaveBeenCalledOnce()
})
it('keeps confirmed pending current-state verification distinct from an unknown transaction',async()=>{
  m.read.mockReturnValue({...f.record,phase:'SUCCEEDED',syncStatus:'PENDING'});await render()
  expect(state.pending).toBe(false);expect(state.needsRecovery).toBe(true);expect(state.canStart).toBe(true)
})
it.each(['COMPLETE','SUPERSEDED'])('a restored %s cancellation still exposes explicit current-state recovery',async previous=>{
  enabled=false;m.read.mockReturnValue({...f.record,phase:'SUCCEEDED',syncStatus:previous});await render()
  expect(state.confirmedResult).toBeNull();expect(state.needsRecovery).toBe(true);expect(m.chainRead).not.toHaveBeenCalled()
  m.run.mockResolvedValue({...f.record,phase:'SUCCEEDED',syncStatus:'SUPERSEDED'})
  await act(async()=>{await state.check()})
  expect(state.confirmedResult?.syncStatus).toBe('SUPERSEDED');expect(state.needsRecovery).toBe(false)
  await act(async()=>window.dispatchEvent(new StorageEvent('storage',{key:`soulidity.market-cancel-operation:mainnet:${f.record.soulId}:${f.record.owner}`})))
  expect(state.confirmedResult).toBeNull();expect(state.needsRecovery).toBe(true)
})
it('blocks two synchronous clicks before React updates busy state',async()=>{
  await render();let finish!:(value:any)=>void;m.run.mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
  let first!:Promise<any>;await act(async()=>{first=state.start();await state.start()})
  expect(m.run).toHaveBeenCalledOnce();await act(async()=>{finish({...f.record,phase:'SIGNING'});await first})
})
it.each(['address','wallet','client','account','release'])('invalidates a late result and signing closure on %s identity change',async change=>{
  await render();let finish!:(value:any)=>void;m.run.mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
  let first!:Promise<any>;await act(async()=>{first=state.start()});const oldAdapter=m.adapter
  if(change==='address')m.account={address:cid(99)}
  if(change==='wallet')m.wallet={name:'same-address-other-wallet'}
  if(change==='client')m.client={grpc:{different:true}}
  if(change==='account')m.account={...m.account}
  if(change==='release')m.config.mockReturnValue({target:{protocolConfigId:'another-release'}})
  await render();expect(oldAdapter.getAddress()).toBeNull()
  expect(()=>oldAdapter.sign({})).toThrow('Wallet or network client changed')
  await act(async()=>{finish({...f.record,phase:'SUCCEEDED',syncStatus:'COMPLETE'});expect(await first).toBeNull()})
  expect(state.record).toBeNull();expect(m.changed).not.toHaveBeenCalled();expect(m.sign).not.toHaveBeenCalled()
})
it('prevents an old wallet session from becoming valid after switching away and back to the same address',async()=>{
  await render();await act(async()=>{await state.start()});const oldAdapter=m.adapter,original=m.account
  m.account={address:cid(99)};await render();m.account=original;await render()
  expect(oldAdapter.getAddress()).toBeNull();expect(()=>oldAdapter.sign({})).toThrow()
})
it('confirms the exact saved operation through browser proof with no auth or owned API',async()=>{
  await render();await act(async()=>{await state.start()})
  await expect(m.adapter.sync(f.record)).resolves.toBe('COMPLETE')
  expect(m.confirm).toHaveBeenCalledWith(f.record,expect.objectContaining({target:m.config().target,signal:expect.any(AbortSignal)}),{client:m.client.grpc})
  expect(m.fetch).not.toHaveBeenCalled();expect(m.headers).not.toHaveBeenCalled()
  const invalid=new Error('Exact receipt mismatch');m.confirm.mockRejectedValueOnce(invalid)
  await expect(m.adapter.sync(f.record)).rejects.toBe(invalid)
})
it('keeps transient readback errors retryable and accepts only proved supersession from the verifier',async()=>{
  await render();await act(async()=>{await state.start()})
  m.confirm.mockResolvedValueOnce('SUPERSEDED');await expect(m.adapter.sync(f.record)).resolves.toBe('SUPERSEDED')
  for(const code of ['OBJECT_UNAVAILABLE','NATIVE_EQUIPMENT_CHANGED','NATIVE_MARKET_INVALID']) {
    const error=new Error(code);m.confirm.mockRejectedValueOnce(error);await expect(m.adapter.sync(f.record)).rejects.toBe(error)
  }
})
it.each(['wallet','release'])('cancels late current-state confirmation after %s changes',async change=>{
  await render();await act(async()=>{await state.start()});const adapter=m.adapter
  let finish!:(value:any)=>void,signal!:AbortSignal
  m.confirm.mockImplementation((_record,options)=>{signal=options.signal;return new Promise(resolve=>{finish=resolve})})
  const first=adapter.sync(f.record),rejected=expect(first).rejects.toBeTruthy()
  if(change==='wallet')m.wallet={name:'new'}
  else m.config.mockReturnValue({target:{protocolConfigId:'different-release'},buyTarget:{}})
  await render();await rejected;expect(signal.aborted).toBe(true)
  finish('COMPLETE');await Promise.resolve();expect(adapter.getAddress()).toBeNull()
  expect(m.fetch).not.toHaveBeenCalled();expect(m.headers).not.toHaveBeenCalled()
})
it('bounds a noncooperative readback promise and ignores its late success',async()=>{
  await render();await act(async()=>{await state.start()})
  const controller=new AbortController();vi.spyOn(AbortSignal,'timeout').mockReturnValue(controller.signal)
  let finish!:(value:any)=>void;m.confirm.mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
  const second=m.adapter.sync(f.record),timed=expect(second).rejects.toThrow('readback timeout')
  await vi.waitFor(()=>expect(m.confirm).toHaveBeenCalledOnce())
  controller.abort(new Error('readback timeout'));await timed;finish('COMPLETE');await Promise.resolve()
  expect(m.fetch).not.toHaveBeenCalled();expect(m.headers).not.toHaveBeenCalled()
})
it('updates saved recovery on cross-tab storage notifications without preparing a new transaction',async()=>{
  enabled=false;await render();m.read.mockReturnValue({...f.record,phase:'SIGNING'})
  await act(async()=>window.dispatchEvent(new StorageEvent('storage',{key:`soulidity.market-cancel-operation:mainnet:${f.record.soulId}:${f.record.owner}`})))
  expect(state.needsRecovery).toBe(true);expect(m.run).not.toHaveBeenCalled()
})
it('does not turn an invalid persisted record or a wrong-Soul browser read into an empty successful state',async()=>{
  m.read.mockImplementation(()=>{throw new Error('Invalid recovery bytes')});m.chainRead.mockResolvedValue({...f.snapshot,soulId:cid(99)})
  await render();expect(state.error).toBeTruthy();expect(state.snapshot).toBeNull();expect(state.canStart).toBe(false)
  expect(m.sign).not.toHaveBeenCalled()
})
it('offers explicit retirement without signing and refreshes current listing after durable retirement',async()=>{
  const retired={...f.record,phase:'RETIRED'}
  m.read.mockReturnValue({...f.record,phase:'SIGNING'});await render()
  m.run.mockImplementation(async()=>{m.read.mockReturnValue(retired);m.history.mockReturnValue([retired]);return retired})
  await act(async()=>{await state.retireExpired()})
  expect(m.run).toHaveBeenCalledWith(expect.objectContaining({retireExpired:true,start:false,queryOnly:false,cancelUnsigned:false}))
  expect(m.adapter.observed).toBeUndefined();expect(state.record?.phase).toBe('RETIRED')
  expect(state.pending).toBe(false);expect(state.needsRecovery).toBe(true);expect(state.history).toEqual([retired])
  expect(m.chainRead).toHaveBeenCalledTimes(2);expect(m.sign).not.toHaveBeenCalled();expect(m.changed).not.toHaveBeenCalled()
})
it('preserves unknown signing and shows a retirement failure without unlocking a new intent',async()=>{
  m.read.mockReturnValue({...f.record,phase:'SIGNING'});m.run.mockRejectedValue(new Error('Checkpoint has not passed expiration'))
  await render();await act(async()=>{await state.retireExpired()})
  expect(state.record?.phase).toBe('SIGNING');expect(state.canStart).toBe(false);expect(state.history).toEqual([])
  expect(state.error).toContain('expiration');expect(m.sign).not.toHaveBeenCalled()
})
it('loads immutable history on reopening a closed modal and queries it without current release configuration',async()=>{
  enabled=false;const archived={...f.record,phase:'RETIRED'};m.history.mockReturnValue([archived]);await render()
  expect(state.history).toEqual([archived]);expect(m.chainRead).not.toHaveBeenCalled()
  await act(async()=>{expect(await state.checkHistory(f.record.digest)).toBe('MISSING')})
  expect(m.queryHistory).toHaveBeenCalledWith(expect.objectContaining({soulId:f.record.soulId,owner:f.record.owner,digest:f.record.digest}))
  expect(state.historyResults[f.record.digest]).toBe('MISSING');expect(state.record).toBeNull()
  expect(m.adapter.observed).toBeUndefined();expect(m.run).not.toHaveBeenCalled();expect(m.changed).not.toHaveBeenCalled()
})
it('a historical success never overwrites a newer active intent or confirms the current listing',async()=>{
  const active={...f.record,phase:'SIGNING',digest:'new-digest'}
  m.read.mockReturnValue(active);m.history.mockReturnValue([{...f.record,phase:'RETIRED'}]);m.queryHistory.mockResolvedValue('SUCCEEDED')
  await render();await act(async()=>{await state.checkHistory(f.record.digest)})
  expect(state.record).toEqual(active);expect(state.historyResults[f.record.digest]).toBe('SUCCEEDED')
  expect(state.pending).toBe(true);expect(m.headers).not.toHaveBeenCalled();expect(m.run).not.toHaveBeenCalled();expect(m.changed).not.toHaveBeenCalled()
})
it('serializes history checks with start/resume and ignores late history on wallet changes',async()=>{
  m.history.mockReturnValue([{...f.record,phase:'RETIRED'}]);await render()
  let finish!:(value:any)=>void;m.queryHistory.mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
  let pending!:Promise<any>;await act(async()=>{pending=state.checkHistory(f.record.digest);await state.start();await state.checkHistory(f.record.digest)})
  expect(m.queryHistory).toHaveBeenCalledOnce();expect(m.run).not.toHaveBeenCalled()
  m.account={address:cid(99)};m.history.mockReturnValue([]);await render()
  await act(async()=>{finish('SUCCEEDED');expect(await pending).toBeNull()})
  expect(state.historyResults).toEqual({});expect(state.history).toEqual([]);expect(m.changed).not.toHaveBeenCalled()
})
it('refreshes cross-tab archive entries and ignores other Souls history notifications',async()=>{
  enabled=false;await render();m.history.mockReturnValue([{...f.record,phase:'RETIRED'}])
  const scope=`soulidity.market-cancel-operation:mainnet:${f.record.soulId}:${f.record.owner}`
  await act(async()=>window.dispatchEvent(new StorageEvent('storage',{key:`${scope}:retired:${f.record.digest}`})))
  expect(state.history).toHaveLength(1);const count=m.history.mock.calls.length
  await act(async()=>window.dispatchEvent(new StorageEvent('storage',{key:`${scope}-unrelated:retired:other`})))
  expect(m.history).toHaveBeenCalledTimes(count);expect(m.queryHistory).not.toHaveBeenCalled()
})
it('reports unreadable history instead of silently displaying an empty successful archive',async()=>{
  enabled=false;m.history.mockImplementation(()=>{throw new Error('Invalid archived cancellation')});await render()
  expect(state.error).toBe('Invalid archived cancellation');expect(m.run).not.toHaveBeenCalled()
})
