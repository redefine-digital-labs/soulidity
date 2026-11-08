// @vitest-environment jsdom
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {makerProductIncomeControllerFixture} from '../fixtures/maker-product-income'
import {createRootMakerProductIncomeController} from '../../../web/lib/soulidity/commerce/maker-product-income-controller'
import {makerProductIncomeOperationFromOriginal,makerProductIncomeFundKey} from '../../../web/lib/soulidity/maker-product-income-journal'
import {MakerProductIncomeRecoveryWorkbench} from '../../../web/components/commerce/maker-product-income-recovery'
let node:HTMLDivElement,root:ReturnType<typeof createRoot>
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('Uint8Array',structuredClone(new Uint8Array()).constructor);localStorage.clear();const held=new Set<string>();Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(k:string,_o:any,work:any)=>{if(held.has(k))return work(null);held.add(k);try{return await work({})}finally{held.delete(k)}}}});node=document.createElement('div');document.body.append(node);root=createRoot(node)})
afterEach(async()=>{await act(async()=>root.unmount());node.remove();vi.restoreAllMocks();vi.unstubAllGlobals()})
const wait=async(check:()=>boolean)=>{for(let i=0;i<150;i++){if(check())return;await act(async()=>{await new Promise(r=>setTimeout(r,10))})}throw Error(node.textContent||'UI_WAIT')}
const click=async(label:string)=>{await act(async()=>{[...node.querySelectorAll('button')].find(x=>x.textContent===label)!.click();await new Promise(r=>setTimeout(r,20))})}
it('observed source A-B-A cannot revive an old resume completion',async()=>{
 const x=await makerProductIncomeControllerFixture(),selected=await makerProductIncomeOperationFromOriginal(x.originalText);localStorage.setItem(makerProductIncomeFundKey(x.target),JSON.stringify(selected));let current=true,entered=false,release!:()=>void;const gate=new Promise<void>(r=>release=r)
 const actual=createRootMakerProductIncomeController({installations:[x.installation],executionModels:x.executionModels,client:()=>x.client,isCurrent:()=>current})
 const controller={...actual,resume:async(input:any)=>{const value=await actual.resume(input);entered=true;await gate;return value}}
 const render=async()=>{await act(async()=>root.render(<MakerProductIncomeRecoveryWorkbench controller={controller} viewerAddress={x.actor}/>))}
 await render();await wait(()=>!!node.querySelector('[aria-label="选定 Product 原件"]'));await click('重新模拟 Product 原字节');await wait(()=>entered)
 current=false;await render();current=true;await render();await act(async()=>{release();await new Promise(r=>setTimeout(r,30))})
 expect(node.textContent).not.toContain('原字节模拟核对完成')
})
it('a late file read cannot replace a subsequently selected retained original',async()=>{
 const x=await makerProductIncomeControllerFixture(),other=await makerProductIncomeControllerFixture(2),selected=await makerProductIncomeOperationFromOriginal(x.originalText);localStorage.setItem(makerProductIncomeFundKey(x.target),JSON.stringify(selected));await act(async()=>root.render(<MakerProductIncomeRecoveryWorkbench controller={x.controller} viewerAddress={x.actor}/>));await wait(()=>!!node.querySelector('[aria-label="选定 Product 原件"]'))
 let release!:()=>void;const gate=new Promise<void>(r=>release=r),file={size:other.originalText.length,text:async()=>{await gate;return other.originalText}}
 await act(async()=>{const input=node.querySelector('input[type=file]')!;Object.defineProperty(input,'files',{configurable:true,value:[file]});input.dispatchEvent(new Event('change',{bubbles:true}))})
 await act(async()=>{[...node.querySelectorAll('button')].find(b=>b.textContent?.startsWith('选择 Product '))!.click()})
 await act(async()=>{release();await new Promise(r=>setTimeout(r,30))})
 const href=node.querySelector('a[download]')!.getAttribute('href')!;expect(decodeURIComponent(href.slice(href.indexOf(',')+1))).toBe(x.originalText)
})
