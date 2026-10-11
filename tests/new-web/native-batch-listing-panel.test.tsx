// @vitest-environment jsdom
import React,{act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {marketListFixture} from './fixtures/market-list-operation'
import {selectedMarketSaleEvidenceFixture} from './fixtures/selected-market-sale-evidence'
const m=vi.hoisted(()=>({actions:{} as any,request:vi.fn()}))
vi.mock('../../web/lib/hooks/use-native-market-batch-list-actions',()=>({useNativeMarketBatchListActions:(input:any)=>{m.request(input);return m.actions}}))
import {NativeBatchListingPanel,type NativeBatchSelection} from '../../web/components/souls/native-batch-listing-panel'
let root:Root,host:HTMLDivElement,f:Awaited<ReturnType<typeof marketListFixture>>,selection:NativeBatchSelection[],change:ReturnType<typeof vi.fn<(rows:NativeBatchSelection[])=>void>>
const render=async(owner=f.record.snapshot.owner)=>{await act(async()=>root.render(<NativeBatchListingPanel owner={owner} identityKey="wallet:1" selection={selection} visibleIds={[]} onChange={change}/>))}
const button=(text:string)=>[...host.querySelectorAll('button')].find(row=>row.textContent===text)!
beforeEach(async()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});vi.clearAllMocks();f=await marketListFixture({equipped:true});change=vi.fn()
  selection=[{soulId:f.snapshot.soulId,stateId:f.snapshot.stateId,name:'Chosen',price:'1'}]
  m.actions={snapshot:{rows:[{assetType:'soul',snapshot:f.snapshot,priceAtomic:'1000000'}]},record:null,history:[],historyResults:{},canStart:true,
    loading:false,busy:false,pending:false,error:null,start:vi.fn(async()=>{}),refresh:vi.fn(async()=>{}),resume:vi.fn(async()=>{}),check:vi.fn(async()=>{}),cancelUnsigned:vi.fn(async()=>{}),retireExpired:vi.fn(async()=>{}),checkHistory:vi.fn(async()=>{})}
  host=document.createElement('div');document.body.appendChild(host);root=createRoot(host)
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove()})
it('reviews exact Soul/type/gross price and all equipment removals before one atomic start',async()=>{
  await render();const review=host.querySelector('[aria-label="Verified batch review"]')!
  expect(review.textContent).toContain(f.snapshot.soulId);expect(review.textContent).toContain('Animacraft V8 Soul');expect(review.textContent).toContain('1 USDC')
  for(const label of ['Mobile selected Soul review','Desktop selected Soul review']){
    const layout=review.querySelector(`[aria-label="${label}"]`)!
    expect(layout.querySelectorAll('li')).toHaveLength(3);expect(layout.textContent).toContain('slot 8')
  }
  expect(review.textContent).toContain('stays in seller’s wallet, not sold');expect(review.textContent).toContain('No Pack/access right is sold')
  expect(host.textContent).toContain('Cancelling a listing does not re-equip anything')
  expect(m.actions.start).not.toHaveBeenCalled();await act(async()=>button('Sign & list selected Souls atomically').click())
  expect(m.actions.start).toHaveBeenCalledOnce()
})
it('keeps complete per-Soul mobile cards and a separately responsive desktop table',async()=>{
  const second=structuredClone(m.actions.snapshot.rows[0]);second.snapshot.soulId=f.snapshot.stateId;second.snapshot.stateId=f.snapshot.soulId;second.priceAtomic='2000000'
  m.actions.snapshot.rows.push(second)
  selection.push({soulId:second.snapshot.soulId,stateId:second.snapshot.stateId,name:'Second',price:'2'})
  await render()
  const mobile=host.querySelector('[aria-label="Mobile selected Soul review"]')!,desktop=host.querySelector('[aria-label="Desktop selected Soul review"]')!
  expect(mobile.classList.contains('sm:hidden')).toBe(true)
  expect(desktop.classList.contains('hidden')).toBe(true);expect(desktop.classList.contains('sm:block')).toBe(true)
  const cards=mobile.querySelectorAll('article');expect(cards).toHaveLength(2)
  cards.forEach((card,index)=>{
    const row=m.actions.snapshot.rows[index]
    expect(card.querySelector('dd')?.textContent).toBe(row.snapshot.soulId)
    expect(card.textContent).toContain('Animacraft V8 Soul');expect(card.textContent).toContain(`${index+1} USDC`)
    expect(card.textContent).toContain('Equipment retained, not sold');expect(card.querySelectorAll('li')).toHaveLength(3)
    for(const removal of row.snapshot.equipmentSale.removals)if(removal.kind!=='selection')expect(card.textContent).toContain(removal.itemId)
  })
  expect(desktop.querySelectorAll('tbody tr')).toHaveLength(2)
  expect(desktop.querySelector('table')?.classList.contains('min-w-[640px]')).toBe(true)
})
it.each(['missing snapshot','different type','different Soul','different state','different price','different owner','missing plan','writes','pending','busy','loading','invalid price','over limit'])
  ('blocks signing for %s even if hook canStart is true',async reason=>{
    const row=m.actions.snapshot.rows[0]
    if(reason==='missing snapshot')m.actions.snapshot=null
    if(reason==='different type')row.assetType='equipment'
    if(reason==='different Soul')row.snapshot.soulId=f.snapshot.stateId
    if(reason==='different state')row.snapshot.stateId=f.snapshot.soulId
    if(reason==='different price')row.priceAtomic='2'
    if(reason==='different owner')row.snapshot.owner=f.snapshot.soulId
    if(reason==='missing plan')delete row.snapshot.equipmentSale
    if(reason==='writes')row.snapshot.equipmentSale.writesEnabled=false
    if(['pending','busy','loading'].includes(reason))m.actions[reason]=true
    if(reason==='invalid price')selection[0].price='0.0000001'
    if(reason==='over limit')selection=Array(21).fill(selection[0])
    await render();expect(button('Sign & list selected Souls atomically').disabled).toBe(true)
    if(['invalid price','over limit'].includes(reason))expect(m.request.mock.lastCall?.[0].selection).toEqual([])
    expect(m.actions.start).not.toHaveBeenCalled()
  })
