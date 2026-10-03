// @vitest-environment jsdom
import React,{act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {NativeCurrentAppearance} from '../../web/components/souls/native-current-appearance'
const m=vi.hoisted(()=>({read:vi.fn(),render:vi.fn()}))
vi.mock('../../web/lib/animacraft/browser-native-artwork',()=>({getBrowserNativeArtworkConfig:()=>({target:{}}),readBrowserNativeEquipmentRenderTarget:m.read}))
vi.mock('../../web/lib/animacraft/native-equipment-render-client',()=>({renderNativeEquipmentScene:m.render}))
let host:HTMLDivElement,root:Root,queries:QueryClient
const revoke=vi.fn(),create=vi.fn()
const scene=()=>({soulId:'soul',stateId:'state',owner:'owner',ownershipEpoch:'1',status:'AVAILABLE',scene:{layers:[]}})
beforeEach(()=>{
  vi.clearAllMocks();m.read.mockResolvedValue(scene());m.render.mockResolvedValue(new Blob(['png'],{type:'image/png'}))
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
