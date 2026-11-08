// @vitest-environment jsdom
import React,{act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {beforeEach,afterEach,expect,it,vi} from 'vitest'
import {EquipmentMarketBrowser} from '../../web/components/souls/equipment-market-browser'
import {equipmentMarketOperationFixture,emid} from './fixtures/equipment-market-operation'
import {createEquipmentPurchaseOriginal} from '../../web/lib/animacraft/equipment-market-purchase-original'
import {readEquipmentMarketListingSnapshot} from '../../web/lib/animacraft/native-equipment-market-read'
const m=vi.hoisted(()=>({source:null as any,selected:null as any,client:vi.fn(),query:vi.fn()}))
vi.mock('../../web/lib/animacraft/native-receive',async importOriginal=>({
  ...await importOriginal<typeof import('../../web/lib/animacraft/native-receive')>(),createNativeReceiveClient:m.client,
}))
vi.mock('../../web/lib/animacraft/equipment-market-purchase-original',async importOriginal=>({
  ...await importOriginal<typeof import('../../web/lib/animacraft/equipment-market-purchase-original')>(),queryEquipmentPurchaseOriginal:m.query,
}))
vi.mock('../../web/lib/hooks/use-public-market',()=>({usePublicEquipmentMarketSource:()=>m.source}))
vi.mock('../../web/components/souls/equipment-market-panel',()=>({EquipmentMarketPanel:(props:any)=>{m.selected=props;return <p>Selected transaction review</p>}}))
vi.mock('../../web/components/souls/equipment-market-recovery',()=>({EquipmentMarketRecovery:()=>null}))
let root:Root,host:HTMLDivElement,f:Awaited<ReturnType<typeof equipmentMarketOperationFixture>>
const render=()=>act(async()=>root.render(<EquipmentMarketBrowser/>))
const button=(label:string)=>[...host.querySelectorAll('button')].find(b=>b.textContent===label)!
beforeEach(async()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});f=await equipmentMarketOperationFixture({action:'buy'});m.selected=null
  const listing=await readEquipmentMarketListingSnapshot(f.client,f.target,f.marketPin,{rootId:f.rootId,listingId:f.listingId,actor:f.actor})
  m.source={page:{listings:[listing],verifiedCandidates:1},coverage:'COMPLETE',viewerAddress:f.actor,identityKey:'scope',
    progress:{busy:false,pages:1},error:null,pause:vi.fn(),resume:vi.fn(),refresh:vi.fn()}
  m.query.mockReset();m.client.mockReset().mockReturnValue(f.client)
  host=document.createElement('div');document.body.appendChild(host);root=createRoot(host)
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove()})
it('opens exactly the selected listing purchase without starting a transaction',async()=>{
  await render();expect(m.selected).toBeNull();expect(host.textContent).toContain(f.itemId)
  await act(async()=>button('Review component purchase').click())
  expect(m.selected).toMatchObject({action:'buy',request:{actor:f.actor,rootId:f.rootId,itemId:f.itemId,kind:'base',listingId:f.listingId}})
})
it('shows seller controls instead of buying the seller’s own asset',async()=>{
  m.source.viewerAddress=f.owner;m.source.page.listings[0].cancelAvailable=true
  await render();expect(button('Review component purchase')).toBeUndefined()
  await act(async()=>button('Review price change').click());expect(m.selected.action).toBe('reprice')
  await act(async()=>button('Review cancellation').click());expect(m.selected.action).toBe('cancel')
})
it('keeps anonymous browsing readable while requiring a wallet for purchase',async()=>{
  m.source.viewerAddress=null;m.source.page.listings[0].buyAvailable=false;await render()
  expect(host.textContent).toContain(f.itemId);expect(button('Review component purchase').disabled).toBe(true)
})
it('does not describe incomplete empty results as an empty market',async()=>{
  m.source.page.listings=[];m.source.coverage='PARTIAL';m.source.error=new Error('Retry retained page');await render()
  expect(host.textContent).toContain('No matching listings verified yet');expect(host.textContent).toContain('Retry retained page')
  expect(host.textContent).not.toContain('No matching open component listings.')
})
it('removes the previous wallet’s transaction panel after switching accounts',async()=>{
  await render();await act(async()=>button('Review component purchase').click());m.source.viewerAddress=emid(999);await render()
  expect(host.textContent).not.toContain('Selected transaction review')
})

