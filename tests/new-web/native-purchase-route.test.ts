import { beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ auth:vi.fn(),rate:vi.fn(),find:vi.fn(),stored:vi.fn(),store:vi.fn(),sync:vi.fn(),end:vi.fn(),
  wait:vi.fn(),transaction:vi.fn(),sender:vi.fn(),assertSender:vi.fn(),env:vi.fn(),target:vi.fn(),client:vi.fn() }))
vi.mock('@soulidity/sdk', async original => ({...await original<typeof import('@soulidity/sdk')>(),
  getRequiredSoulidityEnv:m.env,waitForTransactionBestEffort:m.wait,getSuccessfulTransactionBlock:m.transaction,readTransactionSender:m.sender}))
vi.mock('../../web/lib/soulidity/server', () => ({requireHumanWalletIdentity:m.auth,assertTransactionSender:m.assertSender}))
vi.mock('../../web/lib/rate-limit', () => ({takeRateLimitToken:m.rate}))
vi.mock('../../web/lib/soulidity/repository', () => ({findSoulAssetDetailByRouteId:m.find}))
vi.mock('../../web/lib/soulidity/mirror/tx-sync', () => ({getStoredSoulidityTxSync:m.stored,storeSoulidityTxSync:m.store}))
vi.mock('../../web/lib/soulidity/mirror/sync-helpers', () => ({syncSoulProjectionFromChain:m.sync,endActiveSoulGrantProjectionsFromChain:m.end}))
vi.mock('../../web/lib/animacraft/native-receive', async original => ({...await original<typeof import('../../web/lib/animacraft/native-receive')>(),
  readNativeReceiveTarget:m.target,createNativeReceiveClient:m.client}))
import { POST } from '../../web/app/api/souls/[id]/purchase/route'
import { nativeReceiveFixture } from './fixtures/native-receive'
import { NativeReceiveError, NativeSoulStateBcs, NativeSoulBindingBcs, NativeSoulBcs } from '../../web/lib/animacraft/native-receive'
import { EquipmentPointerBcs } from '../../web/lib/animacraft/native-equipment'
const id = (n:number) => `0x${n.toString(16).padStart(64,'0')}`
let f: ReturnType<typeof nativeReceiveFixture>
let event: any
const post = () => POST(new Request('https://www.soulidity.ai/api/souls/test/purchase', {
  method:'POST',body:JSON.stringify({txDigest:f.input.txDigest})}),{params:Promise.resolve({id:id(12)})})
