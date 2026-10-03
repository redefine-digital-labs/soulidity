import { beforeEach, expect, it, vi } from 'vitest'
import { toBase58 } from '@mysten/sui/utils'
const m=vi.hoisted(()=>({auth:vi.fn(),limit:vi.fn(),find:vi.fn(),stored:vi.fn(),store:vi.fn(),wait:vi.fn(),tx:vi.fn(),sender:vi.fn(),
  assertSender:vi.fn(),env:vi.fn(),events:vi.fn(),verify:vi.fn(),readset:vi.fn(),mirror:vi.fn(),target:vi.fn(),client:vi.fn(),floor:vi.fn()}))
vi.mock('../../web/lib/prisma',()=>({prisma:{soulAsset:{updateMany:m.floor}}}))
vi.mock('../../web/lib/rate-limit',()=>({takeRateLimitToken:m.limit}))
vi.mock('../../web/lib/soulidity/server',()=>({requireHumanWalletIdentity:m.auth,assertTransactionSender:m.assertSender}))
vi.mock('../../web/lib/soulidity/repository',()=>({findSoulAssetDetailByRouteId:m.find}))
vi.mock('../../web/lib/soulidity/mirror/tx-sync',()=>({getStoredSoulidityTxSync:m.stored,storeSoulidityTxSync:m.store}))
vi.mock('../../web/lib/soulidity/mirror/sync-helpers',()=>({syncSoulProjectionFromChain:m.mirror}))
vi.mock('../../web/lib/animacraft/native-market-listing',()=>({verifyNativeMarketListing:m.verify}))
vi.mock('../../web/lib/animacraft/native-receive',async original=>({...await original<typeof import('../../web/lib/animacraft/native-receive')>(),
  readNativeReceiveTarget:m.target,createNativeReceiveClient:m.client}))
vi.mock('@soulidity/sdk',async original=>({...await original<typeof import('@soulidity/sdk')>(),
  waitForTransactionBestEffort:m.wait,getSuccessfulTransactionBlock:m.tx,readTransactionSender:m.sender,
  getRequiredSoulidityEnv:m.env,extractAllSoulListedEvents:m.events}))
