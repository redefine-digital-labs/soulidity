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
const params={packageId:'package',soulObjectId:'soul',stateObjectId:'state',tags:[],previewImages:[],
  currentKioskCapOnChainId:'cached-cap',currentOwnerMemberId:'buyer-member',expectedNativeHeldState:{
    ownerAddress:'buyer',kioskId:'kiosk',ownershipEpoch:'2',verifyReadSet:m.verify}}
beforeEach(()=>{
  vi.resetAllMocks();m.soul.mockResolvedValue({objectId:'soul',provenanceKind:'animacraft'})
  m.state.mockResolvedValue({objectId:'state',soulId:'soul',currentOwnerAddress:'buyer',currentKioskId:'kiosk',ownershipEpoch:2,isListed:false})
  m.caps.mockResolvedValue([{ownerAddress:'buyer',currentKioskId:'kiosk',currentKioskCapOnChainId:'current-cap'}])
  m.env.mockImplementation(()=>{throw new Error('Market fee config is not available')})
})
it('verifies exact native readset before writing the matching buyer mirror',async()=>{
  await syncSoulProjectionFromChain(params)
  expect(m.verify).toHaveBeenCalledOnce();expect(m.upsert).toHaveBeenCalledOnce()
  expect(m.verify.mock.invocationCallOrder[0]).toBeLessThan(m.upsert.mock.invocationCallOrder[0])
  expect(m.caps).toHaveBeenCalledWith('buyer')
  expect(m.upsert).toHaveBeenCalledWith(expect.objectContaining({currentKioskCapOnChainId:'current-cap'}))
  expect(m.registry).not.toHaveBeenCalled();expect(m.env).not.toHaveBeenCalled()
})
it.each([{currentOwnerAddress:'next-owner'},{soulId:'other-soul'},{objectId:'other-state'},
  {currentKioskId:'other-kiosk'},{ownershipEpoch:3},{isListed:true}])('never writes stale or mismatched State %j',async change=>{
  const state=await m.state();m.state.mockResolvedValue({...state,...change})
  await expect(syncSoulProjectionFromChain(params)).rejects.toThrow('ownership changed')
  expect(m.upsert).not.toHaveBeenCalled()
})
it.each([{objectId:'other-soul'},{provenanceKind:'native'}])('never writes nonmatching Soul %j',async change=>{
  m.soul.mockResolvedValue({objectId:'soul',provenanceKind:'animacraft',...change})
  await expect(syncSoulProjectionFromChain(params)).rejects.toThrow();expect(m.upsert).not.toHaveBeenCalled()
})
it('does not write after final readset drift',async()=>{
  m.verify.mockRejectedValue(new Error('version drift'))
  await expect(syncSoulProjectionFromChain(params)).rejects.toThrow('version drift');expect(m.upsert).not.toHaveBeenCalled()
})
it('preserves callers that do not request the native held-state guard',async()=>{
  await syncSoulProjectionFromChain({...params,expectedNativeHeldState:undefined})
  expect(m.verify).not.toHaveBeenCalled();expect(m.upsert).toHaveBeenCalledOnce()
  expect(m.caps).not.toHaveBeenCalled()
  expect(m.upsert).toHaveBeenCalledWith(expect.objectContaining({currentKioskCapOnChainId:'cached-cap'}))
})
it.each([{listingStatus:'listed' as const},{listingStatus:'floor-violation' as const},
  {listingObjectOnChainId:'old-listing'},{listedPriceAtomic:1n}])('rejects a non-held mirror override %s',async override=>{
  await expect(syncSoulProjectionFromChain({...params,...override})).rejects.toThrow('held-state')
  expect(m.caps).not.toHaveBeenCalled();expect(m.upsert).not.toHaveBeenCalled()
})
it('never writes when current cap lookup fails, even with a cached cap',async()=>{
  m.caps.mockRejectedValue(new Error('RPC unavailable'))
  await expect(syncSoulProjectionFromChain(params)).rejects.toThrow('RPC unavailable')
  expect(m.upsert).not.toHaveBeenCalled();expect(m.registry).not.toHaveBeenCalled()
})
it('selects only the cap for the verified current kiosk',async()=>{
  m.caps.mockResolvedValue([{ownerAddress:'buyer',currentKioskId:'other-kiosk',currentKioskCapOnChainId:'wrong-cap'},
    {ownerAddress:'other-owner',currentKioskId:'kiosk',currentKioskCapOnChainId:'substituted-cap'},
    {ownerAddress:'buyer',currentKioskId:'kiosk',currentKioskCapOnChainId:'current-cap'}])
  await syncSoulProjectionFromChain(params)
  expect(m.upsert).toHaveBeenCalledWith(expect.objectContaining({currentKioskCapOnChainId:'current-cap'}))
})
it('does not mirror when evidence changes during cap resolution',async()=>{
  m.caps.mockImplementation(async()=>{
    m.verify.mockRejectedValue(new Error('version drift during cap resolution'))
    return [{ownerAddress:'buyer',currentKioskId:'kiosk',currentKioskCapOnChainId:'current-cap'}]
  })
  await expect(syncSoulProjectionFromChain(params)).rejects.toThrow('version drift during cap resolution')
  expect(m.upsert).not.toHaveBeenCalled()
})
