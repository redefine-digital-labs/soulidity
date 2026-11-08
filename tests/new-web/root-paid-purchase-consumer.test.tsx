// @vitest-environment jsdom
import React,{act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {NativePublicReadPaidPurchaseV2,type NativePublicReadPaidPurchaseSelectionV2} from '../../web/components/souls/native-public-read-paid-purchase-v2'
import {completePreflightFixture} from './fixtures/commerce-new-paid-preflight'
import {browserNativePublicReadPaidJournalV2,nativePublicReadPaidKeyV2} from '../../web/lib/soulidity/native-public-read-paid-journal-v2'
import {aid} from './fixtures/activity-transaction-evidence'
const wallet=vi.hoisted(()=>({value:null as any,read:vi.fn()}))
vi.mock('../../web/lib/hooks/use-wallet-sign',()=>({useWalletSign:()=>{wallet.read();return wallet.value}}))
// Controlled RPC fixture already supplies authenticated package BCS. Transport
// enrichment is independently tested; this suite keeps all business code real.
vi.mock('../../web/lib/sui/package-object-client',()=>({withPackageObjectIdentity:(client:unknown)=>client}))
let container:HTMLDivElement,root:Root
beforeEach(()=>{
 vi.stubGlobal('React',React);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('Uint8Array',structuredClone(new Uint8Array()).constructor)
 window.localStorage.clear();wallet.read.mockClear();container=document.createElement('div');document.body.append(container);root=createRoot(container)
 const held=new Set<string>();Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(name:string,_options:unknown,work:(lock:unknown)=>unknown)=>{if(held.has(name))return work(null);held.add(name);try{return await work({name})}finally{held.delete(name)}}}})
})
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();vi.unstubAllGlobals()})
async function fixture(buyer?:string){
 const x=await completePreflightFixture('',buyer);x.client.ledgerService.getTransaction=vi.fn(async()=>{throw {code:'NOT_FOUND'}});x.client.ledgerService.getCheckpoint=vi.fn(async()=>{throw Error('UNEXPECTED_CHECKPOINT')})
 wallet.value={suiWallet:{address:x.buyer},suiGrpcClient:x.client,signTransaction:vi.fn(async()=>{throw Error('SIGN_FORBIDDEN')}),signAndExecute:vi.fn(async()=>{throw Error('SUBMIT_FORBIDDEN')})}
 const {client,signal,...qualification}=x.input.qualification,{getBuyerAddress,...rest}=x.input
 const selection:NativePublicReadPaidPurchaseSelectionV2={sourceKey:'verified-record-reference',activationKey:'controlled-review-only',disabledReason:null,input:structuredClone({...rest,qualification})}
 const props={soulId:x.params.soulId,index:x.params.recordIndex,kind:x.params.kind,contentScope:String(x.params.requiredScope),releaseJson:JSON.stringify(x.params.target),sourceKey:selection.sourceKey,selection:selection as NativePublicReadPaidPurchaseSelectionV2|null}
 const render=async()=>act(async()=>root.render(<NativePublicReadPaidPurchaseV2 {...props}/>))
 const click=async(twice=false)=>act(async()=>{const b=container.querySelector('button')!;b.click();if(twice)b.click();await new Promise(r=>setTimeout(r,80))})
 return {x,props,selection,render,click}
}
function exported(){const a=container.querySelector('a[download]');return a?decodeURIComponent(a.getAttribute('href')!.split(',').slice(1).join(',')):null}
it('actual consumer binds real Root Host to140 and double click produces one durable original and one full simulation',async()=>{
 const f=await fixture();await f.render();await f.click(true)
 expect(container.textContent).toContain('原记录返回核对与模拟已完成')
 const key=nativePublicReadPaidKeyV2({chainIdentifier:'35834a8a',soulId:f.x.params.soulId,author:f.x.buyer}),record=await browserNativePublicReadPaidJournalV2().read(key)
 expect(exported()).toBe(record?.plan.originalText);expect(f.x.client.transactionExecutionService.simulateTransaction).toHaveBeenCalledOnce()
 expect(wallet.value.signTransaction).not.toHaveBeenCalled();expect(wallet.value.signAndExecute).not.toHaveBeenCalled();expect(container.querySelector('button')!.disabled).toBe(true)
})
it('no reviewed provider leaves the actual consumer unavailable without mounting a wallet or constructing a Host request',async()=>{
 const f=await fixture();f.props.selection=null;await f.render();expect(container.textContent).toContain('尚未开放');expect(container.querySelector('button')).toBeNull();expect(wallet.read).not.toHaveBeenCalled()
 expect(window.localStorage.length).toBe(0);expect(f.x.client.transactionExecutionService.simulateTransaction).not.toHaveBeenCalled()
})
it.each(['sourceKey','soul','index','kind','scope','target','activation','release','wallet'] as const)('does not run the Host when current %s binding is missing or stale',async variant=>{
 const f=await fixture()
 if(variant==='sourceKey')f.props.sourceKey='newer-reference'
 if(variant==='soul')f.props.soulId=aid(999)
 if(variant==='index')f.props.index++
 if(variant==='kind')f.props.kind++
 if(variant==='scope')f.props.contentScope='8'
 if(variant==='target')f.props.releaseJson=JSON.stringify({...f.x.params.target,registryId:aid(999)})
 if(variant==='activation')f.selection.activationKey=''
 if(variant==='release')f.selection.disabledReason='当前发布尚未完成源码核验。'
 if(variant==='wallet')wallet.value.suiWallet.address=aid(999)
 await f.render();expect(container.querySelector('button')!.disabled).toBe(true);await f.click();expect(window.localStorage.length).toBe(0);expect(f.x.client.transactionExecutionService.simulateTransaction).not.toHaveBeenCalled();expect(exported()).toBeNull()
})
it('cold remount exposes the parsed existing original as recovery without another preparation or simulation',async()=>{
 const f=await fixture();await f.render();await f.click();const text=exported(),calls=f.x.client.core.getMoveFunction.mock.calls.length
 await act(async()=>{root.unmount();root=createRoot(container)});await f.render();await f.click()
 expect(container.textContent).toContain('已读回原操作记录');expect(container.textContent).not.toContain('原记录返回核对与模拟已完成');expect(exported()).toBe(text)
 expect(f.x.client.core.getMoveFunction.mock.calls.length).toBe(calls);expect(f.x.client.transactionExecutionService.simulateTransaction).toHaveBeenCalledOnce()
})
it('failed actual simulation still offers the parsed retained original and disables automatic retry',async()=>{
 const f=await fixture();f.x.client.transactionExecutionService.simulateTransaction.mockRejectedValue(Error('SIMULATION_UNAVAILABLE'));await f.render();await f.click()
 expect(container.textContent).toContain('SIMULATION_UNAVAILABLE');expect(container.textContent).toContain('下载原购买 JSON');expect(exported()).not.toBeNull();expect(container.querySelector('button')!.disabled).toBe(true)
 await f.click();expect(f.x.client.transactionExecutionService.simulateTransaction).toHaveBeenCalledOnce()
})

