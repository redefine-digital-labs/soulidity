// @vitest-environment jsdom
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {beforeEach,afterEach,expect,it,vi} from 'vitest'
import {PurchaseRecoveryFunds} from '../../web/components/commerce/purchase-recovery-funds'
import {purchaseRecoveryFundsFixture} from './fixtures/commerce-purchase-recovery-funds'
import {parsePurchaseRecoveryOriginal} from '../../web/lib/soulidity/commerce/purchase-recovery-original'
const queued=vi.hoisted(()=>({enabled:false,actions:[] as Array<()=>void>}))
// Deterministically delay React functional-updater evaluation/replay; no proof
// or state-machine function is mocked. Event/abort/serial guards remain actual.
vi.mock('react',async importOriginal=>{const actual=await importOriginal<typeof import('react')>();return {...actual,useState:(initial:any)=>{const [state,set]=actual.useState(initial);return [state,(action:any)=>{if(queued.enabled&&typeof action==='function'){queued.actions.push(()=>set(action));return}set(action)}]}}})
let host:HTMLDivElement,root:ReturnType<typeof createRoot>
beforeEach(()=>{queued.enabled=false;queued.actions=[];vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('Uint8Array',structuredClone(new Uint8Array()).constructor);host=document.createElement('div');document.body.append(host);root=createRoot(host)})
afterEach(async()=>{queued.enabled=false;queued.actions=[];await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()})
async function click(label:string){await act(async()=>{[...host.querySelectorAll('button')].find(b=>b.textContent===label)!.click();await new Promise(r=>setTimeout(r,30))})}
async function setup(){const x=await purchaseRecoveryFundsFixture('v2'),record=await parsePurchaseRecoveryOriginal(x.text,x.soulId);await act(async()=>root.render(<PurchaseRecoveryFunds original={x.proof} record={record} client={x.client}/>));return x}
async function flush(){const actions=queued.actions.splice(0);expect(actions.length).toBeGreaterThan(0);await act(async()=>{actions.forEach(f=>f());await Promise.resolve()})}
it.each([false,true])('queued old address result cannot publish after stop, new query=%s',async startNew=>{
 const x=await setup(),read=x.client.stateService.getBalance.getMockImplementation()!;let finish!:()=>void,finishNew!:()=>void
 x.client.stateService.getBalance.mockImplementationOnce(async(...a:any[])=>{await new Promise<void>(r=>finish=r);return read(...a)})
 await act(async()=>{const s=host.querySelector('select')!;s.value=x.first.owner;s.dispatchEvent(new Event('change',{bubbles:true}))});await click('查询所选地址当前资金')
 await act(async()=>{queued.enabled=true;finish();await new Promise(r=>setTimeout(r,30))});queued.enabled=false
 expect(host.querySelector('[aria-label="当前单币种余额"]')).toBeNull();await click('停止当前资金查询')
 if(startNew){x.client.stateService.getBalance.mockImplementationOnce(async(...a:any[])=>{await new Promise<void>(r=>finishNew=r);return read(...a)});await click('查询所选地址当前资金')}
 await flush();expect(host.querySelector('[aria-label="当前单币种余额"]')).toBeNull()
 if(startNew){expect(host.textContent).toContain('正在查询 Coin 与地址余额');await act(async()=>{finishNew();await new Promise(r=>setTimeout(r,30))});expect(host.querySelector('[aria-label="当前单币种余额"]')).not.toBeNull()}
 else expect(host.textContent).toContain('当前资金查询已停止')
})
it('queued original-pinned protocol income cannot publish after stopping that query',async()=>{
 const x=await setup(),read=x.client.ledgerService.getObject.getMockImplementation()!,configId=x.original.context.economics.configId;let finish!:()=>void,first=true
 x.client.ledgerService.getObject.mockImplementation(async(r:any,o:any)=>{if(first&&r.objectId===configId&&r.version===undefined){first=false;await new Promise<void>(resolve=>finish=resolve)}return read(r,o)})
 await click('查询当前协议收入');await act(async()=>{queued.enabled=true;finish();await new Promise(r=>setTimeout(r,30))});queued.enabled=false
 expect(host.textContent).not.toContain('当前协议账本余额（最小单位）');await click('停止协议收入查询');await flush();expect(host.textContent).not.toContain('当前协议账本余额（最小单位）');expect(host.textContent).toContain('本次协议收入查询已停止')
 await click('查询当前协议收入');expect(host.textContent).toContain('当前协议账本余额（最小单位）：3')
})
