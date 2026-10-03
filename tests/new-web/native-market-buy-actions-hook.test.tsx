// @vitest-environment jsdom
import React,{act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {beforeEach,afterEach,expect,it,vi} from 'vitest'
import {useNativeMarketBuyActions} from '../../web/lib/hooks/use-native-market-buy-actions'
import {marketBuyFixture,bid} from './fixtures/market-buy-operation'
const m=vi.hoisted(()=>({account:null as any,wallet:{} as any,client:{} as any,run:vi.fn(),read:vi.fn(),history:vi.fn(),
  queryHistory:vi.fn(),sign:vi.fn(),headers:vi.fn(),chainRead:vi.fn(),confirm:vi.fn(),config:vi.fn(),targetConfig:vi.fn(),fetch:vi.fn(),invalidate:vi.fn(),adapter:null as any}))
vi.mock('../../web/lib/animacraft/browser-native-market-read',()=>({getBrowserNativeMarketConfig:m.config,getBrowserNativeMarketCancelConfig:m.targetConfig,readBrowserNativeMarketBuy:m.chainRead}))
vi.mock('../../web/lib/animacraft/browser-native-market-readback',()=>({confirmBrowserNativeMarketBuy:m.confirm}))
vi.mock('@mysten/dapp-kit',()=>({useCurrentAccount:()=>m.account,useCurrentWallet:()=>({currentWallet:m.wallet}),
  useSuiClient:()=>m.client,useSignTransaction:()=>({mutateAsync:m.sign})}))
vi.mock('@tanstack/react-query',()=>({useQueryClient:()=>({invalidateQueries:m.invalidate})}))
vi.mock('../../web/components/providers/auth-provider',()=>({useAuth:()=>({getAuthHeaders:m.headers})}))
vi.mock('../../web/lib/animacraft/market-buy-operation',async original=>({
  ...await original<typeof import('../../web/lib/animacraft/market-buy-operation')>(),
  browserMarketBuyOperationStore:()=>({read:m.read,history:m.history}),runMarketBuyOperation:m.run,queryMarketBuyHistory:m.queryHistory,
}))
vi.mock('../../web/lib/animacraft/market-buy-operation-adapter',()=>({createMarketBuyOperationAdapter:(params:any)=>{m.adapter=params;return params}}))
let host:HTMLDivElement,root:Root,state:ReturnType<typeof useNativeMarketBuyActions>,f:Awaited<ReturnType<typeof marketBuyFixture>>,enabled=true
function Probe(){state=useNativeMarketBuyActions(enabled?{soulId:f.snapshot.soulId,stateId:f.snapshot.stateId,listingId:f.snapshot.listingId}:null);return <span>{String(state.canStart)}</span>}
const render=()=>act(async()=>root.render(<Probe/>))
beforeEach(async()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});vi.clearAllMocks();f=await marketBuyFixture();enabled=true
  m.account={address:f.snapshot.buyer};m.wallet={name:'wallet-a'};m.client={grpc:{}}
  m.read.mockReset().mockReturnValue(null);m.history.mockReset().mockReturnValue([]);m.queryHistory.mockReset().mockResolvedValue('MISSING')
  m.run.mockReset().mockResolvedValue({...f.record,phase:'SIGNING'});m.headers.mockReset().mockResolvedValue({Authorization:'fixture-auth'})
  m.chainRead.mockReset().mockImplementation(async()=>structuredClone(f.snapshot));m.fetch.mockReset().mockImplementation(()=>{throw new Error('Retired owned API')});vi.stubGlobal('fetch',m.fetch)
  m.confirm.mockReset().mockResolvedValue('COMPLETE')
  m.config.mockReset().mockReturnValue({target:{protocolConfigId:'fixture-release'},buyTarget:{}})
  m.targetConfig.mockReset().mockImplementation(()=>({target:m.config().target}))
  host=document.createElement('div');document.body.appendChild(host);root=createRoot(host)
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();vi.restoreAllMocks()})
it('reads exact buyer/soul quote without signing and starts only on explicit action',async()=>{
  await render();expect(state.canStart).toBe(true);expect(m.run).not.toHaveBeenCalled();expect(m.sign).not.toHaveBeenCalled()
  expect(m.chainRead).toHaveBeenCalledWith(expect.objectContaining({soulId:f.snapshot.soulId,stateId:f.snapshot.stateId,
    buyer:f.snapshot.buyer,listingId:f.snapshot.listingId,config:m.config(),signal:expect.any(AbortSignal)}))
  expect(m.fetch).not.toHaveBeenCalled();expect(m.headers).not.toHaveBeenCalled()
  await act(async()=>{await state.start()});expect(m.run).toHaveBeenCalledWith(expect.objectContaining({start:true,owner:f.snapshot.buyer,soulId:f.snapshot.soulId}))
})
it('does nothing for ordinary checkout scope and never queries unrelated wallets',async()=>{
  enabled=false;await render();expect(m.chainRead).not.toHaveBeenCalled();expect(m.read).not.toHaveBeenCalled()
  expect(state.canStart).toBe(false);await act(async()=>{await state.start()});expect(m.run).not.toHaveBeenCalled()
})
it.each(['gate','paused','wallet'])('does not start a new purchase when %s blocks it',async reason=>{
  if(reason==='gate')f.snapshot.release.writesEnabled=false
  if(reason==='paused')f.snapshot.purchaseAvailable=false
  if(reason==='wallet')m.wallet=null
  await render();expect(state.canStart).toBe(false);await act(async()=>{await state.start()});expect(m.run).not.toHaveBeenCalled()
})
it.each(['buyer','soulId','stateId','priceAtomic','makerSourceRoyaltyBps'])('rejects a mismatched/malformed %s before showing purchasability',async field=>{
  const snapshot={...f.snapshot,[field]:field==='priceAtomic'?'not-price':field==='makerSourceRoyaltyBps'?1001:bid(99)}
  m.chainRead.mockResolvedValue(snapshot);await render();expect(state.snapshot).toBeNull();expect(state.canStart).toBe(false)
  expect(state.error).toBeTruthy();expect(m.sign).not.toHaveBeenCalled()
})
it('keeps signed recovery available when live quote/target is unavailable',async()=>{
  m.read.mockReturnValue({...f.record,phase:'SIGNED',signature:'sig'});m.chainRead.mockRejectedValue(new Error('offline'))
  await render();expect(state.pending).toBe(true);expect(state.canStart).toBe(false)
  await act(async()=>{await state.check()});expect(m.run).toHaveBeenCalledWith(expect.objectContaining({queryOnly:true,start:false}))
  expect(m.adapter.observed).toBeUndefined()
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
it('release change aborts old readiness and cannot restore its Buy action from a late response',async()=>{
  let finish!:(value:any)=>void,signal!:AbortSignal
  m.chainRead.mockImplementationOnce(options=>{signal=options.signal;return new Promise(resolve=>{finish=resolve})})
  await render();expect(state.loading).toBe(true)
  m.config.mockReturnValue({target:{protocolConfigId:'new-release'},buyTarget:{}});f.snapshot.purchaseAvailable=false
  await render();expect(signal.aborted).toBe(true);expect(state.canStart).toBe(false)
  await act(async()=>{finish({...f.snapshot,purchaseAvailable:true});await Promise.resolve()})
  expect(state.snapshot?.purchaseAvailable).toBe(false);expect(state.canStart).toBe(false)
})
it('missing current buying policy fields do not block finalized readback with an exact release target',async()=>{
  const target=m.config().target;m.targetConfig.mockReturnValue({target})
  m.config.mockImplementation(()=>{throw new Error('Current buying policy unavailable')})
  m.read.mockReturnValue({...f.record,phase:'SUCCEEDED',syncStatus:'PENDING'});await render()
  expect(state.canStart).toBe(false);expect(m.chainRead).not.toHaveBeenCalled()
  await act(async()=>{await state.check()})
  await expect(m.adapter.sync({...f.record,phase:'SUCCEEDED',syncStatus:'PENDING'})).resolves.toBe('COMPLETE')
  expect(m.confirm).toHaveBeenCalledWith(expect.objectContaining({digest:f.record.digest}),expect.objectContaining({target}),{client:m.client.grpc})
  expect(m.sign).not.toHaveBeenCalled();expect(m.fetch).not.toHaveBeenCalled()
})
it('restored successful records do not claim current ownership until an explicit current-state check',async()=>{
  m.read.mockReturnValue({...f.record,phase:'SUCCEEDED',syncStatus:'COMPLETE'});await render()
  expect(state.confirmedResult).toBeNull();expect(state.needsRecovery).toBe(true);expect(state.canStart).toBe(true)
  m.run.mockResolvedValue({...f.record,phase:'SUCCEEDED',syncStatus:'SUPERSEDED'})
  await act(async()=>{await state.check()});expect(state.confirmedResult?.syncStatus).toBe('SUPERSEDED')
  expect(m.run).toHaveBeenCalledWith(expect.objectContaining({queryOnly:true}))
})
it('refreshes the public Soul market after verified purchase success',async()=>{
  await render();m.run.mockResolvedValue({...f.record,phase:'SUCCEEDED',syncStatus:'COMPLETE'})
  await act(async()=>{await state.check()})
  expect(m.invalidate).toHaveBeenCalledWith({queryKey:['souls']})
})
it('blocks two synchronous purchase clicks and a concurrent history check',async()=>{
  await render();let finish!:(value:any)=>void;m.run.mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
  let first!:Promise<any>;await act(async()=>{first=state.start();await state.start();await state.checkHistory(f.record.digest)})
  expect(m.run).toHaveBeenCalledOnce();expect(m.queryHistory).not.toHaveBeenCalled()
  await act(async()=>{finish({...f.record,phase:'SIGNING'});await first})
})
it.each(['address','wallet','client','account','release'])('invalidates late results and signing closure after %s changes',async change=>{
  await render();let finish!:(value:any)=>void;m.run.mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
  let first!:Promise<any>;await act(async()=>{first=state.start()});const adapter=m.adapter
  if(change==='address')m.account={address:bid(99)}
  if(change==='wallet')m.wallet={name:'other-wallet'}
  if(change==='client')m.client={grpc:{new:true}}
  if(change==='account')m.account={...m.account}
  if(change==='release')m.config.mockReturnValue({target:{protocolConfigId:'another-release'},buyTarget:{}})
  await render();expect(adapter.getAddress()).toBeNull();expect(()=>adapter.sign({})).toThrow('changed')
  await act(async()=>{finish({...f.record,phase:'SUCCEEDED',syncStatus:'COMPLETE'});expect(await first).toBeNull()})
  expect(state.record).toBeNull();expect(m.invalidate).not.toHaveBeenCalled();expect(m.sign).not.toHaveBeenCalled()
})
it('keeps old wallet closures invalid after switching away and back',async()=>{
  await render();await act(async()=>{await state.start()});const adapter=m.adapter,account=m.account
  m.account={address:bid(99)};await render();m.account=account;await render()
  expect(adapter.getAddress()).toBeNull();expect(()=>adapter.sign({})).toThrow()
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
it('reloads immutable history after retirement and refreshes the current quote without starting again',async()=>{
  m.read.mockReturnValue({...f.record,phase:'SIGNING'});await render();const retired={...f.record,phase:'RETIRED'}
  m.run.mockImplementation(async()=>{m.read.mockReturnValue(retired);m.history.mockReturnValue([retired]);return retired})
  await act(async()=>{await state.retireExpired()});expect(m.run).toHaveBeenCalledWith(expect.objectContaining({retireExpired:true,start:false}))
  expect(state.history).toEqual([retired]);expect(state.pending).toBe(false);expect(state.needsRecovery).toBe(true)
  expect(m.chainRead).toHaveBeenCalledTimes(2);expect(m.sign).not.toHaveBeenCalled()
})
it('queries historical payment without syncing, invalidating the page or replacing the active purchase',async()=>{
  const active={...f.record,digest:'new-digest',phase:'SIGNING'};m.read.mockReturnValue(active)
  m.history.mockReturnValue([{...f.record,phase:'RETIRED'}]);m.queryHistory.mockResolvedValue('SUCCEEDED');await render()
  await act(async()=>{await state.checkHistory(f.record.digest)});expect(state.record).toEqual(active)
  expect(state.historyResults[f.record.digest]).toBe('SUCCEEDED');expect(m.headers).not.toHaveBeenCalled();expect(m.run).not.toHaveBeenCalled();expect(m.invalidate).not.toHaveBeenCalled()
})
it('ignores historical results from a previous wallet session',async()=>{
  m.history.mockReturnValue([{...f.record,phase:'RETIRED'}]);await render()
  let finish!:(value:any)=>void;m.queryHistory.mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
  let first!:Promise<any>;await act(async()=>{first=state.checkHistory(f.record.digest)})
  m.account={address:bid(99)};m.history.mockReturnValue([]);await render()
  await act(async()=>{finish('SUCCEEDED');expect(await first).toBeNull()});expect(state.historyResults).toEqual({})
})
it('reloads only matching cross-tab archive notices and reports damaged storage',async()=>{
  await render();m.history.mockReturnValue([{...f.record,phase:'RETIRED'}])
  const key=`soulidity.market-buy-operation:mainnet:${f.snapshot.soulId}:${f.snapshot.buyer}`
  await act(async()=>window.dispatchEvent(new StorageEvent('storage',{key:`${key}:retired:${f.record.digest}`})))
  expect(state.history).toHaveLength(1)
  m.history.mockImplementation(()=>{throw new Error('Archive damaged')})
  await act(async()=>window.dispatchEvent(new StorageEvent('storage',{key})));expect(state.error).toBe('Archive damaged')
  expect(state.history).toHaveLength(1);expect(m.run).not.toHaveBeenCalled()
})
