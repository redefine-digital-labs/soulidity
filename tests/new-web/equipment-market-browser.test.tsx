// @vitest-environment jsdom
import React,{act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {beforeEach,afterEach,expect,it,vi} from 'vitest'
import {EquipmentMarketBrowser} from '../../web/components/souls/equipment-market-browser'
import {equipmentMarketOperationFixture,emid} from './fixtures/equipment-market-operation'
import {readEquipmentMarketListingSnapshot} from '../../web/lib/animacraft/native-equipment-market-read'
const m=vi.hoisted(()=>({source:null as any,selected:null as any}))
vi.mock('../../web/lib/hooks/use-public-market',()=>({usePublicEquipmentMarketSource:()=>m.source}))
vi.mock('../../web/components/souls/equipment-market-panel',()=>({EquipmentMarketPanel:(props:any)=>{m.selected=props;return <p>Selected transaction review</p>}}))
vi.mock('../../web/components/souls/equipment-market-recovery',()=>({EquipmentMarketRecovery:()=>null}))
let root:Root,host:HTMLDivElement,f:Awaited<ReturnType<typeof equipmentMarketOperationFixture>>
const render=()=>act(async()=>root.render(<EquipmentMarketBrowser/>))
const button=(label:string)=>[...host.querySelectorAll('button')].find(b=>b.textContent===label)!
beforeEach(async()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});f=await equipmentMarketOperationFixture({action:'buy'});m.selected=null
  const listing=await readEquipmentMarketListingSnapshot(f.client,f.target,f.marketPin,{rootId:f.rootId,listingId:f.listingId,actor:f.actor})
  m.source={page:{listings:[listing],verifiedCandidates:1},coverage:'COMPLETE',viewerAddress:f.actor,identityKey:'scope',
    progress:{busy:false,pages:1},error:null,pause:vi.fn(),resume:vi.fn(),refresh:vi.fn()}
  host=document.createElement('div');document.body.appendChild(host);root=createRoot(host)
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove()})
it('opens exactly the selected listing purchase without starting a transaction',async()=>{
  await render();expect(m.selected).toBeNull();expect(host.textContent).toContain(f.itemId)
  await act(async()=>button('Review component purchase').click())
  expect(m.selected).toMatchObject({action:'buy',request:{actor:f.actor,rootId:f.rootId,itemId:f.itemId,kind:'base',listingId:f.listingId}})
})
it('shows seller controls instead of buying the seller’s own asset',async()=>{
  m.source.viewerAddress=f.owner;m.source.page.listings[0].cancelAvailable=true
  await render();expect(button('Review component purchase')).toBeUndefined()
  await act(async()=>button('Review price change').click());expect(m.selected.action).toBe('reprice')
  await act(async()=>button('Review cancellation').click());expect(m.selected.action).toBe('cancel')
})
it('keeps anonymous browsing readable while requiring a wallet for purchase',async()=>{
  m.source.viewerAddress=null;m.source.page.listings[0].buyAvailable=false;await render()
  expect(host.textContent).toContain(f.itemId);expect(button('Review component purchase').disabled).toBe(true)
})
it('does not describe incomplete empty results as an empty market',async()=>{
  m.source.page.listings=[];m.source.coverage='PARTIAL';m.source.error=new Error('Retry retained page');await render()
  expect(host.textContent).toContain('No matching listings verified yet');expect(host.textContent).toContain('Retry retained page')
  expect(host.textContent).not.toContain('No matching open component listings.')
})
it('removes the previous wallet’s transaction panel after switching accounts',async()=>{
  await render();await act(async()=>button('Review component purchase').click());m.source.viewerAddress=emid(999);await render()
  expect(host.textContent).not.toContain('Selected transaction review')
})