it('the actual purchase consumer requests a separate wallet action only with a qualified Root execution capability',async()=>{
 const {Ed25519Keypair}=await import('@mysten/sui/keypairs/ed25519')
 const {toBase64}=await import('@mysten/sui/utils')
 const signer=Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(83)),f=await fixture(signer.toSuiAddress())
 const key=nativePublicReadPaidKeyV2({chainIdentifier:'35834a8a',soulId:f.x.params.soulId,author:f.x.buyer})
 const read=()=>browserNativePublicReadPaidJournalV2().read(key)
 const qualifySource=vi.fn(async()=>{})
 f.selection.execution={isCurrent:()=>true,qualifySource}
 wallet.value.getWalletAddress=()=>f.x.buyer
 wallet.value.signTransaction.mockImplementation(async(tx,options)=>{
  expect(options).toEqual({retainReturnedSignature:true})
  expect((await read())?.packet.phase).toBe('SIGNING')
  return signer.signTransaction(await tx.build())
 })
 f.x.client.core.executeTransaction=vi.fn(async request=>{
  const saved=(await read())!
  expect(saved.packet.phase).toBe('SIGNED')
  expect(toBase64(request.transaction)).toBe(saved.packet.bytes)
  expect(request.signatures).toEqual([saved.packet.signature])
 })
 await f.render();await f.click()
 expect(wallet.value.signTransaction).not.toHaveBeenCalled()
 expect(f.x.client.core.executeTransaction).not.toHaveBeenCalled()
 const button=[...container.querySelectorAll('button')].find(button=>button.textContent?.trim()==='核对并签名发送原购买')!
 await act(async()=>{button.click();button.click()})
 for(let i=0;i<80&&!container.textContent?.includes('本次未查到原结果');i++){
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,25))})
 }
 expect(container.textContent).toContain('本次未查到原结果')
 expect(wallet.value.signTransaction).toHaveBeenCalledOnce()
 expect(f.x.client.core.executeTransaction).toHaveBeenCalledOnce()
 expect(qualifySource).toHaveBeenCalledTimes(2)
 expect(exported()).toBe((await read())!.plan.originalText)
})
