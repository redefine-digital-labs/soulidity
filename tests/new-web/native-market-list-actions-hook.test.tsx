// @vitest-environment jsdom
import React,{act,startTransition,Suspense,StrictMode,useLayoutEffect} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {beforeEach,afterEach,expect,it,vi} from 'vitest'
import {useNativeMarketListActions} from '../../web/lib/hooks/use-native-market-list-actions'
import {marketListFixture,lid as bid} from './fixtures/market-list-operation'
import type {NativeMarketListSnapshot} from '../../web/lib/animacraft/market-list-types'
const m=vi.hoisted(()=>({account:null as any,wallet:{} as any,client:{} as any,run:vi.fn(),read:vi.fn(),history:vi.fn(),
  queryHistory:vi.fn(),sign:vi.fn(),headers:vi.fn(),chainRead:vi.fn(),confirm:vi.fn(),config:vi.fn(),targetConfig:vi.fn(),fetch:vi.fn(),invalidate:vi.fn(),adapter:null as any}))
vi.mock('../../web/lib/animacraft/browser-native-market-read',()=>({getBrowserNativeMarketConfig:m.config,getBrowserNativeMarketCancelConfig:m.targetConfig,readBrowserNativeMarketList:m.chainRead}))
vi.mock('../../web/lib/animacraft/browser-native-market-readback',()=>({confirmBrowserNativeMarketList:m.confirm}))
vi.mock('@mysten/dapp-kit',()=>({useCurrentAccount:()=>m.account,useCurrentWallet:()=>({currentWallet:m.wallet}),
  useSuiClient:()=>m.client,useSignTransaction:()=>({mutateAsync:m.sign})}))
