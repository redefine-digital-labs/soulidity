// @vitest-environment jsdom
import React,{act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {beforeEach,afterEach,expect,it,vi} from 'vitest'
const m=vi.hoisted(()=>({soul:null as any,actions:null as any,status:'idle',query:'price=1',toast:vi.fn(),replace:vi.fn(),list:vi.fn(),sign:vi.fn()}))
vi.mock('../../web/components/providers/auth-provider',()=>({useAuth:()=>({user:{id:'viewer'},getAuthHeaders:vi.fn()})}))
vi.mock('../../web/lib/hooks/use-souls',()=>({useSoulDetail:()=>({data:m.soul,isLoading:false,error:null})}))
vi.mock('../../web/lib/hooks/use-native-market-list-actions',()=>({useNativeMarketListActions:()=>m.actions}))
vi.mock('../../web/lib/hooks/use-list-soul',()=>({useListSoul:()=>({native:m.soul?.provenanceKind==='animacraft'?m.actions:null,status:m.status,error:null,listSoul:m.list})}))
vi.mock('../../web/lib/hooks/use-wallet-sign',()=>({useWalletSign:()=>({signAndExecute:m.sign,suiClient:{}})}))
vi.mock('../../web/components/souls/native-delist-modal',()=>({NativeDelistModal:()=>null}))
vi.mock('../../web/components/ui/toast',()=>({useToast:()=>({showToast:m.toast})}))
vi.mock('../../web/components/souls/soul-cover-image',()=>({SoulCoverImage:()=> <div aria-label="Soul cover"/>}))
vi.mock('../../web/node_modules/next/navigation.js',()=>({useRouter:()=>({replace:m.replace}),useSearchParams:()=>new URLSearchParams(m.query)}))
import SellPage from '../../web/app/souls/[id]/sell/page'
import AuthorizePage from '../../web/app/souls/[id]/sell/authorize/page'
import SuccessPage from '../../web/app/souls/[id]/sell/success/page'
import {UpdatePriceModal} from '../../web/components/souls/listing-modals'
let root:Root,host:HTMLDivElement
const id=(n:number)=>`0x${n.toString(16).padStart(64,'0')}`,params=Promise.resolve({id:id(12)})
async function render(node:React.ReactNode){
  await act(async()=>root.render(node))
  expect(host.textContent).not.toContain('USDC USDC')
}
const button=(text:string)=>[...host.querySelectorAll('button')].find(b=>b.textContent===text)!
async function input(value:string){await act(async()=>{
  const element=host.querySelector('input')!
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(element,value)
  element.dispatchEvent(new Event('input',{bubbles:true}))
})}
const record=(phase='SIGNING')=>({schema:1,kind:'list',priceAtomic:'123456789',phase,digest:'saved-digest',signature:null,snapshot:{listingId:null}})
beforeEach(()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});vi.clearAllMocks();m.query='price=1';m.status='idle'
  m.soul={onChainId:id(12),stateOnChainId:id(14),provenanceKind:'animacraft',name:'Maker Soul',isOwner:true,isCreator:true,
    listingStatus:'held',listingObjectOnChainId:null,listedPriceAtomic:'9000000',currentOwnerAddress:id(11),creatorAddress:id(11),
    creatorRoyaltyBps:300,platformFeeBps:250,imageUrl:null,tags:[],activeGrants:[],activeGrantCount:0,collection:null,collectionOnChainId:null}
  m.actions={snapshot:{soulId:id(12),stateId:id(14),owner:id(11),creator:id(11),makerCreator:id(60),kioskId:id(18),
    listed:false,listingId:null,priceAtomic:null,equipmentId:null,soulCreatorRoyaltyBps:750,makerSourceRoyaltyBps:250,release:{writesEnabled:true}},
    wallet:{address:id(11)},record:null,confirmedResult:null,history:[],historyResults:{},error:null,loading:false,busy:false,pending:false,
    needsRecovery:false,canList:true,canReprice:false,start:vi.fn(),refresh:vi.fn(),check:vi.fn(),resume:vi.fn(),cancelUnsigned:vi.fn(),retireExpired:vi.fn(),checkHistory:vi.fn()}
  host=document.createElement('div');document.body.appendChild(host);root=createRoot(host)
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove()})
it('keeps Set Price layout and quotes exact gross/native royalty amounts from verified facts',async()=>{
  await render(<SellPage params={params}/>);await input('1.000001')
  expect(host.textContent).toContain('Step 1 — Set Your Price');expect(host.textContent).toContain('Gross sale price')
  expect(host.textContent).toContain('0.075 USDC');expect(host.textContent).toContain('0.875001 USDC')
  expect(host.textContent).not.toContain('9 USDC');expect(m.actions.start).not.toHaveBeenCalled()
  expect(host.querySelector('a[href*="/authorize"]')?.getAttribute('href')).toContain('price=1.000001')
})
it.each(['0','-1','0.0000001','18446744073709.551616'])('does not authorize invalid price %s',async value=>{
  await render(<SellPage params={params}/>);await input(value)
  expect(host.querySelector('a[href*="/authorize"]')).toBeNull();expect(m.actions.start).not.toHaveBeenCalled()
})
it.each(['owner','listed','snapshot','pending','equipment'])('preserves Set Price recovery despite %s gate',async why=>{
  m.actions.canList=false;m.actions.record=record();m.actions.needsRecovery=true
  if(why==='owner')m.soul.isOwner=false
  if(why==='listed'){m.soul.listingStatus='listed';m.actions.snapshot.listed=true}
  if(why==='snapshot')m.actions.snapshot=null
  if(why==='pending')m.actions.pending=true
  if(why==='equipment')m.actions.snapshot.equipmentId=id(90)
  await render(<SellPage params={params}/>);await input('1')
  expect(button('Resume saved listing')).toBeDefined();expect(host.querySelector('a[href*="/authorize"]')).toBeNull()
  await act(async()=>button('Check saved listing').click());expect(m.actions.check).toHaveBeenCalledOnce()
})
it('ignores obsolete v5 collection hints for native listing; actual source enforces identity',async()=>{
  m.soul.animacraftProvenance={animacraftVersion:5};m.soul.collectionOnChainId=id(90);m.soul.collection={floorPriceAtomic:'999999999'}
  await render(<SellPage params={params}/>);await input('1')
  expect(host.querySelector('a[href*="/authorize"]')).not.toBeNull();expect(host.textContent).not.toContain('v5')
})
it('authorizes exact user price via native facade, without obsolete calls or automatic signing',async()=>{
  m.query='price=1.000001';await render(<AuthorizePage params={params}/>)
  expect(host.textContent).toContain('market::list_animacraft_v8_soul_fixed_price');expect(host.textContent).toContain('0.875001 USDC')
  expect(m.list).not.toHaveBeenCalled();await act(async()=>button('✓ Sign & List').click());expect(m.list).toHaveBeenCalledWith(1000001n)
  expect(m.sign).not.toHaveBeenCalled()
})
function equippedPlan(){
  m.actions.snapshot.equipmentId=id(90)
  m.actions.snapshot.equipmentSale={scope:{equipmentId:id(90),soulStateId:id(14),expectedRevision:'9007199254740993',
    target:{soulidityCallablePackageId:id(5),runtimeOriginalPackageId:id(91),protocolConfigId:id(1)}},
    definitionRegistryId:id(92),baseRegistryId:id(93),
    removals:[{kind:'base',itemId:id(94)},{kind:'external',itemId:id(95)},{kind:'selection',selectionIndex:'8'}],
    packs:[{runtimeCallablePackageId:id(91),releaseId:id(96),bindingIndex:'0',paymentCoinType:'0x2::sui::SUI'}],
    runtimeCallableDigest:'verified-by-reader',writesEnabled:true}
}
it('keeps equipped single-Soul price entry and explains automatic removal without selecting equipment for sale',async()=>{
  equippedPlan();await render(<SellPage params={params}/>);await input('1.000001')
  const scope=host.querySelector('[aria-label="Selected sale scope"]')!
  expect(scope.textContent).toContain('For sale: 1 Animacraft Soul only');expect(scope.textContent).toContain(id(12))
  expect(scope.textContent).toContain('3 equipped selections');expect(scope.textContent).toContain('Equipment is not for sale')
  expect(host.textContent).not.toContain('Remove equipped components and close')
  expect(host.querySelector('a[href*="/authorize"]')).not.toBeNull();expect(m.list).not.toHaveBeenCalled()
})
it('confirms exact Soul, gross price, instance IDs and sparse usage slot before atomic listing',async()=>{
  equippedPlan();m.query='price=1.000001';await render(<AuthorizePage params={params}/>)
  const confirmation=host.querySelector('[aria-label="Confirm selected sale"]')!
  expect(confirmation.textContent).toContain(id(12));expect(confirmation.textContent).toContain('1.000001 USDC')
  expect(confirmation.textContent).toContain('Revision 9007199254740993')
  const rows=[...confirmation.querySelectorAll('li')].map(row=>row.textContent)
  expect(rows).toHaveLength(3);expect(rows[0]).toContain(id(94));expect(rows[1]).toContain(id(95));expect(rows[2]).toContain('slot 8')
  expect(confirmation.textContent).toContain('stays in seller’s wallet')
  expect(confirmation.textContent).toContain('no Pack or access right is sold')
  expect(confirmation.textContent).toContain('Cancelling a successful listing does not re-equip anything')
  expect(confirmation.textContent).toContain('entire transaction rolls back')
  expect(m.list).not.toHaveBeenCalled();await act(async()=>button('✓ Sign & List').click())
  expect(m.list).toHaveBeenCalledWith(1000001n);expect(m.sign).not.toHaveBeenCalled()
})
it.each(['price','authorize'])('fails closed without the complete equipment plan while preserving %s recovery',async step=>{
  m.actions.snapshot.equipmentId=id(90);m.actions.canList=true;m.actions.record=record();m.actions.needsRecovery=true
  await render(step==='price'?<SellPage params={params}/>:<AuthorizePage params={params}/>)
  expect(host.textContent).toContain('Complete verified equipment removal plan unavailable')
  if(step==='price'){await input('1');expect(host.querySelector('a[href*="/authorize"]')).toBeNull()}
  else expect(button('✓ Sign & List').disabled).toBe(true)
  await act(async()=>button('Check saved listing').click());expect(m.actions.check).toHaveBeenCalledOnce();expect(m.list).not.toHaveBeenCalled()
})
it('going back from equipment confirmation never starts removal or listing',async()=>{
  equippedPlan();await render(<AuthorizePage params={params}/>)
  expect([...host.querySelectorAll('a')].find(a=>a.textContent?.includes('Back'))?.getAttribute('href')).toContain('/sell?price=1')
  expect(host.textContent).toContain('Going back without signing changes nothing on-chain')
  expect(m.list).not.toHaveBeenCalled();expect(m.actions.start).not.toHaveBeenCalled()
})
it.each(['','price=0','price=oops','price=18446744073709.551616'])('recovers without a valid new URL price %s',async query=>{
  m.query=query;m.soul.isOwner=false;m.actions.record=record();m.actions.pending=true;m.actions.canList=false
  await render(<AuthorizePage params={params}/>)
  expect(host.textContent).toContain('Recorded price: 123.456789 USDC');expect(button('✓ Sign & List')).toBeUndefined()
  await act(async()=>button('Resume saved listing').click());expect(m.actions.resume).toHaveBeenCalledOnce();expect(m.list).not.toHaveBeenCalled()
})
it('keeps unknown signing visible and does not redirect or toast success',async()=>{
  m.actions.record=record();m.actions.pending=true;m.actions.canList=false;m.status='unknown'
  await render(<AuthorizePage params={params}/>);expect(button('✓ Sign & List').disabled).toBe(true)
  expect(button('Discard unsigned request')).toBeUndefined();expect(button('Check expiry and archive')).toBeDefined()
  expect(m.replace).not.toHaveBeenCalled();expect(m.toast).not.toHaveBeenCalled()
})
it('confirmed native listing stays with its receipt rather than redirecting with raw URL price',async()=>{
  m.actions.record={...record('SUCCEEDED'),syncStatus:'COMPLETE'};m.actions.confirmedResult=m.actions.record;m.status='done';m.query='price=999'
  await render(<AuthorizePage params={params}/>);expect(m.replace).not.toHaveBeenCalled()
  expect(host.textContent).toContain('Recorded price: 123.456789 USDC');expect(host.textContent).toContain('current chain state verified')
})
it('native success URL alone never claims a successful or current listing',async()=>{
  m.query='price=999999';await render(<SuccessPage params={params}/>)
  expect(host.textContent).toContain('Listing receipt');expect(host.textContent).toContain('No saved listing transaction')
  expect(host.textContent).not.toContain('Soul Listed!');expect(host.textContent).not.toContain('999999')
})
it('restored success requires explicit check; superseded result preserves later state',async()=>{
  m.actions.record={...record('SUCCEEDED'),syncStatus:'COMPLETE'}
  await render(<SuccessPage params={params}/>);expect(host.textContent).not.toContain('current chain state verified')
  await act(async()=>button('Check saved listing').click());expect(m.actions.check).toHaveBeenCalledOnce()
  m.actions.confirmedResult={...m.actions.record,syncStatus:'SUPERSEDED'};await render(<SuccessPage params={params}/>)
  expect(host.textContent).toContain('newer state was preserved');expect(host.textContent).not.toContain('Soul Listed!')
})
it('retired/history checks never offer resubmission or current-ownership claims',async()=>{
  m.actions.record=record('RETIRED');m.actions.history=[record('RETIRED')];m.actions.historyResults={'saved-digest':'SUCCEEDED'}
  await render(<SuccessPage params={params}/>);expect(button('Resume saved listing')).toBeUndefined()
  expect(host.textContent).toContain('does not prove current ownership')
  await act(async()=>button('Check archived listing').click());expect(m.actions.checkHistory).toHaveBeenCalledWith('saved-digest')
})
it('Update Price preserves modal layout and executes atomic reprice with a verified current price',async()=>{
  m.actions.snapshot.listed=true;m.actions.snapshot.priceAtomic='1000000';m.actions.canReprice=true;m.actions.canList=false
  await render(<UpdatePriceModal soul={m.soul} open onClose={vi.fn()}/>)
  expect(host.querySelector('[role=dialog]')?.className).toContain('overflow-y-auto');expect(host.textContent).not.toContain('9 USDC')
  expect(host.querySelector('.text-lg.font-bold.text-gold')?.textContent).toBe('1 USDC')
  await input('1');expect(button('Update Price').disabled).toBe(true)
  await input('0');expect(button('Update Price').disabled).toBe(true)
  await input('18446744073709.551616');expect(button('Update Price').disabled).toBe(true)
  await input('2.000001');expect(button('Update Price').disabled).toBe(false)
  await act(async()=>button('Update Price').click());expect(m.actions.start).toHaveBeenCalledWith(2000001n,'reprice');expect(m.sign).not.toHaveBeenCalled()
})
it('Update Price recovery remains available without owner, live listing or new price',async()=>{
  m.soul.isOwner=false;m.actions.snapshot=null;m.actions.canReprice=false;m.actions.record={...record(),kind:'reprice'}
  await render(<UpdatePriceModal soul={m.soul} open onClose={vi.fn()}/>);expect(button('Update Price').disabled).toBe(true)
  expect(host.textContent).toContain('Saved price update');await act(async()=>button('Resume saved listing').click());expect(m.actions.resume).toHaveBeenCalledOnce()
})
it('preserves ordinary owner, collection floor, and stable success redirect behavior',async()=>{
  m.soul.provenanceKind='native';m.soul.collection={floorPriceAtomic:'2000000',extraRoyaltyBps:100,currentHolderAddress:id(11)}
  await render(<SellPage params={params}/>);await input('1');expect(host.querySelector('a[href*="/authorize"]')).toBeNull()
  m.query='price=2';m.status='done';await render(<AuthorizePage params={params}/>)
  expect(m.replace).toHaveBeenCalledWith(`/souls/${id(12)}/sell/success?price=2`)
})
