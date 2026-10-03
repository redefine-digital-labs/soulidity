import {expect,it,vi} from 'vitest'
import {fromBase58,toHex} from '@mysten/sui/utils'
import {createBrowserEquipmentMarketDiscovery} from '../../web/lib/animacraft/browser-equipment-market-discovery'
import {equipmentMarketOperationFixture,emid} from './fixtures/equipment-market-operation'
import {EquipmentMarketListingBcs} from '../../web/lib/animacraft/native-equipment-market-bcs'
import {MAINNET_GENESIS_DIGEST} from '../../web/lib/animacraft/mainnet-chain'
async function fixture(){
  const f=await equipmentMarketOperationFixture({action:'buy'}),lifetime=new AbortController(),pages=[[f.listingId]]
  const chainIdentifier=toHex(fromBase58(MAINNET_GENESIS_DIGEST).slice(0,4))
  const fetcher=vi.fn<typeof fetch>().mockImplementation(async(_url,options)=>{
    const query=JSON.parse(String(options?.body)),index=query.variables.after===null?0:Number(query.variables.after.slice(1)),ids=pages[index]??[]
    return new Response(JSON.stringify({data:{chainIdentifier:MAINNET_GENESIS_DIGEST,checkpoint:{sequenceNumber:100,query:{objects:{
      nodes:ids.map(address=>({address})),pageInfo:{hasNextPage:index+1<pages.length,endCursor:ids.length?`c${index+1}`:null}}}}}}))
  })
  const params={client:f.client,config:{target:f.target},endpoint:'https://graphql.mainnet.sui.io/graphql',chainIdentifier,
    paymentCoinType:f.coin,actor:null,signal:lifetime.signal}
  return {...f,lifetime,pages,fetcher,params,create:()=>createBrowserEquipmentMarketDiscovery(params,{fetch:fetcher})}
}
it('authenticates anonymous GraphQL IDs through actual raw package, listing, quote and custody reads',async()=>{
  const f=await fixture(),reader=f.create(),page=await reader.next()
  expect(page).toMatchObject({candidateStatus:'COMPLETE',verifiedCandidates:1,notAuthorization:true,readConsistency:'NON_ATOMIC_CURRENT_READSET'})
  expect(page.listings[0]).toMatchObject({listing:{id:f.listingId,status:0},rootId:f.rootId,asset:{item:{id:f.itemId}},buyAvailable:false})
  expect(Object.isFrozen(page.listings[0])).toBe(true);await expect(reader.next()).rejects.toThrow('scan ended')
  const query=JSON.parse(String(f.fetcher.mock.calls[0][1]!.body))
  expect(query.variables.filter.type).toBe(`${f.marketPin.originalPackageId}::market_v8::EquipmentListingV8<${f.coin}>`)
})
it('returns actor-specific eligibility only after actual duplicate-entitlement verification',async()=>{
  const f=await fixture(),reader=createBrowserEquipmentMarketDiscovery({...f.params,actor:f.actor},{fetch:f.fetcher})
  expect((await reader.next()).listings[0].buyAvailable).toBe(true)
})
it('retains a failed terminal candidate page and retries without advancing GraphQL',async()=>{
  const f=await fixture(),reader=f.create(),item=f.objects.get(f.itemId),prior=item.owner
  item.owner={kind:1,address:emid(999)}
  await expect(reader.next()).rejects.toThrow();item.owner=prior
  expect((await reader.next()).listings).toHaveLength(1);expect(f.fetcher).toHaveBeenCalledOnce()
})
it('authenticates and counts terminal listings but excludes them from open market results',async()=>{
  const f=await fixture();f.set(f.listingId,EquipmentMarketListingBcs,row=>{row.status=2;row.terminal_recipient=f.owner})
  const page=await f.create().next();expect(page.verifiedCandidates).toBe(1);expect(page.listings).toEqual([])
})
it('keeps earlier cumulative results when subsequent discovery fails',async()=>{
  const f=await fixture();f.pages.push([emid(999)])
  const reader=f.create(),first=await reader.next();expect(first.candidateStatus).toBe('PARTIAL')
  await expect(reader.next()).rejects.toThrow();expect(first.listings).toHaveLength(1)
  expect(f.fetcher).toHaveBeenCalledTimes(2)
})
it('rejects a substituted callable package before candidate discovery',async()=>{
  const f=await fixture();f.objects.get(f.marketPin.callablePackageId).digest='wrong'
  await expect(f.create().next()).rejects.toThrow('package pin mismatch');expect(f.fetcher).not.toHaveBeenCalled()
})
it('rejects the wrong chain and aborted lifetime without reading',async()=>{
  const f=await fixture();expect(()=>createBrowserEquipmentMarketDiscovery({...f.params,chainIdentifier:'00000000'})).toThrow('mainnet')
  f.lifetime.abort(new Error('replaced'));await expect(f.create().next()).rejects.toThrow('replaced');expect(f.fetcher).not.toHaveBeenCalled()
})
