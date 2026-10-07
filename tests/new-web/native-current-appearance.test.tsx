// @vitest-environment jsdom
import React,{act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {NativeCurrentAppearance} from '../../web/components/souls/native-current-appearance'
import {SoulCoverImage} from '../../web/components/souls/soul-cover-image'
const m=vi.hoisted(()=>({read:vi.fn(),render:vi.fn(),original:vi.fn()}))
vi.mock('../../web/lib/animacraft/browser-native-artwork',()=>({getBrowserNativeArtworkConfig:()=>({target:{}}),readBrowserNativeEquipmentRenderTarget:m.read,readBrowserNativeArtwork:m.original}))
vi.mock('../../web/lib/animacraft/native-equipment-render-client',()=>({renderNativeEquipmentScene:m.render}))
let host:HTMLDivElement,root:Root,queries:QueryClient
const revoke=vi.fn(),create=vi.fn()
const scene=()=>({soulId:'soul',stateId:'state',owner:'owner',ownershipEpoch:'1',status:'AVAILABLE',scene:{layers:[]}})
beforeEach(()=>{
  vi.clearAllMocks();m.original.mockResolvedValue({status:'PUBLIC',blob:new Blob(['original'],{type:'image/png'})});m.read.mockResolvedValue(scene());m.render.mockResolvedValue(new Blob(['png'],{type:'image/png'}))
  create.mockReturnValue('blob:current');class ImageURL extends URL{static createObjectURL=create;static revokeObjectURL=revoke}
  vi.stubGlobal('URL',ImageURL);Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
  queries=new QueryClient();host=document.createElement('div');document.body.appendChild(host);root=createRoot(host)
})
afterEach(async()=>{await act(async()=>root.unmount());queries.clear();host.remove();vi.unstubAllGlobals()})
async function show(owner='owner'){await act(async()=>root.render(<QueryClientProvider client={queries}>
  <NativeCurrentAppearance soulId="soul" stateId="state" owner={owner} ownershipEpoch="1"/>
</QueryClientProvider>))}
it('automatically renders the public current scene without any wallet hook or original image',async()=>{
  await show();expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:current')
  expect(m.render).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({publicOnly:true}))
})
it.each(['EMPTY','NOT_CREATED'])('does not substitute original artwork for %s',async status=>{
  m.read.mockResolvedValue({...scene(),status});await show()
  expect(host.querySelector('img')).toBeNull();expect(m.render).not.toHaveBeenCalled();expect(host.textContent).toContain('No ')
})
it('does not partially render or request access to a protected appearance',async()=>{
  m.read.mockResolvedValue({...scene(),scene:{layers:[{protected:true}]}});await show()
  expect(host.textContent).toContain('authorized Wardrobe');expect(m.render).not.toHaveBeenCalled()
})
it('clears a prior picture when Wardrobe refetch confirms empty equipment',async()=>{
  await show();m.read.mockResolvedValue({...scene(),status:'EMPTY'})
  await act(async()=>{queries.setQueryData(['native-equipment','soul','state'],{revision:'2'})})
  expect(host.querySelector('img')).toBeNull();expect(revoke).toHaveBeenCalledWith('blob:current')
  expect(host.textContent).toContain('No items equipped')
})
it('rejects stale ownership and clears the previous owner image',async()=>{
  await show();await show('new-owner')
  expect(host.querySelector('img')).toBeNull();expect(host.textContent).toContain('unavailable')
  expect(m.render).toHaveBeenCalledTimes(1)
})
it('retries a failed appearance without activating its enclosing card link',async()=>{
  m.read.mockRejectedValueOnce(new Error('offline'));const navigate=vi.fn()
  await act(async()=>root.render(<QueryClientProvider client={queries}><div onClick={navigate}>
    <NativeCurrentAppearance soulId="soul" stateId="state" owner="owner" ownershipEpoch="1"/>
  </div></QueryClientProvider>))
  await act(async()=>host.querySelector('button')!.click())
  expect(navigate).not.toHaveBeenCalled();expect(host.querySelector('img')).not.toBeNull()
})

async function cover(compact=false){await act(async()=>root.render(<QueryClientProvider client={queries}>
  <SoulCoverImage compact={compact} soul={{provenanceKind:'animacraft',onChainId:'soul',stateOnChainId:'state',
    currentOwnerAddress:'owner',currentOwnershipEpoch:'1'} as any} imageUrl="unverified.png"/>
</QueryClientProvider>))}
it.each([false,true])('shows verified original OC on fresh Soul cover (compact=%s)',async compact=>{
  m.read.mockResolvedValue({...scene(),status:'NOT_CREATED'});await cover(compact)
  expect(m.original).toHaveBeenCalledWith(expect.objectContaining({soulId:'soul',signal:expect.anything()}))
  expect(host.querySelector('img')?.getAttribute('alt')).toBe('Original completed Soul artwork')
  expect(host.textContent).toContain('Original OC');expect(m.read).toHaveBeenCalledTimes(2)
  expect(m.render).not.toHaveBeenCalled()
})
it.each(['EMPTY','AVAILABLE'])('keeps %s equipment authoritative for covers',async status=>{
  m.read.mockResolvedValue({...scene(),status});await cover();expect(m.original).not.toHaveBeenCalled()
  if(status==='EMPTY')expect(host.querySelector('img')).toBeNull()
  else expect(host.querySelector('img')?.getAttribute('alt')).toBe('Current equipped Soul appearance')
})
it('does not load original OC on protected equipment or read errors',async()=>{
  m.read.mockResolvedValue({...scene(),scene:{layers:[{protected:true}]}});await cover()
  expect(m.original).not.toHaveBeenCalled();expect(host.querySelector('img')).toBeNull()
})
it('does not request wallet access to protected original artwork',async()=>{
  m.read.mockResolvedValue({...scene(),status:'NOT_CREATED'});m.original.mockResolvedValue({status:'PROTECTED'})
  await cover();expect(host.querySelector('img')).toBeNull();expect(host.textContent).toContain('Protected original OC')
})
it.each(['EMPTY','AVAILABLE','changed-owner'])('rejects original OC if %s replaces its read scope',async change=>{
  m.read.mockResolvedValueOnce({...scene(),status:'NOT_CREATED'}).mockResolvedValue({...scene(),
    ...(change==='changed-owner'?{owner:'new-owner',status:'NOT_CREATED'}:{status:change})})
  await cover();expect(host.querySelector('img')).toBeNull();expect(host.textContent).toContain('unavailable')
})
it('invalid original PNG cannot fall back to the metadata URL',async()=>{
  m.read.mockResolvedValue({...scene(),status:'NOT_CREATED'});m.original.mockResolvedValue({status:'PUBLIC',blob:new Blob(['bad'],{type:'text/plain'})})
  await cover();expect(host.querySelector('img')).toBeNull();expect(host.textContent).toContain('unavailable')
})
it('clears original OC when Wardrobe creates empty equipment',async()=>{
  m.read.mockResolvedValue({...scene(),status:'NOT_CREATED'});await cover()
  expect(host.querySelector('img')).not.toBeNull();m.read.mockResolvedValue({...scene(),status:'EMPTY'})
  await act(async()=>{queries.setQueryData(['native-equipment','soul','state'],{revision:'1'})})
  expect(host.querySelector('img')).toBeNull();expect(revoke).toHaveBeenCalledWith('blob:current')
})
