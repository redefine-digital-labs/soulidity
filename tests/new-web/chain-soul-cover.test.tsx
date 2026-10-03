// @vitest-environment jsdom
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {it,expect,vi} from 'vitest'
import {ChainSoulCover} from '../../web/components/souls/chain-soul-cover'
const m=vi.hoisted(()=>({result:{} as any,read:vi.fn(),retry:vi.fn()}))
vi.mock('../../web/lib/hooks/use-souls',()=>({useSoulDetail:(id:string)=>{m.read(id);return m.result}}))
vi.mock('../../web/components/souls/soul-cover-image',()=>({SoulCoverImage:({soul,children}:any)=><div data-verified={soul.onChainId}>{children}</div>}))
it.each(['ready','loading','error','wrong-soul'])('handles %s chain identity without unverified image fallback',async state=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});vi.clearAllMocks()
  m.result={data:state==='ready'?{onChainId:'soul',imageUrl:'chain-image'}:state==='wrong-soul'?{onChainId:'other'}:undefined,
    isError:state==='error',refetch:m.retry}
  const host=document.createElement('div'),root=createRoot(host),navigate=vi.fn()
  try{
    await act(async()=>root.render(<div onClick={navigate}><ChainSoulCover soulId="soul"><span>Listed</span></ChainSoulCover></div>))
    expect(m.read).toHaveBeenCalledWith('soul');expect(host.textContent).toContain('Listed')
    expect(host.querySelector('[data-verified]')!==null).toBe(state==='ready')
    if(state==='error'||state==='wrong-soul'){
      await act(async()=>host.querySelector('button')!.click());expect(m.retry).toHaveBeenCalledOnce();expect(navigate).not.toHaveBeenCalled()
    }else if(state==='loading')expect(host.textContent).toContain('Loading verified Soul')
  }finally{await act(async()=>root.unmount())}
})
