import { beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ auth:vi.fn(), rate:vi.fn(), find:vi.fn(), stored:vi.fn(), store:vi.fn(), sync:vi.fn(),
  wait:vi.fn(), transaction:vi.fn(), env:vi.fn(), target:vi.fn(), client:vi.fn() }))
vi.mock('@soulidity/sdk', async original => ({ ...await original<typeof import('@soulidity/sdk')>(),
  getRequiredSoulidityEnv:m.env, waitForTransactionBestEffort:m.wait, getSuccessfulTransactionBlock:m.transaction }))
vi.mock('../../web/lib/soulidity/server', async original => ({ ...await original<typeof import('../../web/lib/soulidity/server')>(),
  requireHumanWalletIdentity:m.auth }))
vi.mock('../../web/lib/rate-limit', () => ({ takeRateLimitToken:m.rate }))
vi.mock('../../web/lib/soulidity/repository', () => ({ findSoulAssetDetailByRouteId:m.find }))
vi.mock('../../web/lib/soulidity/mirror/tx-sync', () => ({ getStoredSoulidityTxSync:m.stored, storeSoulidityTxSync:m.store }))
vi.mock('../../web/lib/soulidity/mirror/sync-helpers', () => ({ syncSoulProjectionFromChain:m.sync }))
vi.mock('../../web/lib/animacraft/native-receive', async original => ({ ...await original<typeof import('../../web/lib/animacraft/native-receive')>(),
  readNativeReceiveTarget:m.target, createNativeReceiveClient:m.client }))
import { POST } from '../../web/app/api/souls/[id]/delist/route'
import { nativeReceiveFixture } from './fixtures/native-receive'
import { NativeReceiveError, NativeSoulStateBcs, NativeSoulBindingBcs, NativeSoulBcs } from '../../web/lib/animacraft/native-receive'
import { EquipmentPointerBcs } from '../../web/lib/animacraft/native-equipment'
import { NativeMarketListingBcs } from '../../web/lib/animacraft/native-market'
import { verifyNativeMarketCancellation } from '../../web/lib/animacraft/native-market-cancellation'
const id = (n:number) => `0x${n.toString(16).padStart(64,'0')}`
let f: ReturnType<typeof nativeReceiveFixture>
let event: any
let transaction: any
let soul: any
const post = (body?:unknown, signal?:AbortSignal) => POST(new Request('https://www.soulidity.ai/api/souls/test/delist', {
  method:'POST', body:JSON.stringify(body ?? { txDigest:f.input.txDigest }), signal }), { params:Promise.resolve({ id:id(12) }) })
const edit = (objectId:string, schema:any, change:(value:any)=>void) => {
  const object = f.objects.get(objectId), value = schema.parse(object.contents.value)
  change(value); object.contents.value = schema.serialize(value).toBytes()
}
beforeEach(() => {
  vi.resetAllMocks(); f = nativeReceiveFixture()
  for (const datatypeName of ['MarketConfigV2','SoulListing']) {
    f.objects.get(id(5)).package.typeOrigins.push({ moduleName:'market', datatypeName, packageId:id(6) })
  }
  f.objects.set(id(30), { objectId:id(30), version:2n, digest:'listing-digest', owner:{kind:3},
    objectType:`${id(6)}::market::SoulListing`, contents:{ value:NativeMarketListingBcs.serialize({
      id:id(30), version:'8', soul_id:id(12), state_id:id(14), seller:id(11), seller_kiosk_id:id(18), price:'10001',
      creator:id(11), creator_royalty_bps:750, collection_id:null, purchase_cap:null, is_active:false,
    }).toBytes() } })
  edit(id(14), NativeSoulStateBcs, value => { value.creator_royalty_bps=750; value.ownership_epoch='7' })
  edit(id(13), NativeSoulBindingBcs, value => {
    value.rights.soul_creator_royalty_bps=750; value.rights.maker_source_royalty_bps=250
  })
  soul = { onChainId:id(12), stateOnChainId:id(14), provenanceKind:'animacraft', listingObjectOnChainId:id(30),
    currentOwnerMemberId:'stale-member', creatorMemberId:'creator-member', tags:[], previewImages:[], readme:'readme' }
  m.auth.mockResolvedValue({identity:{memberId:'seller-member'},walletAddresses:[id(11)]})
  m.rate.mockResolvedValue({limited:false}); m.find.mockImplementation(async()=>soul)
  m.env.mockImplementation((name:string) => {
    if (name === 'NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID') return id(6)
    throw new Error('No market config, registry, fee or historical target is available')
  })
  m.target.mockReturnValue(f.target); m.client.mockReturnValue(f.client)
  event = { type:`${id(6)}::market::SoulListingCancelled`, parsedJson:{listing_id:id(30),soul_id:id(12),seller:id(11)} }
  transaction = { digest:f.input.txDigest, transaction:{data:{sender:id(11)}}, events:[event] }
  m.transaction.mockImplementation(async()=>transaction)
  m.sync.mockImplementation(async params => {
    await params.expectedNativeHeldState?.verifyReadSet()
    return { onChainId:id(12), listingStatus:'held' }
  })
  vi.spyOn(console,'error').mockImplementation(()=>{})
})