vi.mock('@tanstack/react-query',()=>({useQueryClient:()=>({invalidateQueries:m.invalidate})}))
vi.mock('../../web/components/providers/auth-provider',()=>({useAuth:()=>({getAuthHeaders:m.headers})}))
vi.mock('../../web/lib/animacraft/market-list-operation',async original=>({
  ...await original<typeof import('../../web/lib/animacraft/market-list-operation')>(),
  browserMarketListOperationStore:()=>({read:m.read,history:m.history}),runMarketListOperation:m.run,queryMarketListHistory:m.queryHistory,
}))
vi.mock('../../web/lib/animacraft/market-list-operation-adapter',()=>({createMarketListOperationAdapter:(params:any)=>{m.adapter=params;return params}}))
let host:HTMLDivElement,root:Root,state:ReturnType<typeof useNativeMarketListActions>,snapshot:NativeMarketListSnapshot,record:any,enabled=true
let scope:{soulId:string;stateId:string;listingId:string|null}
const never=new Promise<void>(()=>{})
function Probe({suspend=false,onLayout}:{suspend?:boolean;onLayout?:()=>void}){
  state=useNativeMarketListActions(enabled?scope:null)
  useLayoutEffect(()=>{onLayout?.()})
  if(suspend)throw never
  return <span>{String(state.canList)}</span>
}
const render=()=>act(async()=>root.render(<Probe/>))
beforeEach(async()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});vi.clearAllMocks();const f=await marketListFixture({priceAtomic:'10001'});enabled=true
  snapshot=f.snapshot
  // The operation engine and adapter are isolated here; their actual byte/signature
  // validation has separate SDK tests. This fixture exercises hook journal/session UI.
  record=f.record
  scope={soulId:snapshot.soulId,stateId:snapshot.stateId,listingId:null}
  m.account={address:snapshot.owner};m.wallet={name:'wallet-a'};m.client={grpc:{}}
  m.read.mockReset().mockReturnValue(null);m.history.mockReset().mockReturnValue([]);m.queryHistory.mockReset().mockResolvedValue('MISSING')
  m.run.mockReset().mockResolvedValue({...record,phase:'SIGNING'});m.headers.mockReset().mockResolvedValue({Authorization:'fixture-auth'})
  m.chainRead.mockReset().mockImplementation(async()=>structuredClone(snapshot));m.fetch.mockReset().mockImplementation(()=>{throw new Error('Retired owned API')});vi.stubGlobal('fetch',m.fetch)
  m.confirm.mockReset().mockResolvedValue('COMPLETE')
  m.config.mockReset().mockReturnValue({target:{protocolConfigId:'fixture-release'},buyTarget:{}})
  m.targetConfig.mockReset().mockImplementation(()=>({target:m.config().target}))
  host=document.createElement('div');document.body.appendChild(host);root=createRoot(host)
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();vi.restoreAllMocks()})
it('reads held LIST readiness without signing and starts only with explicit price and intent',async()=>{
  await render();expect(state.canList).toBe(true);expect(state.canReprice).toBe(false);expect(m.run).not.toHaveBeenCalled()
  expect(m.chainRead).toHaveBeenCalledWith(expect.objectContaining({soulId:snapshot.soulId,stateId:snapshot.stateId,
    config:m.config(),signal:expect.any(AbortSignal)}))
  expect(m.fetch).not.toHaveBeenCalled();expect(m.headers).not.toHaveBeenCalled()
  await act(async()=>{await state.start(10001n,'list')})
  expect(m.run).toHaveBeenCalledWith(expect.objectContaining({start:true,owner:snapshot.owner,soulId:snapshot.soulId}))
  expect(m.adapter).toMatchObject({intent:'list',priceAtomic:10001n,observed:snapshot});expect(m.sign).not.toHaveBeenCalled()
})
it.each([true,false])('requires equipment write permission for an equipped Soul: %s',async writesEnabled=>{
  snapshot=(await marketListFixture({equipped:true})).snapshot
  snapshot.equipmentSale!.writesEnabled=writesEnabled
  await render();expect(state.canList).toBe(writesEnabled)
  await act(async()=>{await state.start(10001n,'list')})
  expect(m.run).toHaveBeenCalledTimes(writesEnabled?1:0)
  if(writesEnabled)expect(m.adapter.observed.equipmentSale).toEqual(snapshot.equipmentSale)
})
it('reads without a wallet but never starts or restores another owner journal',async()=>{
  m.account=null;m.wallet=null;await render();expect(state.snapshot).toEqual(snapshot);expect(state.error).toBeNull()
  expect(state.canList).toBe(false);expect(m.read).not.toHaveBeenCalled()
  await act(async()=>{await state.start(10001n,'list');await state.resume();await state.checkHistory(record.digest)})
  expect(m.run).not.toHaveBeenCalled();expect(m.queryHistory).not.toHaveBeenCalled()
})
it('allows a different current owner as readonly metadata, not signing authority',async()=>{
  m.account={address:bid(99)};await render();expect(state.snapshot).toEqual(snapshot);expect(state.error).toBeNull();expect(state.canList).toBe(false)
})
it('passes actual listing and saved cap lookup hints for atomic REPRICE',async()=>{
  snapshot={...snapshot,listed:true,listingId:bid(80),priceAtomic:'9999',listAvailable:false,repriceAvailable:true};scope.listingId=bid(80)
  await render();expect(state.canReprice).toBe(true);expect(state.canList).toBe(false)
  await act(async()=>{await state.start(20000n,'reprice')});expect(m.adapter).toMatchObject({intent:'reprice',priceAtomic:20000n})
  await m.adapter.read(bid(81),bid(70))
  const request=m.chainRead.mock.calls.at(-1)![0]
  expect(request.listingId).toBe(bid(81));expect(request.kioskCapId).toBe(bid(70));expect(request).not.toHaveProperty('owner')
})
it('does nothing for ordinary Soul scope',async()=>{
  enabled=false;await render();await act(async()=>{await state.start(10001n,'list')})
  expect(m.chainRead).not.toHaveBeenCalled();expect(m.read).not.toHaveBeenCalled();expect(m.run).not.toHaveBeenCalled()
})
it.each(['gate','unavailable','wallet','intent'])('does not start when %s blocks it',async reason=>{
  if(reason==='gate')snapshot.release.writesEnabled=false
  if(reason==='unavailable')snapshot.listAvailable=false
  if(reason==='wallet')m.wallet=null
  await render();await act(async()=>{await state.start(10001n,reason==='intent'?'reprice':'list')});expect(m.run).not.toHaveBeenCalled()
})
it.each(['soulId','stateId','schema','royalty'])('rejects malformed or misbound snapshot %s',async field=>{
  const wrong={...snapshot,[field==='royalty'?'makerSourceRoyaltyBps':field]:field==='schema'?'wrong':field==='royalty'?1001:bid(99)}
  m.chainRead.mockResolvedValue(wrong);await render();expect(state.snapshot).toBeNull();expect(state.canList).toBe(false);expect(state.error).toBeTruthy()
})
it('keeps signed recovery when live snapshot fails or current owner/listing has changed',async()=>{
  m.read.mockReturnValue({...record,phase:'SIGNED',signature:'sig'});m.chainRead.mockRejectedValue(new Error('offline'))
  await render();expect(state.pending).toBe(true);expect(state.canList).toBe(false)
  await act(async()=>{await state.check()});expect(m.run).toHaveBeenCalledWith(expect.objectContaining({queryOnly:true,start:false}))
  expect(m.adapter.observed).toBeUndefined();expect(m.adapter.intent).toBeUndefined();expect(m.adapter.priceAtomic).toBeUndefined()
})
it('missing current config blocks readiness but not same-digest signed recovery or history',async()=>{
  m.config.mockImplementation(()=>{throw new Error('Public release config missing')})
  m.read.mockReturnValue({...record,phase:'SIGNED',signature:'sig'});await render()
  expect(state.pending).toBe(true);expect(state.canList).toBe(false);expect(state.error).toContain('config missing')
  expect(m.chainRead).not.toHaveBeenCalled()
  await act(async()=>{await state.check();await state.checkHistory(record.digest)})
  expect(m.run).toHaveBeenCalledWith(expect.objectContaining({queryOnly:true,start:false}))
  expect(m.queryHistory).toHaveBeenCalled();expect(m.confirm).not.toHaveBeenCalled();expect(m.fetch).not.toHaveBeenCalled()
})
it('release change aborts old readiness and cannot restore its List action from a late response',async()=>{
  let finish!:(value:any)=>void,signal!:AbortSignal
  m.chainRead.mockImplementationOnce(options=>{signal=options.signal;return new Promise(resolve=>{finish=resolve})})
  await render();expect(state.loading).toBe(true)
  m.config.mockReturnValue({target:{protocolConfigId:'new-release'},buyTarget:{}});snapshot.listAvailable=false
  await render();expect(signal.aborted).toBe(true);expect(state.canList).toBe(false)
  await act(async()=>{finish({...snapshot,listAvailable:true});await Promise.resolve()})
  expect(state.snapshot?.listAvailable).toBe(false);expect(state.canList).toBe(false)
})
it('missing current market policy fields do not block finalized readback with an exact release target',async()=>{
  const target=m.config().target;m.targetConfig.mockReturnValue({target})
  m.config.mockImplementation(()=>{throw new Error('Current market policy unavailable')})
  m.read.mockReturnValue({...record,phase:'SUCCEEDED',syncStatus:'PENDING'});await render()
  expect(state.canList).toBe(false);expect(m.chainRead).not.toHaveBeenCalled()
  await act(async()=>{await state.check()})
  await expect(m.adapter.sync({...record,phase:'SUCCEEDED',syncStatus:'PENDING'})).resolves.toBe('COMPLETE')
  expect(m.confirm).toHaveBeenCalledWith(expect.objectContaining({digest:record.digest}),expect.objectContaining({target}),{client:m.client.grpc})
  expect(m.sign).not.toHaveBeenCalled();expect(m.fetch).not.toHaveBeenCalled()
})
it('recovers the original owner journal despite a later owner, pause and disabled new writes',async()=>{
  m.read.mockReturnValue({...record,phase:'SIGNED',signature:'sig'})
  snapshot={...snapshot,owner:bid(99),listAvailable:false,release:{...snapshot.release,writesEnabled:false}}
  await render();expect(state.snapshot?.owner).toBe(bid(99));expect(state.pending).toBe(true);expect(state.canList).toBe(false)
  await act(async()=>{await state.resume()});expect(m.run).toHaveBeenCalledWith(expect.objectContaining({start:false,owner:record.snapshot.owner}))
})
it('forwards explicit unsigned cancellation without starting or signing',async()=>{
  m.read.mockReturnValue(record);await render()
  await act(async()=>{await state.cancelUnsigned()});expect(m.run).toHaveBeenCalledWith(expect.objectContaining({start:false,cancelUnsigned:true}))
  expect(m.sign).not.toHaveBeenCalled()
})
it('never turns a restored success into confirmed completion without explicit readback',async()=>{
  m.read.mockReturnValue({...record,phase:'SUCCEEDED',syncStatus:'COMPLETE'});await render()
  expect(state.confirmedResult).toBeNull();expect(state.needsRecovery).toBe(true);expect(state.canList).toBe(true)
  m.run.mockResolvedValue({...record,phase:'SUCCEEDED',syncStatus:'SUPERSEDED'})
  await act(async()=>{await state.check()});expect(state.confirmedResult?.syncStatus).toBe('SUPERSEDED')
})
it('serializes clicks across LIST/REPRICE/recovery/history in the same session',async()=>{
  await render();let finish!:(value:any)=>void;m.run.mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
  let first!:Promise<any>;await act(async()=>{first=state.start(10001n,'list');await state.start(20000n,'reprice');await state.resume();await state.checkHistory(record.digest)})
  expect(m.run).toHaveBeenCalledOnce();expect(m.queryHistory).not.toHaveBeenCalled()
  await act(async()=>{finish({...record,phase:'SIGNING'});await first})
})
it.each(['address','wallet','client','account','listing','state','release'])('invalidates late completion and signer after %s changes',async change=>{
  await render();let finish!:(value:any)=>void;m.run.mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
  let first!:Promise<any>;await act(async()=>{first=state.start(10001n,'list')});const adapter=m.adapter
  if(change==='address')m.account={address:bid(99)}
  if(change==='wallet')m.wallet={name:'other-wallet'}
  if(change==='client')m.client={grpc:{new:true}}
  if(change==='account')m.account={...m.account}
  if(change==='listing')scope={...scope,listingId:bid(81)}
  if(change==='state')scope={...scope,stateId:bid(99)}
  if(change==='release')m.config.mockReturnValue({target:{protocolConfigId:'another-release'},buyTarget:{}})
  await render();expect(adapter.getAddress()).toBeNull();expect(()=>adapter.sign({})).toThrow('changed')
  await act(async()=>{finish({...record,phase:'SUCCEEDED',syncStatus:'COMPLETE'});expect(await first).toBeNull()})
  expect(state.confirmedResult).toBeNull();expect(m.invalidate).not.toHaveBeenCalled();expect(m.sign).not.toHaveBeenCalled()
})
it('invalidates old closures after account ABA',async()=>{
  await render();await act(async()=>{await state.start(10001n,'list')});const adapter=m.adapter,account=m.account
  m.account={address:bid(99)};await render();m.account=account;await render()
  expect(adapter.getAddress()).toBeNull();expect(()=>adapter.sign({})).toThrow()
})
it('keeps committed capabilities and requests alive when a replacement render suspends and is abandoned',async()=>{
  await act(async()=>root.render(<Suspense fallback={<span>waiting</span>}><Probe/></Suspense>))
  await act(async()=>{await state.start(10001n,'list')})
  const adapter=m.adapter,account=m.account
  let finish!:(value:any)=>void,signal!:AbortSignal
  m.chainRead.mockImplementationOnce(options=>{signal=options.signal;return new Promise(resolve=>{finish=resolve})})
  const pending=adapter.read()
  m.account={address:bid(99)}
  await act(async()=>{startTransition(()=>root.render(<Suspense fallback={<span>waiting</span>}><Probe suspend/></Suspense>))})
  expect(signal.aborted).toBe(false);expect(adapter.getAddress()).toBe(account.address)
  m.account=account
  await act(async()=>root.render(<Suspense fallback={<span>waiting</span>}><Probe/></Suspense>))
  await act(async()=>{finish(snapshot);await expect(pending).resolves.toEqual(snapshot)})
  expect(adapter.getAddress()).toBe(account.address)
})
it('revokes the old signer in the replacement layout commit before passive effects',async()=>{
  await render();await act(async()=>{await state.start(10001n,'list')})
  const adapter=m.adapter,oldRefresh=state.refresh
  m.account={...m.account}
  let checked=false
  await act(async()=>root.render(<Probe onLayout={()=>{
    checked=true
    expect(adapter.getAddress()).toBeNull();expect(()=>adapter.sign({})).toThrow('changed')
  }}/>))
  expect(checked).toBe(true)
  // A retained event handler from the revoked scope cannot clear the new quote.
  const currentSnapshot=state.snapshot
  await act(async()=>oldRefresh())
  expect(state.snapshot).toBe(currentSnapshot)
  expect(m.sign).not.toHaveBeenCalled()
})
it('never revives a lease from StrictMode layout cleanup/setup replay',async()=>{
  const adapters:any[]=[],operations:Promise<any>[]=[]
  const finishes:((value:any)=>void)[]=[]
  m.run.mockImplementation(()=>new Promise(resolve=>{finishes.push(resolve)}))
  await act(async()=>root.render(<StrictMode><Probe onLayout={()=>{
    if(adapters.length<2){operations.push(state.check());adapters.push(m.adapter)}
  }}/></StrictMode>))
  expect(adapters).toHaveLength(2)
  expect(adapters[0]).not.toBe(adapters[1])
  expect(adapters[0].getAddress()).toBeNull();expect(()=>adapters[0].sign({})).toThrow('changed')
  expect(adapters[1].getAddress()).toBe(snapshot.owner)
  await act(async()=>{finishes[0]({...record,phase:'SUCCEEDED',syncStatus:'COMPLETE'});expect(await operations[0]).toBeNull()})
  expect(state.confirmedResult).toBeNull();expect(state.busy).toBe(true);expect(m.invalidate).not.toHaveBeenCalled()
  await act(async()=>{finishes[1]({...record,phase:'SIGNING'});await operations[1]})
})
it('rejects a signature that resolves after its captured lease is revoked',async()=>{
  await render();await act(async()=>{await state.start(10001n,'list')})
  const adapter=m.adapter
  let finish!:(value:any)=>void
  m.sign.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
  const signing=adapter.sign({}),rejected=expect(signing).rejects.toThrow('changed during signature')
  m.wallet={name:'new-wallet'};await render()
  finish({bytes:'old-bytes',signature:'old-signature'});await rejected
})
it('confirms the exact saved operation through browser proof with no auth or owned API',async()=>{
  await render();await act(async()=>{await state.start(10001n,'list')})
  await expect(m.adapter.sync(record)).resolves.toBe('COMPLETE')
  expect(m.confirm).toHaveBeenCalledWith(record,expect.objectContaining({target:m.config().target,signal:expect.any(AbortSignal)}),{client:m.client.grpc})
  expect(m.fetch).not.toHaveBeenCalled();expect(m.headers).not.toHaveBeenCalled()
  const invalid=new Error('Exact receipt mismatch');m.confirm.mockRejectedValueOnce(invalid)
  await expect(m.adapter.sync(record)).rejects.toBe(invalid)
})
it('keeps transient readback errors retryable and accepts only proved supersession from the verifier',async()=>{
  await render();await act(async()=>{await state.start(10001n,'list')})
  m.confirm.mockResolvedValueOnce('SUPERSEDED');await expect(m.adapter.sync(record)).resolves.toBe('SUPERSEDED')
  for(const code of ['OBJECT_UNAVAILABLE','NATIVE_EQUIPMENT_CHANGED','NATIVE_MARKET_INVALID']) {
    const error=new Error(code);m.confirm.mockRejectedValueOnce(error);await expect(m.adapter.sync(record)).rejects.toBe(error)
  }
})
it.each(['wallet','release'])('cancels late current-state confirmation after %s changes',async change=>{
  await render();await act(async()=>{await state.start(10001n,'list')});const adapter=m.adapter
  let finish!:(value:any)=>void,signal!:AbortSignal
  m.confirm.mockImplementation((_record,options)=>{signal=options.signal;return new Promise(resolve=>{finish=resolve})})
  const first=adapter.sync(record),rejected=expect(first).rejects.toBeTruthy()
  if(change==='wallet')m.wallet={name:'new'}
  else m.config.mockReturnValue({target:{protocolConfigId:'different-release'},buyTarget:{}})
  await render();await rejected;expect(signal.aborted).toBe(true)
  finish('COMPLETE');await Promise.resolve();expect(adapter.getAddress()).toBeNull()
  expect(m.fetch).not.toHaveBeenCalled();expect(m.headers).not.toHaveBeenCalled()
})
it('bounds a noncooperative readback promise and ignores its late success',async()=>{
  await render();await act(async()=>{await state.start(10001n,'list')})
  const controller=new AbortController();vi.spyOn(AbortSignal,'timeout').mockReturnValue(controller.signal)
  let finish!:(value:any)=>void;m.confirm.mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
  const second=m.adapter.sync(record),timed=expect(second).rejects.toThrow('readback timeout')
  await vi.waitFor(()=>expect(m.confirm).toHaveBeenCalledOnce())
  controller.abort(new Error('readback timeout'));await timed;finish('COMPLETE');await Promise.resolve()
  expect(m.fetch).not.toHaveBeenCalled();expect(m.headers).not.toHaveBeenCalled()
})
it('archives expiry and refreshes readiness without a new signature',async()=>{
  m.read.mockReturnValue({...record,phase:'SIGNING'});await render();const retired={...record,phase:'RETIRED'}
  m.run.mockImplementation(async()=>{m.read.mockReturnValue(retired);m.history.mockReturnValue([retired]);return retired})
  await act(async()=>{await state.retireExpired()});expect(m.run).toHaveBeenCalledWith(expect.objectContaining({retireExpired:true,start:false}))
  expect(state.history).toEqual([retired]);expect(state.pending).toBe(false);expect(state.needsRecovery).toBe(true)
  expect(m.chainRead).toHaveBeenCalledTimes(2);expect(m.sign).not.toHaveBeenCalled()
})
it('queries history without syncing or replacing active operation',async()=>{
  const active={...record,digest:'new-digest',phase:'SIGNING'};m.read.mockReturnValue(active)
  m.history.mockReturnValue([{...record,phase:'RETIRED'}]);m.queryHistory.mockResolvedValue('SUCCEEDED');await render()
  await act(async()=>{await state.checkHistory(record.digest)})
  expect(state.record).toEqual(active);expect(state.historyResults[record.digest]).toBe('SUCCEEDED')
  expect(m.headers).not.toHaveBeenCalled();expect(m.run).not.toHaveBeenCalled();expect(m.invalidate).not.toHaveBeenCalled()
})
it('ignores late history results from a previous session',async()=>{
  m.history.mockReturnValue([{...record,phase:'RETIRED'}]);await render()
  let finish!:(value:any)=>void;m.queryHistory.mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
  let first!:Promise<any>;await act(async()=>{first=state.checkHistory(record.digest)})
  m.account={address:bid(99)};m.history.mockReturnValue([]);await render()
  await act(async()=>{finish('SUCCEEDED');expect(await first).toBeNull()});expect(state.historyResults).toEqual({})
})
it('storage reload clears current confirmation and preserves damaged history evidence',async()=>{
  await render();m.run.mockResolvedValue({...record,phase:'SUCCEEDED',syncStatus:'COMPLETE'})
  await act(async()=>{await state.check()});expect(state.confirmedResult).not.toBeNull()
  const key=`soulidity.market-list-operation:mainnet:${snapshot.soulId}:${snapshot.owner}`
  m.read.mockReturnValue({...record,phase:'SUCCEEDED',syncStatus:'COMPLETE'});m.history.mockReturnValue([{...record,phase:'RETIRED'}])
  await act(async()=>window.dispatchEvent(new StorageEvent('storage',{key:`${key}:retired:${record.digest}`})))
  expect(state.history).toHaveLength(1);expect(state.confirmedResult).toBeNull()
  m.history.mockImplementation(()=>{throw new Error('Archive damaged')})
  await act(async()=>window.dispatchEvent(new StorageEvent('storage',{key})));expect(state.error).toBe('Archive damaged');expect(state.history).toHaveLength(1)
})
it('refreshes the public Soul market after verified listing success',async()=>{
  await render();m.run.mockResolvedValue({...record,phase:'SUCCEEDED',syncStatus:'COMPLETE'})
  await act(async()=>{await state.check()})
  expect(m.invalidate).toHaveBeenCalledWith({queryKey:['souls']})
})
it('clears confirmation when a new listing becomes the same Soul scope',async()=>{
  await render();m.run.mockResolvedValue({...record,phase:'SUCCEEDED',syncStatus:'COMPLETE'})
  await act(async()=>{await state.check()});expect(state.confirmedResult).not.toBeNull()
  scope={...scope,listingId:bid(81)};await render();expect(state.confirmedResult).toBeNull()
})
it('does not retain stale readiness or completion after an explicit failed refresh',async()=>{
  await render();m.run.mockResolvedValue({...record,phase:'SUCCEEDED',syncStatus:'COMPLETE'})
  await act(async()=>{await state.check()});expect(state.confirmedResult).not.toBeNull()
  m.chainRead.mockRejectedValue(new Error('read unavailable'));await act(async()=>state.refresh())
  expect(state.snapshot).toBeNull();expect(state.confirmedResult).toBeNull();expect(state.canList).toBe(false)
  expect(state.needsRecovery).toBe(true)
})
it('cleans in-flight requests and invalidates the signing closure when its scope unmounts',async()=>{
  await render();await act(async()=>{await state.start(10001n,'list')});const adapter=m.adapter
  let signal!:AbortSignal
  m.chainRead.mockImplementation((options)=>new Promise((_resolve,reject)=>{
    signal=options.signal;signal.addEventListener('abort',()=>reject(signal.reason),{once:true})
  }))
  const read=adapter.read(),rejected=expect(read).rejects.toBeTruthy()
  enabled=false;await render();await rejected
  expect(signal.aborted).toBe(true);expect(adapter.getAddress()).toBeNull();expect(()=>adapter.sign({})).toThrow('changed')
})
