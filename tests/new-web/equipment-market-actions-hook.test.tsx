// @vitest-environment jsdom
import React,{act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {beforeEach,afterEach,expect,it,vi} from 'vitest'
import {useEquipmentMarketActions} from '../../web/lib/hooks/use-equipment-market-actions'
import {equipmentMarketOperationFixture,emid} from './fixtures/equipment-market-operation'

const m=vi.hoisted(()=>({account:null as any,wallet:{} as any,client:{} as any,run:vi.fn(),read:vi.fn(),history:vi.fn(),
  queryHistory:vi.fn(),sign:vi.fn(),chainRead:vi.fn(),confirm:vi.fn(),config:vi.fn(),invalidate:vi.fn(),adapter:null as any}))
vi.mock('@mysten/dapp-kit',()=>({useCurrentAccount:()=>m.account,useCurrentWallet:()=>({currentWallet:m.wallet}),
  useSuiClient:()=>m.client,useSignTransaction:()=>({mutateAsync:m.sign})}))
vi.mock('@tanstack/react-query',()=>({useQueryClient:()=>({invalidateQueries:m.invalidate})}))
vi.mock('../../web/lib/animacraft/browser-native-equipment-market-read',()=>({getBrowserNativeEquipmentMarketConfig:m.config,readBrowserEquipmentMarketOperation:m.chainRead}))
vi.mock('../../web/lib/animacraft/browser-equipment-market-readback',()=>({confirmBrowserEquipmentMarketOperation:m.confirm}))
vi.mock('../../web/lib/animacraft/equipment-market-operation-store',()=>({browserEquipmentMarketOperationStore:()=>({read:m.read,history:m.history}),
  runEquipmentMarketOperation:m.run,queryEquipmentMarketHistory:m.queryHistory}))
vi.mock('../../web/lib/animacraft/equipment-market-operation-adapter',async original=>({
  ...await original<typeof import('../../web/lib/animacraft/equipment-market-operation-adapter')>(),
  createEquipmentMarketOperationAdapter:(params:any)=>{m.adapter=params;return params},
}))
let root:Root,host:HTMLDivElement,state:ReturnType<typeof useEquipmentMarketActions>,f:Awaited<ReturnType<typeof equipmentMarketOperationFixture>>
let params:Parameters<typeof useEquipmentMarketActions>[0]
function Probe(){state=useEquipmentMarketActions(params);return <span>{String(state.canStart)}</span>}
const render=()=>act(async()=>root.render(<Probe/>))
beforeEach(async()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});vi.clearAllMocks()
  f=await equipmentMarketOperationFixture();params={request:f.request,identityKey:'item:1',action:'list',priceAtomic:'10001'}
  m.account={address:f.actor};m.wallet={name:'a'};m.client={grpc:{}}
  m.read.mockReset().mockReturnValue(null);m.history.mockReset().mockReturnValue([]);m.queryHistory.mockReset().mockResolvedValue('MISSING')
  m.run.mockReset().mockResolvedValue({...f.record,phase:'SIGNING'});m.chainRead.mockReset().mockResolvedValue(f.snapshot)
  m.config.mockReset().mockReturnValue({target:f.target});m.confirm.mockReset().mockResolvedValue('COMPLETE')
  host=document.createElement('div');document.body.appendChild(host);root=createRoot(host)
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks()})
it('reviews only the selected instance and requires an explicit start',async()=>{
  await render();expect(state.canStart).toBe(true);expect(m.run).not.toHaveBeenCalled()
  await act(async()=>{await state.start()})
  expect(m.run).toHaveBeenCalledWith(expect.objectContaining({itemId:f.itemId,actor:f.actor,start:true}))
  expect(m.adapter.observed).toEqual(f.snapshot);expect(m.adapter.priceAtomic).toBe('10001');expect(m.sign).not.toHaveBeenCalled()
})
it.each(['39','01','18446744073709551616','1.0'])('blocks invalid price %s',async price=>{
  params.priceAtomic=price;await render();expect(state.canStart).toBe(false)
  await act(async()=>{await state.start()});expect(m.run).not.toHaveBeenCalled()
})
it('does not read or act as another wallet',async()=>{
  m.account={address:emid(999)};await render();expect(state.canStart).toBe(false);expect(m.chainRead).not.toHaveBeenCalled()
  await act(async()=>{await state.check()});expect(m.run).not.toHaveBeenCalled()
})
it('rejects a different selected item',async()=>{
  params.request={...f.request,itemId:emid(999)};await render();expect(state.snapshot).toBeNull();expect(state.error).toContain('selected item')
})
it('recovers and synchronizes the saved release without current configuration',async()=>{
  m.read.mockReturnValue({...f.record,phase:'SIGNED',signature:'saved'});m.config.mockImplementation(()=>{throw new Error('Unavailable')})
  await render();expect(state.pending).toBe(true);expect(state.canStart).toBe(false)
  await act(async()=>{await state.check()});expect(m.run).toHaveBeenCalledWith(expect.objectContaining({queryOnly:true,start:false}))
  expect(m.adapter.observed).toBeUndefined()
  await expect(m.adapter.sync({...f.record,phase:'SUCCEEDED'})).resolves.toBe('COMPLETE')
  expect(m.confirm).toHaveBeenCalledWith(expect.objectContaining({snapshot:f.snapshot}),expect.objectContaining({signal:expect.any(AbortSignal)}),{client:m.client.grpc})
})
it.each(['wallet','account','client','identity','price'])('revokes a stale signer after %s ABA',async kind=>{
  await render();await act(async()=>{await state.start()});const old=m.adapter
  const saved={wallet:m.wallet,account:m.account,client:m.client,params:{...params}}
  if(kind==='wallet')m.wallet={name:'b'}
  if(kind==='account')m.account={...m.account}
  if(kind==='client')m.client={grpc:{other:true}}
  if(kind==='identity')params={...params,identityKey:'item:2'}
  if(kind==='price')params={...params,priceAtomic:'500'}
  await render();Object.assign(m,{wallet:saved.wallet,account:saved.account,client:saved.client});params=saved.params;await render()
  expect(old.getAddress()).toBeNull();expect(()=>old.sign({})).toThrow('changed');await expect(old.sync(f.record)).rejects.toThrow('changed')
})
it('serializes repeated start and history clicks',async()=>{
  await render();let finish!:(v:unknown)=>void;m.run.mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
  let pending!:Promise<unknown>;await act(async()=>{pending=state.start();await state.start();await state.checkHistory(f.record.digest)})
  expect(m.run).toHaveBeenCalledOnce();expect(m.queryHistory).not.toHaveBeenCalled()
  await act(async()=>{finish(f.record);await pending})
})
it('refreshes all equipment views only on confirmed success',async()=>{
  m.run.mockResolvedValue({...f.record,phase:'SUCCEEDED'});await render();await act(async()=>{await state.start()})
  for(const key of ['soul','my-souls','souls','native-equipment','native-equipment-source','native-equipment-pack'])
    expect(m.invalidate).toHaveBeenCalledWith({queryKey:[key]})
})
