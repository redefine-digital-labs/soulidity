import {assertPublicCommunityVotesDeployment,type PublicCommunityVotesDeployment} from '@soulidity/sdk'
export interface BrowserVoteReadConfig {deployment:PublicCommunityVotesDeployment}
export function getBrowserVoteReadConfig():BrowserVoteReadConfig {
  return {deployment:assertPublicCommunityVotesDeployment({community:{profile:{
    originalPackageId:process.env.NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID??'',
    callablePackageId:process.env.NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID??'',
    registryId:process.env.NEXT_PUBLIC_SOULIDITY_PROFILE_REGISTRY_ID??'',
    chainIdentifier:process.env.NEXT_PUBLIC_SUI_CHAIN_IDENTIFIER??'',
  },registryId:process.env.NEXT_PUBLIC_SOULIDITY_COMMUNITY_REGISTRY_ID??''},
  registryId:process.env.NEXT_PUBLIC_SOULIDITY_COMMUNITY_VOTE_REGISTRY_ID??''})}
}
/** Reading a public vote never requires enabling writes or configuring uploads. */
export function getBrowserVoteConfig():BrowserVoteReadConfig&{writesEnabled:boolean} {
  const config=getBrowserVoteReadConfig(),writes=process.env.NEXT_PUBLIC_SOULIDITY_COMMUNITY_VOTES_WRITES_ENABLED
  if(writes!=='true'&&writes!=='false')throw new Error('COMMUNITY_VOTE_WRITE_CONFIGURATION_REQUIRED')
  return {...config,writesEnabled:writes==='true'}
}
