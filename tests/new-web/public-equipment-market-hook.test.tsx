// @vitest-environment jsdom
import React,{act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {beforeEach,afterEach,expect,it,vi} from 'vitest'
import {usePublicEquipmentMarketSource} from '../../web/lib/hooks/use-public-market'
import {equipmentMarketOperationFixture} from './fixtures/equipment-market-operation'
const m=vi.hoisted(()=>({account:null as any,wallet:{} as any,client:{grpc:{}} as any,config:null as any,create:vi.fn(),sessions:[] as any[]}))
vi.mock('@mysten/dapp-kit',()=>({useCurrentAccount:()=>m.account,useCurrentWallet:()=>({currentWallet:m.wallet}),useSuiClient:()=>m.client}))
vi.mock('../../web/lib/soulidity/browser-soul-detail',()=>({getBrowserSoulDetailConfig:()=>m.config}))
vi.mock('../../web/lib/animacraft/browser-equipment-market-discovery',()=>({createBrowserEquipmentMarketDiscovery:m.create}))
let root:Root,host:HTMLDivElement,query:QueryClient,state:ReturnType<typeof usePublicEquipmentMarketSource>
function Probe(){state=usePublicEquipmentMarketSource();return <span>{state.coverage}</span>}
const render=()=>act(async()=>root.render(<QueryClientProvider client={query}><Probe/></QueryClientProvider>))
const settle=()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,20))})
const page={listings:[],candidateStatus:'COMPLETE',source:{checkpoint:100},verifiedCandidates:0,notAuthorization:true}
beforeEach(async()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});const f=await equipmentMarketOperationFixture()
  m.account=null;m.wallet={};m.client={grpc:{}};m.sessions=[]
  m.config={native:f.target,discoveryEndpoint:'https://graphql.mainnet.sui.io/graphql',chainIdentifier:'35834a8a',paymentCoinType:f.coin}
  m.create.mockReset().mockImplementation(params=>{const session={params,next:vi.fn().mockResolvedValue(page)};m.sessions.push(session);return session})
  query=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});host=document.createElement('div');document.body.appendChild(host);root=createRoot(host)
})
afterEach(async()=>{await act(async()=>root.unmount());query.clear();host.remove()})
it('runs anonymously and joins the original public-market invalidation prefix',async()=>{
  await render();await settle();expect(state.coverage).toBe('COMPLETE');expect(m.sessions[0].params.actor).toBeNull()
  await act(async()=>{await query.invalidateQueries({queryKey:['souls']})});await settle()
  expect(m.create).toHaveBeenCalledTimes(2);expect(m.sessions[0].params.signal.aborted).toBe(true)
})
it('replaces the scanner when wallet identity changes',async()=>{
  await render();await settle();const old=m.sessions[0];m.wallet={name:'new'};await render();await settle()
  expect(old.params.signal.aborted).toBe(true);expect(m.create).toHaveBeenCalledTimes(2)
})
it('retains partial data and retries the same scanner after a page error',async()=>{
  m.create.mockImplementation(params=>{const session={params,next:vi.fn().mockResolvedValueOnce({...page,candidateStatus:'PARTIAL'})
    .mockRejectedValueOnce(new Error('page offline')).mockResolvedValue(page)};m.sessions.push(session);return session})
  await render();await settle();expect(state.coverage).toBe('PARTIAL');expect(state.error?.message).toBe('page offline')
  await act(async()=>{await state.resume()});await settle();expect(state.coverage).toBe('COMPLETE');expect(m.create).toHaveBeenCalledOnce()
})
it('fails closed on missing equipment release without starting a scan',async()=>{
  delete m.config.native.equipmentMarket;await render();await settle();expect(state.error?.message).toContain('configuration unavailable')
  expect(m.create).not.toHaveBeenCalled()
})
