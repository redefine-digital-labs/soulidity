import {expect,it,vi} from 'vitest'
import {readPublicCommunityIdentity} from '../../web/lib/community/public-profile-read'
import {getBrowserProfileReadConfig,getBrowserProfileConfig} from '../../web/lib/profile/profile-config'
const id=`0x${'1'.repeat(64)}`
function fixture(){
  const profile={id,owner:`0x${'2'.repeat(64)}`,revision:'1',handle:'fox',metadata:{blobId:'one'}} as any
  const byId=vi.fn(async()=>structuredClone(profile)),byHandle=vi.fn(async()=>structuredClone(profile))
  const metadata=vi.fn(async()=>({metadata:{displayName:'Fox'},storageEndEpoch:99} as any))
  const config={deployment:{registryId:'registry'},storage:{aggregatorUrl:'https://public.example'}} as any
  const input={spaceId:id,client:{} as any,config}
  return {profile,byId,byHandle,metadata,input}
}
it.each([id,'fox','@FOX'])('reads %s through exact registry authority and rechecks after metadata',async spaceId=>{
  const f=fixture(),result=await readPublicCommunityIdentity({...f.input,spaceId},f)
  expect(result.profile).toEqual(f.profile);expect(result.metadata.displayName).toBe('Fox')
  expect(spaceId===id?f.byId:f.byHandle).toHaveBeenCalledTimes(2)
  expect(spaceId===id?f.byHandle:f.byId).not.toHaveBeenCalled()
  expect(result).not.toHaveProperty('posts');expect(result).not.toHaveProperty('kind');expect(result).not.toHaveProperty('level')
})
it.each(['revision','owner','id','handle'])('rejects %s changing during metadata download',async field=>{
  const f=fixture();f.metadata.mockImplementation(async()=>{f.profile[field]='changed';return {metadata:{},storageEndEpoch:99} as any})
  await expect(readPublicCommunityIdentity({...f.input,spaceId:'fox'},f)).rejects.toThrow('CHANGED_RETRY')
})
it('propagates unavailable metadata instead of returning a blank profile',async()=>{
  const f=fixture();f.metadata.mockRejectedValue(new Error('storage unavailable'))
  await expect(readPublicCommunityIdentity(f.input,f)).rejects.toThrow('storage unavailable')
})
it('captures release configuration before asynchronous reads',async()=>{
  const f=fixture();f.byId.mockImplementation(async()=>{f.input.config.deployment.registryId='changed';return structuredClone(f.profile)})
  await readPublicCommunityIdentity(f.input,f)
  expect(f.byId.mock.calls.every(([input]:any)=>input.deployment.registryId==='registry')).toBe(true)
})
it('does no read after cancellation',async()=>{
  const f=fixture(),controller=new AbortController();controller.abort()
  await expect(readPublicCommunityIdentity({...f.input,signal:controller.signal},f)).rejects.toThrow()
  expect(f.byId).not.toHaveBeenCalled()
})
it('does not require a write switch for public reads but still requires it for write configuration',()=>{
  const env={NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID:id,NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID:id,
    NEXT_PUBLIC_SOULIDITY_PROFILE_REGISTRY_ID:id,NEXT_PUBLIC_SUI_CHAIN_IDENTIFIER:'12345678',
    NEXT_PUBLIC_WALRUS_BLOB_TYPE:`${id}::blob::Blob`,NEXT_PUBLIC_WALRUS_AGGREGATOR_URL:'https://public.example',
    NEXT_PUBLIC_SOULIDITY_PROFILE_WRITES_ENABLED:''}
  try{
    for(const [key,value] of Object.entries(env))vi.stubEnv(key,value)
    expect(getBrowserProfileReadConfig().deployment.registryId).toBe(id)
    expect(()=>getBrowserProfileConfig()).toThrow('PROFILE_WRITE_CONFIGURATION_REQUIRED')
  }finally{vi.unstubAllEnvs()}
})
