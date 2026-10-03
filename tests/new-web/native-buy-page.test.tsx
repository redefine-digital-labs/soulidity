// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import BuyPage from '../../web/app/souls/[id]/buy/page'
const m=vi.hoisted(()=>({soul:null as any,user:null as any,purchase:null as any,toast:vi.fn(),login:vi.fn()}))
vi.mock('../../web/lib/hooks/use-login',()=>({useLogin:()=>m.login}))
vi.mock('../../web/components/providers/auth-provider',()=>({useAuth:()=>({user:m.user,loading:false,getAuthHeaders:vi.fn()})}))
vi.mock('../../web/lib/hooks/use-souls',()=>({useSoulDetail:()=>({data:m.soul,isLoading:false,error:null})}))
vi.mock('../../web/lib/hooks/use-purchase',()=>({usePurchase:()=>m.purchase}))
vi.mock('../../web/components/ui/toast',()=>({useToast:()=>({showToast:m.toast})}))
vi.mock('../../web/components/souls/soul-cover-image',()=>({SoulCoverImage:()=> <div aria-label="Soul cover"/>}))
let root:Root,host:HTMLDivElement
const id=(n:number)=>`0x${n.toString(16).padStart(64,'0')}`
const route=Promise.resolve({id:id(12)})
const render=()=>act(async()=>root.render(<BuyPage params={route}/>))
const button=(label:string)=>[...host.querySelectorAll('button')].find(value=>value.textContent===label)!
const buyButton=()=>[...host.querySelectorAll('button')].find(value=>value.textContent?.startsWith('Buy for'))!
beforeEach(()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});vi.clearAllMocks()
  m.user={id:'viewer'};m.soul={onChainId:id(12),stateOnChainId:id(14),provenanceKind:'animacraft',name:'Maker Soul',
    listingStatus:'listed',listingObjectOnChainId:id(22),currentOwnerAddress:id(50),imageUrl:null,
    quote:{priceAtomic:'9000000',totalAtomic:'9900000'},listedPriceAtomic:'9000000',collectionOnChainId:null}
  const snapshot={soulId:id(12),stateId:id(14),seller:id(51),buyer:id(52),priceAtomic:'1000000',
    soulCreatorRoyaltyBps:500,makerSourceRoyaltyBps:200,purchaseAvailable:true,release:{writesEnabled:true}}
  m.purchase={status:'idle',error:null,txDigest:null,purchase:vi.fn(),native:{snapshot,record:null,history:[],historyResults:{},
    error:null,loading:false,busy:false,pending:false,needsRecovery:false,canStart:true,refresh:vi.fn(),
    check:vi.fn(),resume:vi.fn(),cancelUnsigned:vi.fn(),retireExpired:vi.fn(),checkHistory:vi.fn()}}
  host=document.createElement('div');document.body.appendChild(host);root=createRoot(host)
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove()})
it('preserves the original confirmation layout and displays the live gross price, not the stale projection',async()=>{
  await render();expect(host.textContent).toContain('Confirm purchase')
  expect(host.textContent).toContain('Gross sale price');expect(host.textContent).toContain('Protocol fee · included')
  expect(host.textContent).toContain('Soul creator royalty · included');expect(host.textContent).toContain('Maker-source royalty · included')
  expect(host.textContent).not.toContain('Collection royalty');expect(buyButton().textContent).toBe('Buy for 1 USDC')
  expect(buyButton().textContent).not.toContain('9.9');expect(m.purchase.purchase).not.toHaveBeenCalled()
  await act(async()=>buyButton().click());expect(m.purchase.purchase).toHaveBeenCalledOnce()
})
it.each(['gate','paused','pending'])('keeps purchase disabled for %s without hiding query recovery',async reason=>{
  const n=m.purchase.native;n.canStart=false;n.record={phase:'SIGNED',digest:'saved',signature:'sig'};n.needsRecovery=true
  if(reason==='gate')n.snapshot.release.writesEnabled=false
  if(reason==='paused')n.snapshot.purchaseAvailable=false
  if(reason==='pending')n.pending=true
  await render();expect(buyButton().disabled).toBe(true)
  await act(async()=>button('Check saved purchase').click());expect(n.check).toHaveBeenCalledOnce()
  expect(m.purchase.purchase).not.toHaveBeenCalled()
})
it('does not block a native checkout because stale legacy provenance claims an old version',async()=>{
  m.soul.animacraftProvenance={animacraftVersion:5};m.soul.collectionOnChainId=id(90)
  await render();expect(host.textContent).toContain('Confirm purchase');expect(host.textContent).not.toContain('v5 purchase blocked')
})
it('retains saved purchase recovery after listing/quote disappear and never claims unknown payment failed',async()=>{
  m.soul.listingStatus='held';m.soul.quote=null;m.soul.listingObjectOnChainId=null
  const n=m.purchase.native;n.snapshot=null;n.record={phase:'SIGNING',digest:'unknown',signature:null};n.needsRecovery=true
  m.purchase.status='unknown';m.purchase.error='RPC timeout';n.error='RPC timeout'
  await render();expect(host.textContent).toContain('Purchase state unavailable');expect(host.textContent).toContain('unknown')
  expect(buyButton()).toBeUndefined();expect(button('Resume saved purchase')).toBeDefined()
  expect(m.toast.mock.calls.some(([message])=>message.includes('Transaction failed'))).toBe(false)
  expect(m.toast.mock.calls.some(([,style])=>style==='success')).toBe(false)
})
it('allows unsigned discard only before the wallet could have signed',async()=>{
  const n=m.purchase.native;n.record={phase:'PREPARED',digest:'saved',signature:null};n.needsRecovery=true
  await render();await act(async()=>button('Discard unsigned request').click());expect(n.cancelUnsigned).toHaveBeenCalledOnce()
  n.record.phase='SIGNING';await render();expect(button('Discard unsigned request')).toBeUndefined()
  expect(button('Check expiry and archive')).toBeDefined()
})
it('retired purchase never offers resubmission but can be checked later',async()=>{
  const n=m.purchase.native;n.record={phase:'RETIRED',digest:'old',signature:'sig'};n.needsRecovery=true
  await render();expect(host.textContent).toContain('will never be submitted again')
  expect(button('Resume saved purchase')).toBeUndefined();expect(button('Check expiry and archive')).toBeUndefined()
  await act(async()=>button('Check saved purchase').click());expect(n.check).toHaveBeenCalledOnce()
})
it('historical success does not show current ownership or change the new purchase',async()=>{
  const n=m.purchase.native;n.history=[{digest:'old'}];n.historyResults={old:'SUCCEEDED'}
  await render();expect(host.textContent).toContain('does not prove current ownership')
  await act(async()=>button('Check archived purchase').click());expect(n.checkHistory).toHaveBeenCalledWith('old')
  expect(m.toast).not.toHaveBeenCalled();expect(m.purchase.purchase).not.toHaveBeenCalled()
})
it('displays paid amount from the saved successful receipt rather than a later listing price',async()=>{
  m.purchase.status='done';m.purchase.txDigest='confirmed';m.purchase.native.record={phase:'SUCCEEDED',syncStatus:'COMPLETE',snapshot:{priceAtomic:'1000000'}}
  await render();expect(host.textContent).toContain('Soul acquired');expect(host.textContent).toContain('Paid1 USDC')
  expect(host.textContent).not.toContain('9.9');expect(m.toast).toHaveBeenCalledWith('Soul purchased successfully!','success')
})
it('explains later owner/listing changes without claiming the Soul is currently held by this buyer',async()=>{
  m.purchase.status='superseded';m.purchase.native.record={phase:'SUCCEEDED',syncStatus:'SUPERSEDED',snapshot:{priceAtomic:'1000000'}}
  await render();expect(host.textContent).toContain('Its current state was preserved')
  expect(host.textContent).not.toContain('Soul acquired');expect(host.textContent).not.toContain('is now synchronized to your wallet state')
  expect(m.toast).not.toHaveBeenCalled()
})
it('keeps ordinary Soul checkout and collection royalty display intact',async()=>{
  m.soul.provenanceKind='native';m.purchase.native=null
  m.soul.chainListingStatus='LISTED';m.soul.purchaseAvailable=true
  m.soul.quote={priceAtomic:'1000000',totalAtomic:'1100000',platformFeeAtomic:'25000',creatorRoyaltyAtomic:'50000',collectionRoyaltyAtomic:'25000'}
  await render();expect(host.textContent).toContain('List price');expect(host.textContent).toContain('Collection royalty')
  expect(host.textContent).not.toContain('Gross sale price');expect(buyButton().textContent).toBe('Buy for 1.1 USDC')
})
it.each(['unavailable','missing-listing','missing-quote'])('ordinary checkout rejects %s despite a legacy listed projection',async reason=>{
  m.soul.provenanceKind='native';m.purchase.native=null
  m.soul.chainListingStatus='LISTED';m.soul.purchaseAvailable=true
  m.soul.quote={priceAtomic:'1000000',totalAtomic:'1100000',platformFeeAtomic:'25000',creatorRoyaltyAtomic:'50000',collectionRoyaltyAtomic:'25000'}
  if(reason==='unavailable')m.soul.purchaseAvailable=false
  if(reason==='missing-listing')m.soul.listingObjectOnChainId=null
  if(reason==='missing-quote')m.soul.quote=null
  await render();expect(host.textContent).toContain('Purchase currently unavailable')
  expect(host.textContent).not.toContain('Confirm purchase');expect(buyButton()).toBeUndefined()
  expect(m.purchase.purchase).not.toHaveBeenCalled();expect(m.toast).not.toHaveBeenCalled()
})
it('does not open a purchase before the authenticated checkout gate',async()=>{
  m.user=null;await render();expect(host.textContent).toContain('Sign in to purchase');expect(buyButton()).toBeUndefined()
})