const edit = (objectId:string,schema:any,change:(value:any)=>void) => {
  const object = f.objects.get(objectId); const value = schema.parse(object.contents.value)
  change(value); object.contents.value=schema.serialize(value).toBytes()
}
beforeEach(() => {
  vi.resetAllMocks(); f=nativeReceiveFixture()
  m.auth.mockResolvedValue({identity:{memberId:'buyer-member'},walletAddresses:[id(11)]});m.rate.mockResolvedValue({limited:false})
  m.find.mockResolvedValue({onChainId:id(12),stateOnChainId:id(14),listingObjectOnChainId:id(30),provenanceKind:'animacraft',tags:[],previewImages:[]})
  m.env.mockReturnValue(id(6));m.sender.mockReturnValue(id(11));m.target.mockReturnValue(f.target);m.client.mockReturnValue(f.client)
  event={type:`${id(6)}::market::AnimacraftV8SoulPurchased`,parsedJson:{listing_id:id(30),soul_id:id(12),provenance_id:id(13),
    seller:id(40),buyer:id(11),maker_source_recipient:id(41),price:'10000',seller_payout:'9000',protocol_fee:'250',
    soul_creator_royalty_bps:'250',soul_creator_royalty:'250',maker_source_royalty_bps:'500',maker_source_royalty:'500'}}
  edit(id(13),NativeSoulBindingBcs,v=>{v.maker_creator=id(41);v.rights.soul_creator_royalty_bps=250;v.rights.maker_source_royalty_bps=500})
  edit(id(14),NativeSoulStateBcs,v=>{v.creator_royalty_bps=250})
  m.transaction.mockImplementation(async()=>({digest:f.input.txDigest,events:[event]}))
  m.sync.mockImplementation(async params=>{await params.expectedNativeHeldState?.verifyReadSet();return {onChainId:id(12),currentOwnerAddress:id(11),listingStatus:'held'}})
  vi.spyOn(console,'error').mockImplementation(()=>{})
})
it('verifies exact DF9 provenance and buyer custody before mirroring native gross price', async () => {
  const response=await post();expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({paidAtomic:'10000',totalAtomic:'10000',currentOwnerAddress:id(11)})
  expect(m.sync).toHaveBeenCalledWith(expect.objectContaining({expectedNativeHeldState:expect.objectContaining({ownerAddress:id(11),kioskId:id(18),ownershipEpoch:'0'})}))
  expect(m.store).toHaveBeenCalledWith(expect.objectContaining({routeKey:'buy',actorKey:'buyer-member',resourceKey:id(12),txDigest:f.input.txDigest}))
})
it.each(['soul_id','buyer'])('rejects event %s mismatch before any mirror',async key=>{
  event.parsedJson[key]=id(99);expect((await post()).status).toBe(422);expect(m.sync).not.toHaveBeenCalled()
})
it.each([id(29), null])('recovers a successful relisted purchase when the listing mirror is stale: %s',async listingId=>{
  m.find.mockResolvedValue({onChainId:id(12),stateOnChainId:id(14),listingObjectOnChainId:listingId,provenanceKind:'animacraft',tags:[],previewImages:[]})
  const response=await post();expect(response.status).toBe(200)
  expect(m.sync).toHaveBeenCalledWith(expect.objectContaining({listingObjectOnChainId:null,listingStatus:'held',
    expectedNativeHeldState:expect.objectContaining({ownerAddress:id(11),kioskId:id(18)})}))
  expect(m.store).toHaveBeenCalledOnce()
})
it('still rejects a substituted native binding when the listing mirror is stale',async()=>{
  m.find.mockResolvedValue({onChainId:id(12),stateOnChainId:id(14),listingObjectOnChainId:id(29),provenanceKind:'animacraft',tags:[],previewImages:[]})
  edit(f.dfId,EquipmentPointerBcs,v=>{v.value=id(99)})
  expect((await post()).status).toBe(422);expect(m.sync).not.toHaveBeenCalled()
})
it('rejects an RPC transaction from a different digest',async()=>{
  m.transaction.mockResolvedValueOnce({digest:'wrong-digest',events:[event]})
  expect((await post()).status).toBe(422);expect(m.sync).not.toHaveBeenCalled()
})
it('rejects an old provenance object instead of treating it as native DF9',async()=>{
  f.objects.get(id(13)).objectType=`${id(6)}::animacraft_provenance::AnimacraftProvenance`
  expect((await post()).status).toBe(422);expect(m.sync).not.toHaveBeenCalled()
})
it.each(['value','name','custody','immutable'])('requires exact DF9 key/value/custody and immutable binding: %s',async change=>{
  if(change==='immutable')f.objects.get(id(13)).owner.kind=3
  else if(change==='custody')f.objects.get(f.dfId).owner.address=id(99)
  else edit(f.dfId,EquipmentPointerBcs,v=>{if(change==='value')v.value=id(99);else v.name=8})
  expect((await post()).status).toBe(422);expect(m.sync).not.toHaveBeenCalled()
})
it.each(['soul_id','soul_state_id','protocol_config_id'])('rejects immutable binding %s mismatch',async key=>{
  edit(id(13),NativeSoulBindingBcs,v=>{v[key]=id(99)})
  expect((await post()).status).toBe(422);expect(m.store).not.toHaveBeenCalled()
})
it.each(['original_holder','maker_creator','creatorRate','sourceRate','stateCreator','soulCreator','stateRate'])('cross-checks immutable purchase creator/source/rates: %s',async change=>{
  if(change==='stateCreator'||change==='stateRate')edit(id(14),NativeSoulStateBcs,v=>{if(change==='stateCreator')v.creator=id(99);else v.creator_royalty_bps=300})
  else if(change==='soulCreator')edit(id(12),NativeSoulBcs,v=>{v.creator=id(99)})
  else edit(id(13),NativeSoulBindingBcs,v=>{
    if(change==='creatorRate')v.rights.soul_creator_royalty_bps=300
    else if(change==='sourceRate')v.rights.maker_source_royalty_bps=550
    else v[change]=id(99)
  })
  expect((await post()).status).toBe(422);expect(m.sync).not.toHaveBeenCalled()
})
it.each([[250,750],[0,1000],[1000,0]])('accepts native Core creator/source rates %i/%i',async(creator,source)=>{
  event.parsedJson.soul_creator_royalty_bps=String(creator);event.parsedJson.soul_creator_royalty=String(creator)
  event.parsedJson.maker_source_royalty_bps=String(source);event.parsedJson.maker_source_royalty=String(source)
  event.parsedJson.seller_payout='8750'
  edit(id(13),NativeSoulBindingBcs,v=>{v.rights.soul_creator_royalty_bps=creator;v.rights.maker_source_royalty_bps=source})
  edit(id(14),NativeSoulStateBcs,v=>{v.creator_royalty_bps=creator})
  expect((await post()).status).toBe(200)
})
it.each(['owner','listed','custody'])('fails closed after subsequent %s change',async change=>{
  if(change==='custody')f.objects.get(id(12)).owner.address=id(99)
  else edit(id(14),NativeSoulStateBcs,v=>{if(change==='owner')v.current_owner=id(99);else v.is_listed=true})
  expect([409,422]).toContain((await post()).status);expect(m.sync).not.toHaveBeenCalled()
})
it('reverifies mutable versions immediately before the mirror write',async()=>{
  m.sync.mockImplementationOnce(async params=>{f.objects.get(id(14)).version=3n;await params.expectedNativeHeldState.verifyReadSet()})
  expect((await post()).status).toBe(409);expect(m.store).not.toHaveBeenCalled();expect(m.end).not.toHaveBeenCalled()
})
it('returns explicit unavailable config without mirror success',async()=>{
  m.target.mockImplementation(()=>{throw new NativeReceiveError('NATIVE_RECEIVE_TARGET_UNAVAILABLE','private config',503)})
  const response=await post();expect(response.status).toBe(503);expect(await response.json()).toEqual({code:'NATIVE_RECEIVE_TARGET_UNAVAILABLE'})
  expect(m.sync).not.toHaveBeenCalled()
})
it('retains ordinary authenticated digest idempotency without adding native requirements',async()=>{
  m.find.mockResolvedValue({...await m.find(),provenanceKind:'native'})
  m.stored.mockResolvedValue({statusCode:200,responseBody:{replayed:true}})
  expect(await (await post()).json()).toEqual({replayed:true});expect(m.transaction).not.toHaveBeenCalled();expect(m.sync).not.toHaveBeenCalled()
})
it('retains auth, rate limit and transaction sender rejection',async()=>{
  m.auth.mockResolvedValueOnce({error:new Response(null,{status:401})});expect((await post()).status).toBe(401)
  m.rate.mockResolvedValueOnce({limited:true,retryAfterSeconds:30});expect((await post()).status).toBe(429)
  m.assertSender.mockReturnValueOnce(new Response(null,{status:403}));expect((await post()).status).toBe(403)
  expect(m.sync).not.toHaveBeenCalled()
})
it.each(['AnimacraftV5SoulPurchased','SoulPurchased'])('rejects %s as a substitute for the exact native purchase receipt',async name=>{
  event.type=`${id(6)}::market::${name}`
  const response=await post();expect(response.status).toBe(422)
  expect(await response.json()).toEqual({code:'NATIVE_PURCHASE_RECEIPT_REQUIRED'});expect(m.sync).not.toHaveBeenCalled()
})
it('preserves the existing ordinary Soul additive-price settlement',async()=>{
  m.find.mockResolvedValue({...await m.find(),provenanceKind:'native'})
  event.type=`${id(6)}::market::SoulPurchased`
  Object.assign(event.parsedJson,{platform_fee:'250',creator_royalty:'250',collection_royalty:'100'})
  const response=await post();expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({paidAtomic:'10000',totalAtomic:'10600'})
  expect(m.target).not.toHaveBeenCalled()
})
it('native replay verifies current custody but does not duplicate an already committed mirror',async()=>{
  m.stored.mockResolvedValue({statusCode:200,responseBody:{replayed:true}})
  expect(await (await post()).json()).toEqual({replayed:true});expect(m.transaction).toHaveBeenCalledOnce()
  expect(m.target).toHaveBeenCalledOnce();expect(m.sync).not.toHaveBeenCalled();expect(m.store).not.toHaveBeenCalled()
})
it.each(['owner','listed'])('native cached success cannot overwrite or falsely claim ownership after later %s change',async change=>{
  m.stored.mockResolvedValue({statusCode:200,responseBody:{listingStatus:'held',currentOwnerAddress:id(11)}})
  edit(id(14),NativeSoulStateBcs,value=>{if(change==='owner')value.current_owner=id(99);else value.is_listed=true})
  const response=await post();expect(response.status).toBe(409);expect(await response.json()).toEqual({code:'NATIVE_PURCHASE_OWNER_CHANGED'})
  expect(m.sync).not.toHaveBeenCalled();expect(m.store).not.toHaveBeenCalled()
})
