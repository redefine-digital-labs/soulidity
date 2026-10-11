import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { WalrusClient } from '@mysten/walrus'
import { assertPublicCommunityVotesDeployment, readPublicCommunityVotes, profileReadStep } from '@soulidity/sdk'
import { getBrowserCommunityReadConfig, readBrowserCommunityPost, type BrowserCommunityReadConfig } from './public-post-read'

export interface BrowserCommunityVoteConfig extends BrowserCommunityReadConfig { voteRegistryId:string }
export function getBrowserCommunityVoteConfig():BrowserCommunityVoteConfig {
  const config=getBrowserCommunityReadConfig()
  const votes=assertPublicCommunityVotesDeployment({community:config.deployment,
    registryId:process.env.NEXT_PUBLIC_SOULIDITY_COMMUNITY_VOTE_REGISTRY_ID??''})
  return {...config,voteRegistryId:votes.registryId}
}
/** The original UI toggles on same-direction click and flips on the opposite.
 * The eventual transaction must freeze this desired state and observed revision,
 * never recompute a toggle when resuming an unknown transaction. */
export function publicPostVoteDesiredState(state:0|1|2, direction:1|-1):0|1|2 {
  if(![0,1,2].includes(state)||(direction!==1&&direction!==-1))throw new Error('COMMUNITY_VOTE_INTENT_INVALID')
  const desired=direction===1?1:2
  return state===desired?0:desired
}
type Dependencies={post?:typeof readBrowserCommunityPost;votes?:typeof readPublicCommunityVotes;
  walrus?:(client:SuiGrpcClient)=>Pick<WalrusClient,'reset'|'getBlobType'|'systemState'>}
/** Joins independently verified content and vote snapshots with the same Post
 * authority. No wallet signature, fabricated counts or unchecked backend DTO. */
export async function readBrowserCommunityPostWithVotes(params:{
  client:SuiGrpcClient;config:BrowserCommunityVoteConfig;postId:string;viewerAddress?:string|null;signal?:AbortSignal
},dependencies:Dependencies={}) {
  const config=structuredClone(params.config),{client,postId,viewerAddress=null}=params
  const deployment=assertPublicCommunityVotesDeployment({community:config.deployment,registryId:config.voteRegistryId})
  const signal=params.signal?AbortSignal.any([params.signal,AbortSignal.timeout(60000)]):AbortSignal.timeout(60000)
  const readVotes=dependencies.votes??readPublicCommunityVotes,readPost=dependencies.post??readBrowserCommunityPost
  const before=await profileReadStep(signal,()=>readVotes({client,deployment,postId,viewerAddress,signal}))
  const content=await profileReadStep(signal,()=>readPost({client,config,postId,signal}))
  const after=await profileReadStep(signal,()=>readVotes({client,deployment,postId,viewerAddress,signal}))
  if(JSON.stringify(before)!==JSON.stringify(after)||JSON.stringify(content.post)!==JSON.stringify(after.post))
    throw new Error('COMMUNITY_VOTE_CONTENT_CHANGED_RETRY')
  // The final vote reread can cross a storage epoch after content was checked.
  const walrus=dependencies.walrus?.(client)??new WalrusClient({suiClient:client,network:'mainnet'})
  walrus.reset()
  const blobType=await profileReadStep(signal,async()=>walrus.getBlobType())
  const state=await profileReadStep(signal,()=>walrus.systemState()),epoch=state.committee.epoch
  if(blobType!==config.storage.blobType||!Number.isInteger(epoch)||epoch<0||epoch>0xffff_ffff
    ||![content.storageEndEpoch,content.authorStorageEndEpoch].every(end=>Number.isInteger(end)&&end>epoch&&end<=0xffff_ffff))
    throw new Error('COMMUNITY_VOTE_CONTENT_STORAGE_EXPIRED_OR_INVALID')
  signal.throwIfAborted()
  return {...content,votes:after}
}
