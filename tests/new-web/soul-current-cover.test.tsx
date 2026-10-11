// @vitest-environment jsdom
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {expect,it,vi} from 'vitest'
import {SoulCoverImage} from '../../web/components/souls/soul-cover-image'
vi.mock('../../web/components/souls/native-current-appearance',()=>({NativeSoulCover:({soulId,stateId,owner,ownershipEpoch}:any)=>
  <div data-current={JSON.stringify({soulId,stateId,owner,ownershipEpoch})}>Current equipment</div>}))
vi.mock('../../web/components/souls/soul-artwork-image',()=>({SoulArtworkImage:({src}:any)=><img src={src} alt="Historical cover"/>}))
it.each(['animacraft','native'] as const)('uses the correct %s cover authority without hiding overlay children',async provenanceKind=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
  const host=document.createElement('div'),root=createRoot(host)
  try{
    await act(async()=>root.render(<SoulCoverImage soul={{provenanceKind,onChainId:'soul',stateOnChainId:'state',
      currentOwnerAddress:'owner',currentOwnershipEpoch:'2'} as any} imageUrl="original.png" fallback={<span>Fallback</span>} hasOverlay>
      <span>Listed</span></SoulCoverImage>))
    expect(host.textContent).toContain('Listed')
    if(provenanceKind==='animacraft'){
      expect(host.querySelector('img')).toBeNull();expect(host.textContent).not.toContain('Fallback')
      expect(JSON.parse(host.querySelector('[data-current]')!.getAttribute('data-current')!)).toEqual({soulId:'soul',stateId:'state',owner:'owner',ownershipEpoch:'2'})
    }else{expect(host.querySelector('img')?.getAttribute('src')).toBe('original.png');expect(host.querySelector('[data-current]')).toBeNull()}
  }finally{await act(async()=>root.unmount())}
})