it('verifies actual native BCS receipt/custody without any market config or artwork reads', async () => {
  const response = await post()
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({txDigest:f.input.txDigest,soulOnChainId:id(12),listingStatus:'held'})
  expect(m.sync).toHaveBeenCalledWith(expect.objectContaining({currentOwnerMemberId:'seller-member',listingStatus:'held',
    listingObjectOnChainId:null,listedPriceAtomic:null,expectedNativeHeldState:expect.objectContaining({
      ownerAddress:id(11),kioskId:id(18),ownershipEpoch:'7',verifyReadSet:expect.any(Function)})}))
  expect(m.store).toHaveBeenCalledWith(expect.objectContaining({routeKey:'delist',actorKey:'seller-member',resourceKey:id(12)}))
  expect(m.env.mock.calls).toEqual([['NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID']])
  expect(new Set(f.calls.map(row=>row.objectId))).toEqual(new Set([id(5),id(4),id(14),id(12),f.itemFieldId,f.dfId,id(13),id(30)]))
})
it.each([null,id(99)])('does not trust a stale DB listing: %s',async listingId => {
  soul.listingObjectOnChainId=listingId
  expect((await post()).status).toBe(200); expect(m.store).toHaveBeenCalledOnce()
})
it.each(['missing','duplicate','alias','callable','wrong-type','fields','soul','seller','digest'])('rejects event %s substitution',async change => {
  if(change==='missing')transaction.events=[]
  if(change==='duplicate')transaction.events.push(structuredClone(event))
  if(change==='alias')event.type=`${id(99)}::market::SoulListingCancelled`
  if(change==='callable')event.type=`${id(5)}::market::SoulListingCancelled`
  if(change==='wrong-type')event.type=`${id(6)}::market::AnimacraftV6SoulListingCancelled`
  if(change==='fields')event.parsedJson.extra='untrusted'
  if(change==='soul')event.parsedJson.soul_id=id(99)
  if(change==='seller')event.parsedJson.seller=id(99)
  if(change==='digest')transaction.digest='different'
  expect((await post()).status).toBe(422); expect(m.sync).not.toHaveBeenCalled(); expect(m.store).not.toHaveBeenCalled()
})
it.each(['owner','relisted','kiosk','custody'])('cannot overwrite a later %s state',async change => {
  if(change==='custody')f.objects.get(id(12)).owner.address=id(99)
  else edit(id(14),NativeSoulStateBcs,value=>{
    if(change==='owner')value.current_owner=id(99)
    if(change==='relisted')value.is_listed=true
    if(change==='kiosk')value.current_kiosk_id=id(99)
  })
  expect([409,422]).toContain((await post()).status); expect(m.sync).not.toHaveBeenCalled()
})
it.each(['id','version','soul_id','state_id','seller','seller_kiosk_id','creator','creator_royalty_bps','collection_id','purchase_cap','is_active'])
('requires exact inactive cancelled listing %s',async key => {
  edit(id(30),NativeMarketListingBcs,value=>{
    value[key]=key==='version'?'5':key==='creator_royalty_bps'?500:key==='is_active'?true:key==='purchase_cap'
      ?{id:id(32),kiosk_id:id(18),item_id:id(12),min_price:'0'}:id(99)
  })
  expect((await post()).status).toBe(422); expect(m.sync).not.toHaveBeenCalled()
})
it.each(['field-id','field-name','field-value','field-custody','immutable','old-type','listing-origin'])('rejects replaced authority: %s',async change => {
  if(change==='field-custody')f.objects.get(f.dfId).owner.address=id(99)
  else if(change==='immutable')f.objects.get(id(13)).owner.kind=3
  else if(change==='old-type')f.objects.get(id(13)).objectType=`${id(6)}::animacraft_provenance::AnimacraftProvenance`
  else if(change==='listing-origin')f.objects.get(id(5)).package.typeOrigins.find((row:any)=>row.datatypeName==='SoulListing').packageId=id(99)
  else edit(f.dfId,EquipmentPointerBcs,value=>{
    if(change==='field-id')value.id=id(99)
    if(change==='field-name')value.name=8
    if(change==='field-value')value.value=id(99)
  })
  expect((await post()).status).toBe(422); expect(m.sync).not.toHaveBeenCalled()
})
it.each(['id','version','soul_id','soul_state_id','protocol_config_id','original_holder','creatorRate','stateCreator','soulCreator'])
('binds immutable native identity and creator rights: %s',async key => {
  if(key==='stateCreator')edit(id(14),NativeSoulStateBcs,value=>{value.creator=id(99)})
  else if(key==='soulCreator')edit(id(12),NativeSoulBcs,value=>{value.creator=id(99)})
  else edit(id(13),NativeSoulBindingBcs,value=>{
    if(key==='creatorRate')value.rights.soul_creator_royalty_bps=500
    else value[key]=key==='version'?'7':id(99)
  })
  expect((await post()).status).toBe(422); expect(m.store).not.toHaveBeenCalled()
})
it.each([id(14),id(12),id(30)])('rechecks %s immediately before mirror mutation',async objectId => {
  m.sync.mockImplementationOnce(async params=>{f.objects.get(objectId).version=3n;await params.expectedNativeHeldState.verifyReadSet()})
  expect((await post()).status).toBe(409); expect(m.store).not.toHaveBeenCalled()
})
it('rejects initial readset drift after dependent listing reads',async()=>{
  const original=f.client.ledgerService.getObject.bind(f.client.ledgerService)
  f.client.ledgerService.getObject=async request=>{
    const result=await original(request)
    if(request.objectId===id(30))f.objects.get(id(14)).version=3n
    return result
  }
  expect((await post()).status).toBe(409);expect(m.sync).not.toHaveBeenCalled()
})
it('snapshots injected inputs before await and observes abort on final readset',async()=>{
  const controller=new AbortController()
  const input={soulId:id(12),stateId:id(14),txDigest:f.input.txDigest,sender:id(11),transaction}
  const reading=verifyNativeMarketCancellation(f.client,f.target,input,controller.signal)
  input.soulId=id(99);event.parsedJson.seller=id(99)
  const result=await reading
  expect(result.ownerAddress).toBe(id(11))
  controller.abort()
  await expect(result.verifyReadSet()).rejects.toBeInstanceOf(Error)
})
it('surfaces unavailable target safely and never mirrors success',async()=>{
  m.target.mockImplementation(()=>{throw new NativeReceiveError('NATIVE_RECEIVE_TARGET_UNAVAILABLE','private config',503)})
  const response=await post();expect(response.status).toBe(503)
  expect(await response.json()).toEqual({code:'NATIVE_RECEIVE_TARGET_UNAVAILABLE'});expect(m.sync).not.toHaveBeenCalled()
})
it('rejects a different configured original package',async()=>{
  m.env.mockReturnValue(id(99));expect((await post()).status).toBe(503);expect(m.sync).not.toHaveBeenCalled()
})
it('retains authenticated digest idempotency without rereading moved objects',async()=>{
  m.stored.mockResolvedValue({statusCode:200,responseBody:{replayed:true}})
  expect(await (await post()).json()).toEqual({replayed:true});expect(m.transaction).not.toHaveBeenCalled();expect(m.sync).not.toHaveBeenCalled()
  expect(m.stored).toHaveBeenCalledWith({routeKey:'delist',txDigest:f.input.txDigest,actorKey:'seller-member',resourceKey:id(12)})
})
it('retains auth, rate, digest, not-found and actual sender rejection',async()=>{
  m.auth.mockResolvedValueOnce({error:new Response(null,{status:401})});expect((await post()).status).toBe(401)
  m.rate.mockResolvedValueOnce({limited:true,retryAfterSeconds:30});expect((await post()).status).toBe(429)
  expect((await post({txDigest:'bad'})).status).toBe(400)
  m.find.mockResolvedValueOnce(null);expect((await post()).status).toBe(404)
  transaction.transaction.data.sender=id(99);expect((await post()).status).toBe(403)
  expect(m.sync).not.toHaveBeenCalled()
})
it('preserves ordinary cancellation without a native target or appearance/V6 reads',async()=>{
  soul.provenanceKind='native'
  expect((await post()).status).toBe(200)
  expect(m.target).not.toHaveBeenCalled();expect(m.client).not.toHaveBeenCalled()
  expect(m.sync).toHaveBeenCalledWith(expect.objectContaining({currentOwnerMemberId:'stale-member',expectedNativeHeldState:undefined}))
})
it.each(['soul','listing'])('retains ordinary %s mismatch rejection',async field=>{
  soul.provenanceKind='native'
  if(field==='soul')event.parsedJson.soul_id=id(99)
  else soul.listingObjectOnChainId=id(99)
  expect((await post()).status).toBe(422);expect(m.sync).not.toHaveBeenCalled()
})
