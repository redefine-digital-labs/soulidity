// @vitest-environment jsdom
import React,{act,Suspense} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import PurchaseRecoveryPage from '../../web/app/souls/[id]/purchase/recovery/page'
import {NativePublicReadPaidOriginalRecoveryV2} from '../../web/components/commerce/native-public-read-paid-original-recovery'
import {createNativePublicReadPaidHostPreflightV2} from '../../web/lib/soulidity/native-public-read-paid-host-v2'
import {browserNativePublicReadPaidJournalV2,nativePublicReadPaidKeyV2,nativePublicReadPaidRecordFromOriginalV2} from '../../web/lib/soulidity/native-public-read-paid-journal-v2'
import {completePreflightFixture} from './fixtures/commerce-new-paid-preflight'
import {purchaseRecoveryFixture} from './fixtures/commerce-purchase-recovery-original'
const transport=vi.hoisted(()=>({client:null as any,make:vi.fn()}))
vi.mock('../../web/lib/soulidity/native-public-read-paid-original-client-v2',()=>({createNativePublicReadPaidOriginalClientV2:(signal:AbortSignal)=>{transport.make(signal);return transport.client}}))
vi.mock('../../web/lib/hooks/use-wallet-sign',()=>({useWalletSign:()=>({suiWallet:null,suiGrpcClient:null,getWalletAddress:()=>null})}))
let container:HTMLDivElement,root:Root
beforeEach(()=>{
 vi.stubGlobal('React',React);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('Uint8Array',structuredClone(new Uint8Array()).constructor);window.localStorage.clear();transport.make.mockClear()
 container=document.createElement('div');document.body.append(container);root=createRoot(container)
 const held=new Set<string>();Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(k:string,_o:unknown,work:(lock:unknown)=>unknown)=>{if(held.has(k))return work(null);held.add(k);try{return await work({name:k})}finally{held.delete(k)}}}})
 vi.stubEnv('NEXT_PUBLIC_SOULIDITY_NATIVE_PUBLIC_READ_V2_TARGET_JSON','')
})
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.unstubAllEnvs();vi.unstubAllGlobals()})
const wait=async(value:string)=>{for(let i=0;i<100;i++){if(container.textContent?.includes(value))return;await act(async()=>{await new Promise(r=>setTimeout(r,10))})}throw Error('UI_EXPECTED '+value+' '+container.textContent)}
const click=async(label:string,twice=false)=>act(async()=>{const button=[...container.querySelectorAll('button')].find(b=>b.textContent===label)!;button.click();if(twice)button.click();await new Promise(r=>setTimeout(r,20))})
const exported=()=>{const a=container.querySelector('[aria-label="已核验本机原操作"] a[download]');return a?decodeURIComponent(a.getAttribute('href')!.split(',').slice(1).join(',')):null}
async function fixture(){
 const x=await completePreflightFixture();x.client.ledgerService.getTransaction=vi.fn(async()=>{throw {code:'NOT_FOUND'}});x.client.ledgerService.getCheckpoint=vi.fn(async()=>{throw Error('UNEXPECTED_CHECKPOINT')});x.client.transactionExecutionService.simulateTransaction.mockRejectedValue(Error('CONTROLLED_SIMULATION_FAILURE'))
 const failure=await createNativePublicReadPaidHostPreflightV2()(x.input).catch(e=>e),record=await nativePublicReadPaidRecordFromOriginalV2(failure.recovery.text,x.params.soulId),key=nativePublicReadPaidKeyV2(record.plan)
 transport.client={ledgerService:x.client.ledgerService};return {...x,failure,record,key,pageParams:Promise.resolve({id:x.params.soulId})}
}
it('actual recovery page cold-discovers unexported local original after full simulation failure with no paid provider/release/wallet, while file import remains',async()=>{
 const x=await fixture(),calls=x.client.core.getMoveFunction.mock.calls.length
 await act(async()=>root.render(<Suspense fallback="Opening"><PurchaseRecoveryPage params={x.pageParams}/></Suspense>));await wait('本机保存阶段：PREPARED')
 expect(exported()).toBe(x.failure.recovery.text);expect(container.querySelector('input[type=file]')).not.toBeNull();expect(transport.make).not.toHaveBeenCalled()
 await click('查询本机原操作历史',true);await wait('付款结果仍未知');expect(transport.make).toHaveBeenCalledOnce();expect(x.client.core.getMoveFunction.mock.calls.length).toBe(calls)
 expect(x.client.transactionExecutionService.simulateTransaction).toHaveBeenCalledOnce();expect(exported()).toBe(x.failure.recovery.text)
 await act(async()=>{root.unmount();root=createRoot(container)});await act(async()=>root.render(<Suspense fallback="Opening"><PurchaseRecoveryPage params={x.pageParams}/></Suspense>));await wait('本机保存阶段：PREPARED')
 expect(exported()).toBe(x.failure.recovery.text);expect(transport.make).toHaveBeenCalledOnce();expect(x.client.transactionExecutionService.simulateTransaction).toHaveBeenCalledOnce()
})
it('local view/download/query remain available without WebLocks while cancellation is disabled',async()=>{
 const x=await fixture();Object.defineProperty(navigator,'locks',{configurable:true,value:undefined});await act(async()=>root.render(<NativePublicReadPaidOriginalRecoveryV2 soulId={x.params.soulId}/>));await wait('本机保存阶段：PREPARED')
 expect(exported()).toBe(x.failure.recovery.text);expect([...container.querySelectorAll('button')].find(b=>b.textContent==='核对并取消本机未签名准备')!.disabled).toBe(true)
 await click('查询本机原操作历史');await wait('付款结果仍未知');expect(exported()).toBe(x.failure.recovery.text)
})
it('invalid imported file cannot hide the independently retained local original or its recovery controls',async()=>{
 const x=await fixture();await act(async()=>root.render(<Suspense fallback="Opening"><PurchaseRecoveryPage params={x.pageParams}/></Suspense>));await wait('本机保存阶段：PREPARED')
 await act(async()=>{const input=container.querySelector('input[type=file]')!;Object.defineProperty(input,'files',{configurable:true,value:[{name:'invalid.json',size:2,text:async()=>'{}'}]});input.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,20))})
 await wait('原购买格式不受本入口支持');expect(exported()).toBe(x.failure.recovery.text)
 expect(container.querySelector('[aria-label="原购买恢复"] a[download]')).toBeNull();await click('查询本机原操作历史');await wait('付款结果仍未知');expect(exported()).toBe(x.failure.recovery.text)
})
it('eligible explicit cancel uses original MISSING and updates metadata while keeping raw original downloadable and no new preflight',async()=>{
 const x=await fixture();await act(async()=>root.render(<NativePublicReadPaidOriginalRecoveryV2 soulId={x.params.soulId}/>));await wait('本机保存阶段：PREPARED')
 await click('核对并取消本机未签名准备',true);await wait('本机保存阶段：CANCELLED')
 expect(exported()).toBe(x.failure.recovery.text);expect((await browserNativePublicReadPaidJournalV2().read(x.key))?.packet.phase).toBe('CANCELLED');expect(transport.make).toHaveBeenCalledOnce();expect(x.client.transactionExecutionService.simulateTransaction).toHaveBeenCalledOnce()
})
it('actual partial subscription result is visible without claiming permission or cancelling the local original',async()=>{
 const x=await purchaseRecoveryFixture('v2'),record=await nativePublicReadPaidRecordFromOriginalV2(x.text,x.soulId),journal=browserNativePublicReadPaidJournalV2(),key=nativePublicReadPaidKeyV2(record.plan);await journal.exclusive(key,()=>journal.write(key,record));transport.client=x.client
 await act(async()=>root.render(<NativePublicReadPaidOriginalRecoveryV2 soulId={x.soulId}/>));await wait('本机保存阶段：PREPARED');await click('查询本机原操作历史');await wait('尚未证明完整业务成功或当前内容可读')
 expect(exported()).toBe(x.text);await click('核对并取消本机未签名准备');await wait('ORIGINAL_RESULT_NOT_MISSING');expect((await journal.read(key))?.packet.phase).toBe('PREPARED');expect(exported()).toBe(x.text)
})
it('a stopped late original query never replaces the cold-discovered original or reports a late result',async()=>{
 const x=await fixture();let finish!:()=>void,entered!:()=>void;const began=new Promise<void>(r=>entered=r)
 x.client.ledgerService.getTransaction.mockImplementation(async()=>{entered();await new Promise<void>(r=>finish=r);throw {code:'NOT_FOUND'}})
 await act(async()=>root.render(<NativePublicReadPaidOriginalRecoveryV2 soulId={x.params.soulId}/>));await wait('本机保存阶段：PREPARED');await click('查询本机原操作历史');await began
 await click('停止本次原记录操作');await act(async()=>{finish();await new Promise(r=>setTimeout(r,30))});expect(container.textContent).not.toContain('付款结果仍未知');expect(exported()).toBe(x.failure.recovery.text)
})
