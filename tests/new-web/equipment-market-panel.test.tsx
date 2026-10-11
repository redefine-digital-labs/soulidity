// @vitest-environment jsdom
import React,{act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {beforeEach,afterEach,expect,it,vi} from 'vitest'
import {EquipmentMarketPanel} from '../../web/components/souls/equipment-market-panel'
import {equipmentMarketOperationFixture,emid} from './fixtures/equipment-market-operation'
const m=vi.hoisted(()=>({params:null as any,state:null as any}))
vi.mock('../../web/lib/hooks/use-equipment-market-actions',()=>({useEquipmentMarketActions:(params:any)=>{m.params=params;return m.state}}))
let root:Root,host:HTMLDivElement,f:Awaited<ReturnType<typeof equipmentMarketOperationFixture>>,blocked:boolean
beforeEach(async()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});f=await equipmentMarketOperationFixture({equipped:true});blocked=false
  m.state={snapshot:f.snapshot,record:null,history:[],historyResults:{},error:null,loading:false,busy:false,pending:false,canStart:true,
    start:vi.fn().mockResolvedValue(null),check:vi.fn().mockResolvedValue(null),resume:vi.fn().mockResolvedValue(null),
    refresh:vi.fn().mockResolvedValue(null),cancelUnsigned:vi.fn().mockResolvedValue(null),retireExpired:vi.fn().mockResolvedValue(null)}
  host=document.createElement('div');document.body.appendChild(host);root=createRoot(host)
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove()})
const render=()=>act(async()=>root.render(<EquipmentMarketPanel request={f.request} identityKey="wardrobe" blocked={blocked}/>))
const button=(label:string)=>[...host.querySelectorAll('button')].find(b=>b.textContent===label)!
async function amount(value:string){await act(async()=>{
  const input=host.querySelector('input')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value)
  input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))
})}
it('reviews exactly one component, its fee and partial removal before explicit signing',async()=>{
  await render();expect(m.state.start).not.toHaveBeenCalled();expect(button('Sign · List selected component').disabled).toBe(true)
  await amount('1');expect(m.params.priceAtomic).toBe('1000000000')
  expect(host.textContent).toContain(f.itemId);expect(host.textContent).toContain('Platform fee (2.5%): 0.025')
  expect(host.textContent).toContain('seller receives 0.975');expect(host.textContent).toContain('Other selections and the Soul binding remain unchanged')
  await act(async()=>button('Sign · List selected component').click());expect(m.state.start).toHaveBeenCalledOnce()
})
it.each(['pending','busy','blocked','mismatch','invalid price'])('does not sign with %s',async reason=>{
  if(reason==='pending')m.state.pending=true
  if(reason==='busy')m.state.busy=true
  if(reason==='blocked')blocked=true
  if(reason==='mismatch')m.state.snapshot={...f.snapshot,asset:{...f.snapshot.asset,itemId:emid(999)}}
  await render();await amount(reason==='invalid price'?'0.000000001':'1')
  expect(button('Sign · List selected component').disabled).toBe(true)
  await act(async()=>button('Sign · List selected component').click());expect(m.state.start).not.toHaveBeenCalled()
})
it('retains saved packet recovery when current read fails and price is empty',async()=>{
  m.state.snapshot=null;m.state.error='Read unavailable';m.state.record={...f.record,phase:'SIGNED'};m.state.pending=true
  await render();expect(host.textContent).toContain(f.record.digest);expect(host.textContent).toContain('not the current price field')
  await act(async()=>button('Check saved component transaction').click());expect(m.state.check).toHaveBeenCalledOnce()
  await act(async()=>button('Resume saved component transaction').click());expect(m.state.resume).toHaveBeenCalledOnce()
  await act(async()=>button('Check expiry and archive component transaction').click());expect(m.state.retireExpired).toHaveBeenCalledOnce()
  expect(host.textContent).not.toContain('Discard unsigned component transaction')
})
it('does not label pending current-state readback as ownership success',async()=>{
  m.state.record={...f.record,phase:'SUCCEEDED',syncStatus:'PENDING'};await render()
  expect(host.textContent).toContain('readback: PENDING');expect(host.textContent).toContain('Historical success does not prove current ownership')
})