it('retains saved exact batch recovery with no draft and unavailable current read',async()=>{
  selection=[];m.actions.snapshot=null;m.actions.error='Current reader unavailable'
  m.actions.record={owner:f.snapshot.owner,rows:[{assetType:'soul',snapshot:f.snapshot,priceAtomic:'1000000'}],phase:'SIGNED',digest:'saved',expirationEpoch:'10',signature:'signed'}
  await render();expect(m.request.mock.lastCall?.[0].selection).toEqual([])
  expect(host.textContent).toContain(f.snapshot.soulId);expect(button('Discard unsigned batch')).toBeUndefined()
  await act(async()=>button('Check saved batch').click());expect(m.actions.check).toHaveBeenCalledOnce()
  await act(async()=>button('Resume saved batch').click());expect(m.actions.resume).toHaveBeenCalledOnce()
  expect(m.actions.start).not.toHaveBeenCalled()
})
async function mixed(includeSoul=true){
  const value=await selectedMarketSaleEvidenceFixture(includeSoul),snapshot=value.record.snapshot
  selection=snapshot.rows.map(row=>row.assetType==='soul'?{soulId:row.snapshot.soulId,stateId:row.snapshot.stateId,name:'Chosen Soul',price:'0.030001'}:
    {assetType:'equipment',rootId:row.snapshot.target.rootId,itemId:row.snapshot.asset.itemId,kind:row.snapshot.asset.kind,
      equipmentScope:row.snapshot.removal?{soulId:row.snapshot.removal.soulId,stateId:row.snapshot.removal.stateId}:undefined,
      paymentCoinType:row.snapshot.target.paymentCoinType,name:row.snapshot.asset.kind,price:row.priceAtomic==='10001'?'0.000010001':'0.000020001'})
  m.actions.snapshot={schema:'native-market-batch-list-v1',owner:snapshot.owner,rows:snapshot.rows,equipment:snapshot.equipment}
  return value
}
it('reviews only the explicitly chosen mixed rows with exact currencies, fees and independent listings in both layouts',async()=>{
  const value=await mixed(),owner=value.record.snapshot.owner;await render(owner)
  const review=host.querySelector('[aria-label="Verified batch review"]')!
  for(const label of ['Mobile selected asset review','Desktop selected asset review']){
    const layout=review.querySelector(`[aria-label="${label}"]`)!
    for(const row of value.record.snapshot.rows)expect(layout.textContent).toContain(row.assetType==='soul'?row.snapshot.soulId:row.snapshot.asset.itemId)
    expect(layout.textContent).toContain('0.030001 USDC');expect(layout.textContent).toContain('0.000010001 SUI')
    expect(layout.textContent).toContain('platform fee 2.5%');expect(layout.textContent).toContain('seller receives')
    expect(layout.textContent).toContain('separately selected for its own listing')
    expect(layout.textContent).not.toContain('stays in seller’s wallet, not sold')
    expect(layout.textContent).toContain('close the empty binding')
  }
  const sent=m.request.mock.lastCall![0].selection
  expect(sent).toHaveLength(3);expect(sent[1]).toMatchObject({assetType:'equipment',priceAtomic:'10001'})
  expect(m.actions.start).not.toHaveBeenCalled();await act(async()=>button('Sign & list selected assets atomically').click())
  expect(m.actions.start).toHaveBeenCalledOnce()
})
it('equipment-only review preserves the unselected Soul and binding without adding a Soul sale row',async()=>{
  const value=await mixed(false);await render(value.record.snapshot.owner)
  expect(m.request.mock.lastCall![0].selection).toHaveLength(2)
  expect(m.request.mock.lastCall![0].selection.every((r:any)=>r.assetType==='equipment')).toBe(true)
  expect(host.textContent).toContain('Keep the Soul and its binding')
  expect(host.textContent).not.toContain('clear its equipment and close the empty binding')
})
it.each(['coin','root','scope','kind','owner','gate','price below minimum','precision'])('blocks changed equipment review or invalid price: %s',async reason=>{
  const value=await mixed(false),row=m.actions.snapshot.rows[0],draft=selection[0]
  if(reason==='coin')row.snapshot.target.paymentCoinType='0x2::other::OTHER'
  if(reason==='root')row.snapshot.target.rootId=f.snapshot.soulId
  if(reason==='scope')row.snapshot.removal.stateId=f.snapshot.soulId
  if(reason==='kind')row.snapshot.asset.kind='external'
  if(reason==='owner')row.snapshot.actor=f.snapshot.soulId
  if(reason==='gate')row.snapshot.release.marketWritesEnabled=false
  if(reason==='price below minimum')draft.price='0.000000039'
  if(reason==='precision')draft.price='0.0000000001'
  await render(value.record.snapshot.owner)
  expect(button('Sign & list selected assets atomically').disabled).toBe(true);expect(m.actions.start).not.toHaveBeenCalled()
})
it('mixed saved review uses the saved selection, never the empty current draft',async()=>{
  const value=await mixed(),s=value.record.snapshot;selection=[];m.actions.snapshot=null
  m.actions.record={...value.record,owner:s.owner,rows:s.rows,equipment:s.equipment,phase:'SIGNED',signature:'saved'}
  await render(s.owner)
  const recovery=host.querySelector('[aria-label="Batch listing recovery"]')!
  expect(recovery.textContent).toContain('separately selected for its own listing')
  expect(recovery.textContent).not.toContain('stays in seller’s wallet, not sold')
  await act(async()=>button('Resume saved batch').click());expect(m.actions.resume).toHaveBeenCalledOnce()
})
