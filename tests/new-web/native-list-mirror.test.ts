import { beforeEach, expect, it, vi } from 'vitest'
const m=vi.hoisted(()=>({soul:vi.fn(),state:vi.fn(),upsert:vi.fn(),verify:vi.fn(),caps:vi.fn(),registry:vi.fn(),env:vi.fn()}))
vi.mock('@soulidity/sdk',async original=>({...await original<typeof import('@soulidity/sdk')>(),getSoulObject:m.soul,getSoulStateObject:m.state,
  listOwnedPersonalKioskCaps:m.caps,getRegisteredPersonalKiosk:m.registry,getRequiredSoulidityEnv:m.env}))
vi.mock('../../web/lib/soulidity/mirror/upsert-soul',()=>({upsertSoulProjection:m.upsert}))
vi.mock('../../web/lib/soulidity/mirror/upsert-grant',()=>({}))
vi.mock('../../web/lib/soulidity/mirror/upsert-collection',()=>({}))
vi.mock('../../web/lib/soulidity/mirror/upsert-content-version',()=>({}))
vi.mock('../../web/lib/soulidity/mirror/upsert-paid-access',()=>({}))
import { syncSoulProjectionFromChain } from '../../web/lib/soulidity/mirror/sync-helpers'
const expected={ownerAddress:'seller',kioskId:'kiosk',ownershipEpoch:'2',listingId:'new-listing',priceAtomic:1000000n,verifyReadSet:m.verify}
const params={packageId:'package',soulObjectId:'soul',stateObjectId:'state',tags:[],previewImages:[],
  currentKioskCapOnChainId:'cached-cap',currentOwnerMemberId:'seller-member',expectedNativeListedState:expected,
  listingObjectOnChainId:'new-listing',listedPriceAtomic:1000000n,listingStatus:'listed' as const}
beforeEach(()=>{
  vi.resetAllMocks();m.soul.mockResolvedValue({objectId:'soul',provenanceKind:'animacraft'})
  m.state.mockResolvedValue({objectId:'state',soulId:'soul',currentOwnerAddress:'seller',currentKioskId:'kiosk',ownershipEpoch:2,isListed:true})
  m.caps.mockResolvedValue([{ownerAddress:'seller',currentKioskId:'kiosk',currentKioskCapOnChainId:'actual-cap'}])
  m.env.mockImplementation(()=>{throw new Error('Market config unavailable')})
})
it('mirrors verified new listing using current owned cap, not stale DB hints or fee gates',async()=>{
  await syncSoulProjectionFromChain(params)
  expect(m.upsert).toHaveBeenCalledWith(expect.objectContaining({listingObjectOnChainId:'new-listing',listedPriceAtomic:1000000n,
    currentKioskCapOnChainId:'actual-cap',currentOwnerMemberId:'seller-member',listingStatus:'listed'}))
  expect(m.verify).toHaveBeenCalledOnce();expect(m.verify.mock.invocationCallOrder[0]).toBeLessThan(m.upsert.mock.invocationCallOrder[0])
  expect(m.env).not.toHaveBeenCalled();expect(m.registry).not.toHaveBeenCalled()
})
it.each([{currentOwnerAddress:'buyer'},{soulId:'other-soul'},{objectId:'other-state'},
  {currentKioskId:'buyer-kiosk'},{ownershipEpoch:3},{isListed:false}])('rejects changed native State %j',async change=>{
  m.state.mockResolvedValue({...await m.state(),...change})
  await expect(syncSoulProjectionFromChain(params)).rejects.toMatchObject({code:'NATIVE_LISTING_STATE_CHANGED',status:409})
  expect(m.upsert).not.toHaveBeenCalled();expect(m.caps).not.toHaveBeenCalled()
})
it.each([{objectId:'other-soul'},{provenanceKind:'native'}])('rejects incompatible Soul %j',async change=>{
  m.soul.mockResolvedValue({...await m.soul(),...change})
  await expect(syncSoulProjectionFromChain(params)).rejects.toThrow();expect(m.upsert).not.toHaveBeenCalled()
})
it.each([{listingStatus:'held' as const},{listingStatus:'floor-violation' as const},
  {listingObjectOnChainId:'old-listing'},{listedPriceAtomic:999n},{listingObjectOnChainId:null},{listedPriceAtomic:null}])(
  'rejects mirror arguments that differ from the receipt %s',async change=>{
    await expect(syncSoulProjectionFromChain({...params,...change})).rejects.toThrow('listing changed')
    expect(m.upsert).not.toHaveBeenCalled()
  })
it('rejects conflicting held and listed guards',async()=>{
  await expect(syncSoulProjectionFromChain({...params,expectedNativeHeldState:expected})).rejects.toThrow('Conflicting')
  expect(m.soul).not.toHaveBeenCalled();expect(m.upsert).not.toHaveBeenCalled()
})
it('rechecks chain evidence after awaited cap discovery before any write',async()=>{
  m.caps.mockImplementation(async()=>{
    m.verify.mockRejectedValue(new Error('listing repriced during lookup'))
    return [{ownerAddress:'seller',currentKioskId:'kiosk',currentKioskCapOnChainId:'actual-cap'}]
  })
  await expect(syncSoulProjectionFromChain(params)).rejects.toThrow('repriced')
  expect(m.upsert).not.toHaveBeenCalled()
})
it('ignores caps for another owner or kiosk',async()=>{
  m.caps.mockResolvedValue([{ownerAddress:'buyer',currentKioskId:'kiosk',currentKioskCapOnChainId:'wrong-owner'},
    {ownerAddress:'seller',currentKioskId:'wrong-kiosk',currentKioskCapOnChainId:'wrong-kiosk'},
    {ownerAddress:'seller',currentKioskId:'kiosk',currentKioskCapOnChainId:'actual-cap'}])
  await syncSoulProjectionFromChain(params)
  expect(m.upsert).toHaveBeenCalledWith(expect.objectContaining({currentKioskCapOnChainId:'actual-cap'}))
})
it('does not convert cap discovery RPC failure into success',async()=>{
  m.caps.mockRejectedValue(new Error('RPC unavailable'))
  await expect(syncSoulProjectionFromChain(params)).rejects.toThrow('RPC unavailable')
  expect(m.upsert).not.toHaveBeenCalled()
})
