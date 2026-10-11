// @vitest-environment jsdom
// Real page, portfolio model, Collection sections/cards and ReactQueryClient.
// Chain readers and mutation dialogs are controlled separately from raw/command suites.
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeAll, afterAll, beforeEach, afterEach, it, expect, vi } from 'vitest'
import MySoulsPage from '../../web/app/my-souls/page'
import { composeMySoulsPortfolio } from '../../web/lib/soulidity/soul-portfolio-model'
import { formatChainTimestamp } from '../../web/lib/soulidity/soul-detail-model'
import { soulActivityGrantsCsv } from '../../web/lib/soulidity/soul-activity-model'
import { createBrowserSoulDetailModel } from './fixtures/browser-soul-detail-fixture'
import { mySoulsFixture, id } from './fixtures/my-souls'
import {equipmentMarketOperationFixture} from './fixtures/equipment-market-operation'

const h = vi.hoisted(() => ({ my: {} as any, login: vi.fn(), useMy: vi.fn(), dialogs: {} as Record<string, any>,batch:{} as any,batchCalls:vi.fn(),batchMounts:vi.fn(),ownedEquipment:vi.fn() }))
vi.mock('../../web/lib/animacraft/browser-owned-equipment',()=>({readBrowserOwnedEquipmentPage:h.ownedEquipment}))
vi.mock('../../web/lib/hooks/use-native-market-batch-list-actions',()=>({useNativeMarketBatchListActions:(input:any)=>{
  React.useEffect(()=>{h.batchMounts()},[]);h.batchCalls(input);return h.batch
}}))
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a> }))
vi.mock('../../web/lib/hooks/use-souls', () => ({ useMySouls: (...args: any[]) => { h.useMy(...args); return h.my } }))
vi.mock('../../web/lib/hooks/use-login', () => ({ useLogin: () => h.login }))
vi.mock('../../web/lib/hooks/use-private-bookmarks', () => ({ usePrivateBookmarks: () => ({ entries: null, connected: true, locked: true }) }))
vi.mock('../../web/lib/hooks/use-bookmark-rows', () => ({ useBookmarkRows: () => ({ page: null }) }))
vi.mock('../../web/components/bookmarks/private-bookmark-controls', () => ({ PrivateBookmarkControls: () => <div>Private controls</div> }))
vi.mock('../../web/components/souls/soul-artwork-image', () => ({ SoulArtworkImage: (props: any) => <img {...props} /> }))
vi.mock('../../web/components/souls/soul-cover-image', () => ({ SoulCoverImage: ({ children }: any) => <div>{children}</div> }))
vi.mock('../../web/components/souls/grant-modal', () => ({ GrantModal: (props: any) => {
  h.dialogs.grant = props; return <div role="dialog">Grant {props.soul.name}</div>
} }))
vi.mock('../../web/components/collections/collection-listing-modals', () => ({
  ListCollectionModal: (props: any) => { h.dialogs.list = props; return <div role="dialog">List {props.collection.name}</div> },
  EditCollectionPriceModal: (props: any) => { h.dialogs.reprice = props; return <div role="dialog">Reprice {props.collection.name}</div> },
  DelistCollectionModal: (props: any) => { h.dialogs.delist = props; return <div role="dialog">Delist {props.collection.name}</div> },
}))

let root: Root, host: HTMLDivElement, query: QueryClient, base: any, f: ReturnType<typeof mySoulsFixture>, input: any
beforeAll(async () => {
  // jsdom and Node structuredClone otherwise produce different Uint8Array realms.
  vi.stubGlobal('Uint8Array', structuredClone(new Uint8Array()).constructor)
  base = (await createBrowserSoulDetailModel()).compose()
})
afterAll(() => vi.unstubAllGlobals())
const render = async () => { await act(async () => root.render(<QueryClientProvider client={query}><MySoulsPage /></QueryClientProvider>)) }
const buttons = () => [...host.querySelectorAll<HTMLButtonElement>('button')]
const button = (text: string | RegExp) => buttons().find(b => typeof text === 'string' ? b.textContent === text : text.test(b.textContent ?? ''))!
const click = async (b: HTMLButtonElement) => { expect(b).toBeTruthy(); await act(async () => b.click()) }
const project = () => { h.my.data = composeMySoulsPortfolio(input) }
const held = (n = 500) => ({ ...f.collection(n), name: 'Held Collection ' + n, relationship: 'CREATED_HELD' as const,
  currentHolderAddress: f.owner, holderKioskId: id(7), personalKioskCapId: id(76) })
