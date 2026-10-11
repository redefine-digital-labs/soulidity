import {afterEach,expect,it,vi} from 'vitest'
import {getBrowserVoteConfig,getBrowserVoteReadConfig} from '../../web/lib/community/vote-config'
afterEach(()=>vi.unstubAllEnvs())
const id=(n:number)=>`0x${n.toString(16).padStart(64,'0')}`
function configure(){
  const values={NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID:id(1),NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID:id(2),NEXT_PUBLIC_SOULIDITY_PROFILE_REGISTRY_ID:id(3),NEXT_PUBLIC_SOULIDITY_COMMUNITY_REGISTRY_ID:id(4),NEXT_PUBLIC_SOULIDITY_COMMUNITY_VOTE_REGISTRY_ID:id(5),NEXT_PUBLIC_SUI_CHAIN_IDENTIFIER:'01010101',NEXT_PUBLIC_SOULIDITY_COMMUNITY_VOTES_WRITES_ENABLED:'',NEXT_PUBLIC_WALRUS_BLOB_TYPE:'',NEXT_PUBLIC_WALRUS_AGGREGATOR_URL:''}
  for(const [key,value]of Object.entries(values))vi.stubEnv(key,value)
}
it('permits public reads without upload settings or write permission',()=>{
  configure();expect(getBrowserVoteReadConfig().deployment.registryId).toBe(id(5))
  expect(()=>getBrowserVoteConfig()).toThrow('WRITE_CONFIGURATION_REQUIRED')
})
it.each(['true','false'])('requires explicit write switch %s',writes=>{
  configure();vi.stubEnv('NEXT_PUBLIC_SOULIDITY_COMMUNITY_VOTES_WRITES_ENABLED',writes)
  expect(getBrowserVoteConfig().writesEnabled).toBe(writes==='true')
})
it('never falls back to a community registry when vote registry is missing',()=>{
  configure();vi.stubEnv('NEXT_PUBLIC_SOULIDITY_COMMUNITY_VOTE_REGISTRY_ID','')
  expect(()=>getBrowserVoteReadConfig()).toThrow('INVALID_ID')
})
