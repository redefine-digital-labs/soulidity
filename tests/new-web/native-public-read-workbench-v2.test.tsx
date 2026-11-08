// @vitest-environment jsdom
import React,{act,Suspense} from 'react'
import {createRoot} from 'react-dom/client'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {beforeEach,afterEach,expect,it,vi} from 'vitest'
import {NativePublicReadWorkbenchV2} from '../../web/components/souls/native-public-read-workbench-v2'
import SoulContentReadPage from '../../web/app/souls/[id]/read/page'
import {aid,adigest} from './fixtures/activity-transaction-evidence'
const m=vi.hoisted(()=>({read:vi.fn()}))
vi.mock('../../web/lib/soulidity/native-public-read-record-v2',async importOriginal=>({
 ...await importOriginal<typeof import('../../web/lib/soulidity/native-public-read-record-v2')>(),
 readNativePublicReadOverviewV2:m.read,
}))
vi.mock('../../web/components/souls/native-public-paid-content-reader-v2',()=>({NativePublicPaidContentReaderV2:({soulId,index,paidPreview}:any)=><div data-reader={`${soulId}:${index}`} data-preview={paidPreview?JSON.stringify(paidPreview):undefined}>Protected reader</div>}))
// This overview suite isolates content-reader children; the Grant reader has its own real-component and route contracts.
vi.mock('../../web/components/souls/management-native-grant-reader-v1',()=>({ManagementNativeGrantReaderV1:({index}:any)=><div data-grant-reader={index}>Grant reader</div>}))
vi.mock('next/link',()=>({default:({children,...props}:any)=><a {...props}>{children}</a>}))
vi.mock('../../web/lib/hooks/use-wallet-sign',()=>({useWalletSign:()=>{throw Error('No paid provider: wallet must not be mounted')}}))
const pin={originalPackageId:aid(40),callablePackageId:aid(41),callableDigest:adigest(3)},release=JSON.stringify({chainIdentifier:'35834a8a',standard:pin,native:pin,content:pin,registryId:aid(42),configId:aid(43)})
let host:HTMLDivElement,root:ReturnType<typeof createRoot>,query:QueryClient
const view=()=>({reception:{name:'Original shared Soul'},recordIndices:[0,1],recordSummaries:[{index:0,name:'soul',kind:0,version:'0',readMask:'3',scope:'1',deleted:false,purged:false},{index:1,name:'pet',kind:3,version:'2',readMask:'5',scope:'8',deleted:false,purged:false}],hostReference:{digest:'host'},kioskReference:{digest:'kiosk'},libraryReference:{digest:'lib'},nextRecordStart:null})
async function render(id=aid(20)){await act(async()=>{root.render(<QueryClientProvider client={query}><Suspense fallback="Opening"><NativePublicReadWorkbenchV2 params={Promise.resolve({id})} releaseJson={release}/></Suspense></QueryClientProvider>);await new Promise(r=>setTimeout(r,20))});await act(async()=>{await new Promise(r=>setTimeout(r,20))})}
beforeEach(()=>{vi.stubGlobal('React',React);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);m.read.mockReset();host=document.createElement('div');document.body.append(host);root=createRoot(host);query=new QueryClient({defaultOptions:{queries:{retry:false}}})})
afterEach(async()=>{await act(async()=>root.unmount());query.clear();host.remove();vi.unstubAllGlobals();vi.unstubAllEnvs()})
it('shows authenticated content names/versions and mounts only eligible current protected records on original Soul',async()=>{
 m.read.mockResolvedValue(view());await render();expect(host.textContent).toContain('Original shared Soul');expect(host.textContent).toContain('pet · version 2');expect(host.querySelectorAll('[data-reader]')).toHaveLength(2);expect(host.querySelector('[data-reader]')?.getAttribute('data-reader')).toBe(`${aid(20)}:0`);expect(m.read.mock.calls[0][0].soulId).toBe(aid(20))
})
it('keeps a failed proof visible without mounting a fallback reader',async()=>{m.read.mockRejectedValue(Error('HOST_LINK_MISMATCH'));await render();expect(host.querySelector('[role="alert"]')?.textContent).toContain('HOST_LINK_MISMATCH');expect(host.querySelector('[data-reader]')).toBeNull()})
it('unmounts readers during refresh and scopes a later response to the original asset',async()=>{
 m.read.mockResolvedValueOnce(view());await render();let resolve!:(v:any)=>void;m.read.mockImplementationOnce(()=>new Promise(r=>{resolve=r}))
 await act(async()=>{[...host.querySelectorAll('button')].find(b=>b.textContent==='Refresh content library')!.click();await new Promise(r=>setTimeout(r,10))});expect(host.querySelector('[data-reader]')).toBeNull()
 m.read.mockResolvedValue({...view(),reception:{name:'Second Soul'}});await render(aid(21));await act(async()=>{resolve(view());await new Promise(r=>setTimeout(r,10))});expect(host.textContent).toContain('Second Soul');expect(host.textContent).not.toContain('Original shared Soul');expect(host.querySelector('[data-reader]')?.getAttribute('data-reader')).toBe(`${aid(21)}:0`)
})
it('leaves the actual route disabled without an explicit v2 release configuration',async()=>{vi.stubEnv('NEXT_PUBLIC_SOULIDITY_NATIVE_PUBLIC_READ_V2_TARGET_JSON','');await act(async()=>root.render(<SoulContentReadPage params={Promise.resolve({id:aid(20)})}/>));expect(host.textContent).toContain('unavailable for this release');expect(m.read).not.toHaveBeenCalled()})

it('wires the actual content route to the selected paid Record and the explicit economics release',async()=>{
 vi.stubEnv('NEXT_PUBLIC_SOULIDITY_NATIVE_PUBLIC_READ_V2_TARGET_JSON',release)
 vi.stubEnv('NEXT_PUBLIC_SOULIDITY_NATIVE_ECONOMICS_TARGET_JSON','controlled-economics')
 m.read.mockResolvedValue(view())
 await act(async()=>{root.render(<QueryClientProvider client={query}><SoulContentReadPage params={Promise.resolve({id:aid(20)})}/></QueryClientProvider>);await new Promise(r=>setTimeout(r,20))})
 await act(async()=>{await new Promise(r=>setTimeout(r,20))})
 const records=[...host.querySelectorAll('[data-reader]')]
 expect(records).toHaveLength(2)
 expect(records[0].hasAttribute('data-preview')).toBe(false)
 expect(JSON.parse(records[1].getAttribute('data-preview')!)).toEqual({kind:3,scope:'8',economicsJson:'controlled-economics'})
})