const listed = (n = 501) => ({ ...held(n), name: 'Listed Collection ' + n, status: 'LISTED' as const,
  listingId: id(n + 4000), priceAtomic: '2000000', isViewerListing: true })
const setCollections = (...rows: any[]) => { input.collections = { ...f.collections(), collections: rows }; project() }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.clearAllMocks(); h.dialogs = {}
  h.batch={snapshot:null,record:null,history:[],historyResults:{},loading:false,busy:false,pending:false,error:null,canStart:false,
    start:vi.fn(async()=>{}),refresh:vi.fn(async()=>{}),resume:vi.fn(async()=>{}),check:vi.fn(async()=>{}),cancelUnsigned:vi.fn(async()=>{}),retireExpired:vi.fn(async()=>{}),checkHistory:vi.fn(async()=>{})}
  f = mySoulsFixture()
  input = { owner: f.owner, originalPackageId: id(1), owned: f.owned('COMPLETE', [structuredClone(base)]),
    collections: f.collections('COMPLETE', 0), activity: f.activity('COMPLETE', 0) }
  h.my = { owner: f.owner, connected: true, identityKey: 'wallet-a:1', isLoading: false, error: null,
    refresh: vi.fn(async () => {}), resume: vi.fn(async () => {}), pause: vi.fn() }
  project(); query = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  h.ownedEquipment.mockReset().mockImplementation(async({owner,kind}:any)=>({owner,kind,rows:[],cursor:null,hasNextPage:false,notAuthorization:true}))
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); query.clear(); host.remove(); vi.restoreAllMocks() })