import { NativeReceiveError } from '../../web/lib/animacraft/native-receive'
import { POST } from '../../web/app/api/souls/[id]/list/route'
import { nativeMarketListingFixture, lid } from './fixtures/native-market-listing'
import { NativeMarketListingBcs } from '../../web/lib/animacraft/native-market'
import { NativeSoulStateBcs } from '../../web/lib/animacraft/native-receive'
const id=(n:number)=>`0x${n.toString(16).padStart(64,'0')}`
const digest=toBase58(new Uint8Array(32).fill(8)),soulId=id(1),stateId=id(2),seller=id(3),kioskId=id(4),listingId=id(5),packageId=id(6)
const expected={ownerAddress:seller,kioskId,ownershipEpoch:'2',listingId,priceAtomic:1000000n,verifyReadSet:m.readset}
async function post(body:unknown={txDigest:digest}) {
  return POST(new Request('http://localhost/api/souls/'+soulId+'/list',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),
    {params:Promise.resolve({id:soulId})})
}
beforeEach(()=>{
  vi.resetAllMocks()
  m.auth.mockResolvedValue({identity:{memberId:'seller-member'},walletAddresses:[seller]})
  m.limit.mockResolvedValue({limited:false});m.stored.mockResolvedValue(null)
  m.find.mockResolvedValue({onChainId:soulId,stateOnChainId:stateId,provenanceKind:'animacraft',currentOwnerMemberId:'stale-member',
    currentKioskCapOnChainId:id(99),listingObjectOnChainId:id(98),listedPriceAtomic:'1',tags:['tag'],previewImages:[],readme:'text',creatorMemberId:'creator',collection:null})
  m.env.mockReturnValue(packageId);m.target.mockReturnValue({soulidityOriginalPackageId:packageId})
  m.tx.mockResolvedValue({digest,events:[]});m.sender.mockReturnValue(seller);m.assertSender.mockReturnValue(null)
  m.client.mockReturnValue({fixture:'client'});m.verify.mockResolvedValue(expected)
  m.mirror.mockResolvedValue({onChainId:soulId,listingObjectOnChainId:listingId,listedPriceAtomic:'1000000',listingStatus:'listed'})
  m.events.mockReturnValue([{soulId,listingId,priceAtomic:1000000n}])
})
it('uses authenticated exact native receipt, not old DB listing/cap or the generic legacy parser',async()=>{
  const res=await post();expect(res.status).toBe(200)
  expect(m.verify).toHaveBeenCalledWith({fixture:'client'},expect.anything(),expect.objectContaining({soulId,stateId,txDigest:digest,sender:seller}),expect.any(AbortSignal))
  expect(m.mirror).toHaveBeenCalledWith(expect.objectContaining({listingObjectOnChainId:listingId,listedPriceAtomic:1000000n,
    currentOwnerMemberId:'seller-member',expectedNativeListedState:expected,listingStatus:'listed'}))
  expect(m.events).not.toHaveBeenCalled();expect(m.floor).not.toHaveBeenCalled()
  expect(m.store).toHaveBeenCalledWith(expect.objectContaining({routeKey:'list',actorKey:'seller-member',resourceKey:soulId,txDigest:digest}))
})
it.each([null,id(90)])('works with missing/stale DB listing hint %s',async hint=>{
  m.find.mockResolvedValue({...await m.find(),listingObjectOnChainId:hint})
  expect((await post()).status).toBe(200)
  expect(m.mirror).toHaveBeenCalledWith(expect.objectContaining({listingObjectOnChainId:listingId}))
})
it('does not apply stale collection floor to verified collection-free native Soul',async()=>{
  m.find.mockResolvedValue({...await m.find(),collection:{floorPriceAtomic:'999999999'}})
  expect((await post()).status).toBe(200);expect(m.floor).not.toHaveBeenCalled()
})
it('revalidates cached native success without duplicate mirror/write',async()=>{
  const responseBody={txDigest:digest,soulOnChainId:soulId,listingStatus:'listed'}
  m.stored.mockResolvedValue({statusCode:200,responseBody})
  expect(await (await post()).json()).toEqual(responseBody)
  expect(m.verify).toHaveBeenCalledOnce();expect(m.readset).toHaveBeenCalledOnce()
  expect(m.mirror).not.toHaveBeenCalled();expect(m.store).not.toHaveBeenCalled()
})
it.each([false,true])('never returns historical success after later change, cached=%s',async cached=>{
  if(cached)m.stored.mockResolvedValue({statusCode:200,responseBody:{listingStatus:'listed'}})
  m.verify.mockRejectedValue(new NativeReceiveError('NATIVE_LISTING_STATE_CHANGED','Sold, cancelled or repriced',409))
  const res=await post();expect(res.status).toBe(409);expect(await res.json()).toEqual({code:'NATIVE_LISTING_STATE_CHANGED'})
  expect(m.mirror).not.toHaveBeenCalled();expect(m.store).not.toHaveBeenCalled()
})
it.each(['NATIVE_LISTING_INVALID','NATIVE_LISTING_BINDING_MISMATCH'])('rejects invalid native evidence %s',async code=>{
  m.verify.mockRejectedValue(new NativeReceiveError(code,'invalid receipt',422))
  const res=await post();expect(res.status).toBe(422);expect(await res.json()).toEqual({code})
  expect(m.events).not.toHaveBeenCalled();expect(m.mirror).not.toHaveBeenCalled()
})
it('returns unavailable, not superseded, for missing evidence',async()=>{
  m.verify.mockRejectedValue(new NativeReceiveError('NATIVE_LISTING_UNAVAILABLE','RPC unavailable',503))
  expect((await post()).status).toBe(503);expect(m.mirror).not.toHaveBeenCalled()
})
it('never falls back to the generic parser when native proof is missing',async()=>{
  m.verify.mockResolvedValue(undefined)
  expect((await post()).status).toBe(422);expect(m.events).not.toHaveBeenCalled();expect(m.mirror).not.toHaveBeenCalled()
})
it('refuses a different release target',async()=>{
  m.target.mockReturnValue({soulidityOriginalPackageId:id(88)})
  const res=await post();expect(res.status).toBe(503);expect(await res.json()).toEqual({code:'NATIVE_LISTING_TARGET_MISMATCH'})
  expect(m.verify).not.toHaveBeenCalled();expect(m.mirror).not.toHaveBeenCalled()
})
it('authenticates sender before native reads',async()=>{
  m.assertSender.mockReturnValue(new Response('not sender',{status:403}))
  expect((await post()).status).toBe(403);expect(m.verify).not.toHaveBeenCalled();expect(m.mirror).not.toHaveBeenCalled()
})
it('requires login before transaction lookup',async()=>{
  m.auth.mockResolvedValue({error:new Response('login',{status:401})})
  expect((await post()).status).toBe(401);expect(m.tx).not.toHaveBeenCalled()
})
it('rate limits before chain reads',async()=>{
  m.limit.mockResolvedValue({limited:true,retryAfterSeconds:42})
  const res=await post();expect(res.status).toBe(429);expect(res.headers.get('Retry-After')).toBe('42');expect(m.tx).not.toHaveBeenCalled()
})
it.each([{}, {txDigest:'bad'}, {txDigest:42}])('requires exact transaction digest %j',async body=>{
  expect((await post(body)).status).toBe(400);expect(m.tx).not.toHaveBeenCalled()
})
it('returns not found for missing Soul',async()=>{
  m.find.mockResolvedValue(null);expect((await post()).status).toBe(404);expect(m.tx).not.toHaveBeenCalled()
})
it('cached success final readset drift cannot report current listing success',async()=>{
  m.stored.mockResolvedValue({statusCode:200,responseBody:{listingStatus:'listed'}})
  m.readset.mockRejectedValue(new NativeReceiveError('NATIVE_EQUIPMENT_CHANGED','drift',409))
  const res=await post();expect(res.status).toBe(409);expect(await res.json()).toEqual({code:'NATIVE_EQUIPMENT_CHANGED'})
  expect(m.mirror).not.toHaveBeenCalled()
})
it('mirror rejects a race before writing and does not cache success',async()=>{
  m.mirror.mockRejectedValue(new NativeReceiveError('NATIVE_LISTING_STATE_CHANGED','changed during mirror',409))
  expect((await post()).status).toBe(409);expect(m.store).not.toHaveBeenCalled();expect(m.floor).not.toHaveBeenCalled()
})
it('preserves ordinary batch listing event selection',async()=>{
  m.find.mockResolvedValue({...await m.find(),provenanceKind:'native'})
  m.events.mockReturnValue([{soulId:id(77),listingId:id(78),priceAtomic:3n},{soulId,listingId,priceAtomic:1000000n}])
  expect((await post()).status).toBe(200);expect(m.verify).not.toHaveBeenCalled()
  expect(m.mirror).toHaveBeenCalledWith(expect.objectContaining({listingObjectOnChainId:listingId,currentOwnerMemberId:'stale-member',expectedNativeListedState:undefined}))
})
it('preserves ordinary floor suppression after confirmed listing mirror',async()=>{
  m.find.mockResolvedValue({...await m.find(),provenanceKind:'native',collection:{floorPriceAtomic:'2000000'}})
  const res=await post();expect(res.status).toBe(200);expect((await res.json()).listingStatus).toBe('floor-violation')
  expect(m.floor).toHaveBeenCalledWith({where:{onChainId:soulId},data:{listingStatus:'floor-violation'}})
  expect(m.mirror.mock.invocationCallOrder[0]).toBeLessThan(m.floor.mock.invocationCallOrder[0])
})
it('preserves ordinary cached idempotency',async()=>{
  m.find.mockResolvedValue({...await m.find(),provenanceKind:'native'})
  m.stored.mockResolvedValue({statusCode:200,responseBody:{ordinary:true}})
  expect(await (await post()).json()).toEqual({ordinary:true});expect(m.tx).not.toHaveBeenCalled();expect(m.verify).not.toHaveBeenCalled()
})
it('ordinary nonmatching receipt does not write',async()=>{
  m.find.mockResolvedValue({...await m.find(),provenanceKind:'native'});m.events.mockReturnValue([])
  expect((await post()).status).toBe(422);expect(m.mirror).not.toHaveBeenCalled()
})
it.each(['current','repriced','purchased','cancelled'])('integrates actual native BCS verifier into route: %s',async scenario=>{
  const f=nativeMarketListingFixture()
  const actual=await vi.importActual<typeof import('../../web/lib/animacraft/native-market-listing')>('../../web/lib/animacraft/native-market-listing')
  m.verify.mockImplementation(actual.verifyNativeMarketListing)
  m.client.mockReturnValue(f.client);m.target.mockReturnValue(f.target);m.tx.mockResolvedValue(f.transaction)
  m.sender.mockReturnValue(lid(11));m.auth.mockResolvedValue({identity:{memberId:'seller-member'},walletAddresses:[lid(11)]})
  m.find.mockResolvedValue({...await m.find(),onChainId:lid(12),stateOnChainId:lid(14),listingObjectOnChainId:lid(99)})
  if(scenario==='repriced') {
    // Actual atomic reprice retires L1 and creates L2; late L1 cannot mirror.
    f.edit(lid(30),NativeMarketListingBcs,v=>{v.is_active=false;v.purchase_cap=null})
  }
  if(scenario==='purchased')f.edit(lid(14),NativeSoulStateBcs,v=>{v.current_owner=lid(88);v.is_listed=false})
  if(scenario==='cancelled')f.edit(lid(14),NativeSoulStateBcs,v=>{v.is_listed=false})
  const res=await post({txDigest:f.listingInput.txDigest})
  expect(res.status).toBe(scenario==='current'?200:409)
  expect(m.events).not.toHaveBeenCalled()
  if(scenario==='current')expect(m.mirror).toHaveBeenCalledWith(expect.objectContaining({soulObjectId:lid(12),
    listingObjectOnChainId:lid(30),listedPriceAtomic:10001n,expectedNativeListedState:expect.objectContaining({ownerAddress:lid(11),ownershipEpoch:'7'})}))
  else {expect(await res.json()).toEqual({code:'NATIVE_LISTING_STATE_CHANGED'});expect(m.mirror).not.toHaveBeenCalled();expect(m.store).not.toHaveBeenCalled()}
})