async function selectOriginal(original: unknown) {
  const input=host.querySelector('input[type=file]')!
  const text=JSON.stringify(original)
  await act(async()=>{
    Object.defineProperty(input,'files',{configurable:true,value:[{size:text.length,text:async()=>text}]})
    input.dispatchEvent(new Event('change',{bubbles:true}))
  })
}
function componentProof() {
  return {
    status:'FUNDS_VERIFIED',transactionDigest:f.record.digest,checkpoint:'20',
    coinType:f.record.snapshot.target.paymentCoinType,gas:{netGasCharge:'2'},
    receipt:{grossAtomic:'10001',sellerAtomic:'9751',protocolAtomic:'250',assetId:f.itemId,listingId:f.listingId},
    custody:{status:'SUPERSEDED',itemType:'OwnedBaseItemV8',sourceId:emid(997),originalHolder:f.actor,originalOwnershipEpoch:'2',
      currentHolder:emid(998),currentAddressOwner:emid(998),currentOwnershipEpoch:'3',currentListingId:null},
  }
}

it('cold Component Market recovery previews the exported original and queries its digest without a wallet or open listing',async()=>{
  m.source.viewerAddress=null;m.source.page.listings=[]
  m.query.mockResolvedValue(componentProof())
  await render()
  const original=createEquipmentPurchaseOriginal(f.record)
  await selectOriginal(original)
  expect(host.textContent).toContain(f.itemId)
  expect(host.textContent).toContain(f.record.digest)
  expect(m.client).not.toHaveBeenCalled()
  expect(m.query).not.toHaveBeenCalled()
  await act(async()=>button('Verify imported component purchase').click())
  expect(m.query).toHaveBeenCalledExactlyOnceWith(original,f.itemId,f.client,expect.any(AbortSignal))
  expect(host.textContent).toContain(`Original buyer ${f.actor}`)
  expect(host.textContent).toContain(`Current holder ${emid(998)}`)
  expect(host.textContent).toContain('OwnedBaseItemV8')
  expect(host.textContent).toContain(`Original listing ${f.listingId} · component source ${emid(997)}`)
  expect(host.textContent).toContain('Original checkpoint 20')
  expect(m.selected).toBeNull()
})

it('rejects a malformed replacement and discards the previous in-flight custody result',async()=>{
  let finish!:(value:ReturnType<typeof componentProof>)=>void
  m.query.mockReturnValueOnce(new Promise(resolve=>{finish=resolve}))
  await render()
  const original=createEquipmentPurchaseOriginal(f.record)
  await selectOriginal(original)
  await act(async()=>button('Verify imported component purchase').click())
  const signal=m.query.mock.calls[0][3] as AbortSignal
  await selectOriginal({...original,packet:{...original.packet,digest:'invalid'}})
  expect(signal.aborted).toBe(true)
  expect(host.querySelector('[role=alert]')).not.toBeNull()
  await act(async()=>finish(componentProof()))
  expect(host.textContent).not.toContain('Original checkpoint 20')
  expect(button('Verify imported component purchase')).toBeUndefined()
  expect(m.query).toHaveBeenCalledOnce()
})

it('stops a pending read and rechecks the same original digest on request',async()=>{
  let finish!:(value:ReturnType<typeof componentProof>)=>void
  m.query.mockReturnValueOnce(new Promise(resolve=>{finish=resolve}))
  m.query.mockResolvedValueOnce({status:'MISSING',transactionDigest:f.record.digest})
  await render();await selectOriginal(createEquipmentPurchaseOriginal(f.record))
  await act(async()=>button('Verify imported component purchase').click())
  const signal=m.query.mock.calls[0][3] as AbortSignal
  await act(async()=>button('Stop component recovery').click())
  expect(signal.aborted).toBe(true)
  await act(async()=>finish(componentProof()))
  expect(host.textContent).not.toContain('Original checkpoint 20')
  await act(async()=>button('Verify imported component purchase').click())
  expect(m.query.mock.calls.map(([original])=>original.packet.digest)).toEqual([f.record.digest,f.record.digest])
  expect(host.textContent).toContain('Its payment outcome is still unknown.')
})