it('reads with a wallet alone and preserves all five tabs and original navigation', async () => {
  await render(); expect(h.useMy).toHaveBeenCalledWith()
  expect(buttons().filter(b => /^(Owned|Collections|Listings|Activity|Bookmarks)(?: \(\d+\))?$/.test(b.textContent ?? '')).map(b => b.textContent))
    .toEqual(['Owned (1)', 'Collections (0)', 'Listings (1)', 'Activity', 'Bookmarks'])
  expect(host.querySelector('a[href="/profile"]')).not.toBeNull(); expect(host.querySelector('a[href="/create"]')).not.toBeNull()
  expect(host.querySelector('a[href="/souls/' + base.onChainId + '"]')).not.toBeNull()
})
const checkbox=()=>host.querySelector<HTMLInputElement>('input[type=checkbox]')!
const setPrice=async(value:string)=>{await act(async()=>{
  const el=host.querySelector<HTMLInputElement>('input[inputmode=decimal]')!
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(el,value)
  el.dispatchEvent(new Event('input',{bubbles:true}))
})}
function nativeOwned(){
  input.owned=f.owned('COMPLETE',[{...structuredClone(base),provenanceKind:'animacraft',listingStatus:'unlisted',chainListingStatus:'HELD',
    currentOwnerAddress:f.owner,listingObjectOnChainId:null,listedPriceAtomic:null,activeGrants:[],activeGrantCount:'0'}]);project()
}
it('selects only an explicit native unlisted row, validates price, and retains the single Sell link',async()=>{
  nativeOwned();await render();expect(checkbox().checked).toBe(false)
  expect(h.batchCalls.mock.lastCall?.[0].selection).toEqual([])
  await click(checkbox() as any);expect(host.textContent).toContain('1/20')
  await setPrice('0.0000001');expect(h.batchCalls.mock.lastCall?.[0].selection).toEqual([])
  await setPrice('1.000001');expect(h.batchCalls.mock.lastCall?.[0].selection).toEqual([{soulId:base.onChainId,stateId:base.stateOnChainId,priceAtomic:'1000001'}])
  expect(host.querySelector(`a[href="/souls/${base.onChainId}/sell"]`)).not.toBeNull()
  expect(h.batch.start).not.toHaveBeenCalled()
})
it('filtering and switching tabs preserves hidden explicit selection without adding portfolio rows',async()=>{
  nativeOwned();await render();await click(checkbox() as any);await setPrice('2')
  await click(button(/Active grants only/));expect(checkbox()).toBeNull()
  expect(host.textContent).toContain('Selected Soul is hidden')
  expect(h.batchCalls.mock.lastCall?.[0].selection).toHaveLength(1)
  await click(button('Bookmarks'));expect(host.textContent).toContain('Selected Soul is hidden')
  expect(host.querySelector('[aria-label="Batch listing recovery"]')).not.toBeNull()
  await click(button(`Remove selected Soul ${base.name}`));expect(h.batchCalls.mock.lastCall?.[0].selection).toEqual([])
})
it('clears draft on identity and wallet transitions including ABA without resetting recovery mounting',async()=>{
  nativeOwned();await render();await click(checkbox() as any);await setPrice('2')
  h.my.identityKey='wallet-b:2';h.my.owner=id(999);await render()
  expect(h.batchCalls.mock.lastCall?.[0].selection).toEqual([])
  h.my.identityKey='wallet-a:1';h.my.owner=f.owner;await render()
  expect(h.batchCalls.mock.lastCall?.[0].selection).toEqual([]);expect(checkbox().checked).toBe(false)
  h.my.connected=false;h.my.owner=null;await render()
  expect(host.querySelector('[aria-label="Batch listing recovery"]')).not.toBeNull()
  expect(h.batchMounts).toHaveBeenCalledOnce()
})
it('progressive portfolio pages cannot add or remove an explicit selection',async()=>{
  nativeOwned();await render();await click(checkbox() as any);await setPrice('1')
  input.owned=f.owned('PARTIAL',[]);project();await render()
  expect(h.batchCalls.mock.lastCall?.[0].selection).toEqual([{soulId:base.onChainId,stateId:base.stateOnChainId,priceAtomic:'1000000'}])
  expect(host.textContent).toContain('Selected Soul is hidden')
  nativeOwned();await render();expect(checkbox().checked).toBe(true)
})
it('does not offer batch checkboxes for ordinary or already-listed Souls',async()=>{
  await render();expect(checkbox()).toBeNull()
  input.owned=f.owned('COMPLETE',[{...structuredClone(base),provenanceKind:'animacraft',listingStatus:'listed',chainListingStatus:'LISTED'}]);project()
  await render();expect(checkbox()).toBeNull()
})
it('caps explicit selection at twenty without default select-all or automatic truncation',async()=>{
  input.owned=f.owned('COMPLETE',Array.from({length:21},(_,index)=>({...structuredClone(base),onChainId:id(2000+index),stateOnChainId:id(3000+index),
    name:`Candidate ${index}`,provenanceKind:'animacraft',listingStatus:'unlisted',chainListingStatus:'HELD',
    currentOwnerAddress:f.owner,listingObjectOnChainId:null,listedPriceAtomic:null,activeGrants:[],activeGrantCount:'0'})));project();await render()
  for(let index=0;index<20;index++)await click(host.querySelector<HTMLInputElement>(`input[aria-label="Select Soul Candidate ${index}"]`)! as any)
  expect(host.textContent).toContain('20/20')
  expect(host.querySelector<HTMLInputElement>('input[aria-label="Select Soul Candidate 20"]')!.disabled).toBe(true)
  expect(host.querySelectorAll('input[type=checkbox]:checked')).toHaveLength(20)
  expect(h.batchCalls.mock.lastCall?.[0].selection).toEqual([])
})
async function componentRow(kind:'base'|'external'='base',equipped=false){
  const value=await equipmentMarketOperationFixture({kind,equipped}),snapshot=structuredClone(value.snapshot)
  // Page interaction fixture only; raw custody is covered by browser-owned-equipment.
  snapshot.actor=f.owner;snapshot.seller=f.owner
  return {request:{...value.request,actor:f.owner},snapshot}
}
async function flushComponents(){await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10))})}
const componentBox=(itemId:string)=>host.querySelector<HTMLInputElement>(`input[aria-label="Select component ${itemId}"]`)!
async function componentPrice(itemId:string,value:string){await act(async()=>{
  const el=host.querySelector<HTMLInputElement>(`input[aria-label="SUI price ${itemId}"]`)!
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))
})}
it('selects equipment without any Soul and retains that exact choice across pages, type changes and tabs',async()=>{
  const row=await componentRow(),itemId=row.request.itemId
  input.owned=f.owned('COMPLETE',[]);project()
  h.ownedEquipment.mockImplementation(async({owner,kind,cursor}:any)=>({owner,kind,rows:kind==='base'&&!cursor?[row]:[],
    cursor:kind==='base'&&!cursor?'AQ==':null,hasNextPage:kind==='base'&&!cursor,notAuthorization:true}))
  await render();await flushComponents()
  expect(componentBox(itemId).checked).toBe(false);await click(componentBox(itemId) as any);await componentPrice(itemId,'1.000000001')
  expect(h.batchCalls.mock.lastCall![0].selection).toEqual([{assetType:'equipment',rootId:row.request.rootId,itemId,kind:'base',priceAtomic:'1000000001'}])
  await click(button('Next component page'));await flushComponents()
  expect(componentBox(itemId)).toBeNull();expect(host.textContent).toContain('Selected component is hidden')
  expect(h.batchCalls.mock.lastCall![0].selection).toHaveLength(1)
  await act(async()=>{const select=host.querySelector<HTMLSelectElement>('select[aria-label="Wallet component type"]')!;select.value='external';select.dispatchEvent(new Event('change',{bubbles:true}))})
  await flushComponents();expect(h.batchCalls.mock.lastCall![0].selection).toHaveLength(1)
  await click(button('Bookmarks'));expect(h.batchCalls.mock.lastCall![0].selection).toHaveLength(1)
  await click(button(/^Owned/));await flushComponents();expect(componentBox(itemId).checked).toBe(true)
  expect(h.batch.start).not.toHaveBeenCalled()
})
it('selecting a Soul never checks its equipped component; each explicit choice joins the same draft',async()=>{
  nativeOwned();const row=await componentRow('base',true),itemId=row.request.itemId
  h.ownedEquipment.mockImplementation(async({owner,kind}:any)=>({owner,kind,rows:[row],cursor:null,hasNextPage:false,notAuthorization:true}))
  await render();await flushComponents()
  const soulBox=host.querySelector<HTMLInputElement>(`input[aria-label="Select Soul ${base.name}"]`)!
  await click(soulBox as any);await setPrice('1')
  expect(componentBox(itemId).checked).toBe(false);expect(h.batchCalls.mock.lastCall![0].selection).toHaveLength(1)
  await click(componentBox(itemId) as any);await componentPrice(itemId,'2')
  const sent=h.batchCalls.mock.lastCall![0].selection
  expect(sent).toHaveLength(2);expect(sent[0]).toMatchObject({soulId:base.onChainId})
  expect(sent[1]).toMatchObject({assetType:'equipment',itemId,equipmentScope:row.request.equipmentScope,priceAtomic:'2000000000'})
  h.my.identityKey='wallet-b:2';h.my.owner=id(999);await render();await flushComponents()
  expect(h.batchCalls.mock.lastCall![0].selection).toEqual([])
  h.my.identityKey='wallet-a:1';h.my.owner=f.owner;await render();await flushComponents()
  expect(h.batchCalls.mock.lastCall![0].selection).toEqual([]);expect(componentBox(itemId).checked).toBe(false)
})
it('failed component-page retry preserves the selected draft and retries the same cursor',async()=>{
  const row=await componentRow(),itemId=row.request.itemId;let fail=true
  h.ownedEquipment.mockImplementation(async({owner,kind,cursor}:any)=>{
    if(cursor&&fail)throw new Error('Inventory unavailable')
    return {owner,kind,rows:cursor?[]:[row],cursor:cursor?null:'AQ==',hasNextPage:!cursor,notAuthorization:true}
  })
  await render();await flushComponents();await click(componentBox(itemId) as any);await componentPrice(itemId,'1')
  await click(button('Next component page'));await flushComponents()
  expect(host.textContent).toContain('Inventory unavailable');expect(h.batchCalls.mock.lastCall![0].selection).toHaveLength(1)
  fail=false;await click(button('Refresh component page'));await flushComponents()
  expect(h.ownedEquipment.mock.lastCall![0].cursor).toBe('AQ==');expect(h.batchCalls.mock.lastCall![0].selection).toHaveLength(1)
})
it('uses one twenty-asset limit across Souls and components without selecting either automatically',async()=>{
  const row=await componentRow(),itemId=row.request.itemId
  h.ownedEquipment.mockImplementation(async({owner,kind}:any)=>({owner,kind,rows:[row],cursor:null,hasNextPage:false,notAuthorization:true}))
  input.owned=f.owned('COMPLETE',Array.from({length:20},(_,index)=>({...structuredClone(base),onChainId:id(2000+index),stateOnChainId:id(3000+index),
    name:`Mixed ${index}`,provenanceKind:'animacraft',listingStatus:'unlisted',chainListingStatus:'HELD',currentOwnerAddress:f.owner,
    listingObjectOnChainId:null,listedPriceAtomic:null,activeGrants:[],activeGrantCount:'0'})));project()
  await render();await flushComponents();await click(componentBox(itemId) as any)
  for(let index=0;index<19;index++)await click(host.querySelector<HTMLInputElement>(`input[aria-label="Select Soul Mixed ${index}"]`)! as any)
  expect(host.textContent).toContain('20/20');expect(componentBox(itemId).checked).toBe(true)
  expect(host.querySelector<HTMLInputElement>('input[aria-label="Select Soul Mixed 19"]')!.disabled).toBe(true)
  await click(componentBox(itemId) as any)
  expect(host.querySelector<HTMLInputElement>('input[aria-label="Select Soul Mixed 19"]')!.disabled).toBe(false)
})
it('shows authenticated unavailable components but never allows adding them to a sale',async()=>{
  const row=await componentRow('external',true);row.snapshot.available.list=false;row.snapshot.removal=null
  h.ownedEquipment.mockImplementation(async({owner,kind}:any)=>({owner,kind,rows:[row],cursor:null,hasNextPage:false,notAuthorization:true}))
  await render();await flushComponents()
  expect(componentBox(row.request.itemId).disabled).toBe(true)
  expect(host.textContent).toContain('transfer rights prohibit sale')
  expect(h.batchCalls.mock.lastCall![0].selection).toEqual([])
})
it('disconnected state offers wallet sign in without treating the absence as an empty portfolio', async () => {
  h.my.connected = false; h.my.owner = null; h.my.data = undefined; await render(); await click(button('Sign In'))
  expect(h.login).toHaveBeenCalledOnce(); expect(host.textContent).not.toContain('No owned Souls yet')
})
it('shows reader failures without false empty states and keeps explicit refresh available', async () => {
  h.my.data = undefined; h.my.error = Error('Target release unavailable'); await render()
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('Target release unavailable')
  expect(host.textContent).not.toContain('No owned Souls yet'); await click(button('Refresh portfolio'))
  expect(h.my.refresh).toHaveBeenCalledOnce()
})
it('distinguishes unscanned, partial and complete empty tabs without claiming exact totals', async () => {
  input.owned = null; input.collections = null; input.activity = null; project(); await render()
  expect(button('Owned')).toBeTruthy(); expect(button('Collections')).toBeTruthy(); expect(button('Listings (0+)')).toBeTruthy()
  expect(host.textContent).toContain('owned scan is incomplete'); await click(button('Collections'))
  expect(host.textContent).toContain('Collection scan is incomplete'); await click(button('Listings (0+)'))
  expect(host.textContent).not.toContain('No active listings'); await click(button('Activity'))
  expect(host.textContent).not.toContain('No activity yet')
  input.owned = f.owned('PARTIAL'); input.collections = f.collections('PARTIAL', 0); project(); await render()
  expect(button('Owned (0+)')).toBeTruthy(); expect(button('Collections (0+)')).toBeTruthy()
  input.owned = f.owned(); input.collections = f.collections('COMPLETE', 0); input.activity = f.activity('COMPLETE', 0); project(); await render()
  expect(button('Owned (0)')).toBeTruthy(); expect(button('Listings (0)')).toBeTruthy(); expect(host.textContent).toContain('No activity yet')
})
it('retains independent scan progress, errors and exact checkpoint with pause/retry/continue controls', async () => {
  const progress = (overrides: any) => ({ status: 'PARTIAL', pages: 2, busy: false, error: null, stage: null, checkpoint: null, limitReason: null, ...overrides })
  h.my.progress = { owned: progress({ busy: true }), collections: progress({ error: 'Same page unavailable', checkpoint: '9999999999999999' }),
    activity: progress({}) }
  await render(); await click(button('Pause Owned Souls')); await click(button('Retry Collection rights')); await click(button('Continue Activity history'))
  expect(h.my.pause).toHaveBeenCalledWith('owned'); expect(h.my.resume).toHaveBeenCalledWith('collections'); expect(h.my.resume).toHaveBeenCalledWith('activity')
  expect(host.textContent).toContain('Same page unavailable'); expect(host.textContent).toContain('Index checkpoint 9999999999999999')
  h.my.progress.activity.status = 'LIMIT_REACHED'; await render()
  const activity = host.querySelector('[data-portfolio-source="activity"]')!
  expect(activity.textContent).toContain('not a complete portfolio'); expect(activity.querySelector('button')).toBeNull()
})
it('uses effective grants rather than occupied expired slots in summary and filter', async () => {
  const expired = structuredClone(base); expired.onChainId = id(42); expired.name = 'Expired slots only'
  expired.activeGrants = expired.activeGrants.map((g: any) => ({ ...g, soulOnChainId: id(42), status: 'expired' }))
  input.owned = f.owned('COMPLETE', [structuredClone(base), expired]); project(); await render()
  expect(host.querySelector('[data-portfolio-stat="Active grants"]')?.textContent).toMatch(/^1Active grants/)
  expect(host.textContent).toContain('Expired slots only'); await click(button('Active grants only'))
  expect(host.textContent).not.toContain('Expired slots only'); expect(host.textContent).toContain(base.name)
  expect(host.textContent).toContain('Authorized Not recorded on chain')
  await click(button(/Manage Grant/)); expect(h.dialogs.grant.soul.onChainId).toBe(base.onChainId)
})
it('counts below-floor Souls and only this wallet Collection listings in the same sale set', async () => {
  input.owned.souls[0].listingStatus = 'floor-violation'
  const sold = { ...f.collection(502), status: 'LISTED', listingId: id(5502), priceAtomic: '7000000', isViewerListing: false }
  setCollections(listed(), sold); await render()
  expect(button('Listings (2)')).toBeTruthy()
  expect(host.querySelector('[data-portfolio-stat="Listed value"]')?.textContent).toContain('3 USDC')
  expect(host.querySelector('[data-portfolio-stat="Below-floor listings"]')?.textContent).toMatch(/^1/)
  expect(host.textContent).not.toContain('Pending Sigs'); await click(button('Listings (2)'))
  expect(host.textContent).toContain('Below collection floor'); expect(host.textContent).toContain('Listed Collection 501')
  expect(host.textContent).not.toContain('Sold Collection 502')
})
it('preserves created-held, created-sold and acquired groups with chain IDs and exact supply/royalty', async () => {
  setCollections({ ...held(), currentSupply: '9007199254740993', maxSupply: '18446744073709551615', extraRoyaltyBps: 123 },
    f.collection(502), { ...held(503), relationship: 'ACQUIRED', creatorAddress: id(999) })
  await render(); await click(button('Collections (3)'))
  expect(host.textContent).toContain('Created by me'); expect(host.textContent).toContain('Acquired Soul Collection Rights')
  expect(host.textContent).toContain('Sold Collection 502'); expect(host.textContent).toContain('Royalty now goes to buyer')
  expect(host.textContent).toContain('9007199254740993 / 18446744073709551615 Souls'); expect(host.textContent).toContain('Royalty 1.23%')
  expect(host.textContent).toContain('Launch date not recorded on chain')
  expect(button('List for Resale')).toBeTruthy(); await click(button('List Soul Collection'))
  expect(h.dialogs.list.collection).toEqual({ onChainId: id(500), name: 'Held Collection 500', listedPriceAtomic: null, listingObjectOnChainId: null })
})
it('keeps unavailable and nontradeable Collection rights visible without mutation buttons', async () => {
  setCollections({ ...held(), status: 'UNAVAILABLE' }, { ...held(503), rightTradeable: false })
  await render(); await click(button('Collections (2)'))
  expect(host.textContent).toContain('Listing state unavailable'); expect(host.textContent).toContain('Cannot be listed or transferred')
  expect(button('List Soul Collection')).toBeUndefined(); expect(button('Delist')).toBeUndefined()
})
it.each(['Collections (1)', 'Listings (2)'])('opens actual current listing hints from %s and invalidates after close', async tab => {
  setCollections(listed()); await render(); await click(button(tab)); await click(button('Edit Price'))
  expect(h.dialogs.reprice.collection.listingObjectOnChainId).toBe(id(4501))
  const invalidate = vi.spyOn(query, 'invalidateQueries')
  await act(async () => h.dialogs.reprice.onClose())
  expect(host.querySelector('[role="dialog"]')).toBeNull()
  if (tab.startsWith('Collections')) expect(invalidate).toHaveBeenCalledWith({ queryKey: ['my-souls'] })
  else expect(h.my.refresh).toHaveBeenCalledOnce()
})
it('clears selected dialogs across wallet/release ABA and ignores old close callbacks', async () => {
  setCollections(listed()); await render(); await click(button('Listings (2)')); await click(button('Edit Price'))
  const oldClose = h.dialogs.reprice.onClose
  h.my = { ...h.my, identityKey: 'wallet-b:2' }; await render(); expect(host.querySelector('[role="dialog"]')).toBeNull()
  h.my = { ...h.my, identityKey: 'wallet-a:3' }; await render(); expect(host.querySelector('[role="dialog"]')).toBeNull()
  await click(button('Edit Price')); await act(async () => oldClose())
  expect(host.querySelector('[role="dialog"]')).not.toBeNull(); expect(h.my.refresh).not.toHaveBeenCalled()
})
it('does not let an unmounted CollectionSection invalidate a new wallet portfolio on late close', async () => {
  setCollections(held()); await render(); await click(button('Collections (1)')); await click(button('List Soul Collection'))
  const oldClose = h.dialogs.list.onClose
  await click(button('Owned (1)')); h.my = { ...h.my, identityKey: 'wallet-b:2' }; await render()
  h.my = { ...h.my, identityKey: 'wallet-a:3' }; await render(); await click(button('Collections (1)')); await click(button('List Soul Collection'))
  const invalidate = vi.spyOn(query, 'invalidateQueries'); await act(async () => oldClose())
  expect(invalidate).not.toHaveBeenCalled(); expect(host.querySelector('[role="dialog"]')).not.toBeNull()
})
it('renders evidenced purchases and unavailable grant history without invented status or dates', async () => {
  input.activity = f.activity('PARTIAL', 2)
  Object.assign(input.activity.activity.grants[0], { scopes: ['assets'], scopeMask: 8 })
  Object.assign(input.activity.activity.grants[1], { status: 'revoked', endedAtMs: '18446744073709551615' })
  input.activity.activity.purchases[0].createdAtMs = '18446744073709551615'
  project(); await render(); await click(button('Activity'))
  expect(host.textContent).toContain('Status unknown until'); expect(host.textContent).toContain('assets')
  expect(host.textContent).toContain(formatChainTimestamp('18446744073709551615'))
  await click(button('unavailable 1')); expect(host.textContent).not.toContain('Ended')
  expect(host.querySelectorAll('a[href="/souls/' + id(3) + '"]')).toHaveLength(1)
})
it('exports the exact filtered chain grant CSV without SQL IDs or truncation', async () => {
  input.activity = f.activity('COMPLETE', 61); input.activity.activity.grants[60].status = 'revoked'
  project(); await render(); await click(button('Activity')); await click(button('revoked 1'))
  const create = vi.fn((_blob: Blob) => 'blob:grants'), revoke = vi.fn()
  Object.defineProperty(URL, 'createObjectURL', { value: create, configurable: true })
  Object.defineProperty(URL, 'revokeObjectURL', { value: revoke, configurable: true })
  const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  await click(button('Export CSV'))
  const blob: Blob = create.mock.calls[0][0]
  const csv = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob) })
  expect(csv).toBe(soulActivityGrantsCsv([h.my.data.grants[60]])); expect(anchorClick).toHaveBeenCalledOnce()
  expect(revoke).toHaveBeenCalledWith('blob:grants')
})
