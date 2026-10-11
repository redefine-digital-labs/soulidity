import {expect,it,vi} from 'vitest'
import {publicPostVoteDesiredState,readBrowserCommunityPostWithVotes} from '../../web/lib/community/public-post-vote-read'
const id=(n:number)=>`0x${n.toString(16).padStart(64,'0')}`
function fixture(){
  const config={deployment:{profile:{originalPackageId:id(1),callablePackageId:id(2),registryId:id(3),chainIdentifier:'01010101'},registryId:id(4)},
    storage:{blobType:`${id(5)}::blob::Blob`,aggregatorUrl:'https://public.example',chainIdentifier:'01010101'},voteRegistryId:id(6)}
  const post={id:id(7),objectVersion:'1'},vote={post,viewer:null,viewerAddress:null,score:'-18446744073709551615',upCount:'0',downCount:'18446744073709551615',state:0,revision:'0',registryVersion:'1'} as any
  const votes=vi.fn(async(_params:any)=>structuredClone(vote)),content=vi.fn(async()=>({post:structuredClone(post),document:{title:'Title'},authorMetadata:{displayName:'Author'},storageEndEpoch:10,authorStorageEndEpoch:20} as any))
  const systemState=vi.fn(async()=>({committee:{epoch:9}})),walrus=vi.fn(()=>({reset:vi.fn(),getBlobType:()=>config.storage.blobType,systemState}) as any)
  return {config,post,vote,votes,content,systemState,params:{config,client:{} as any,postId:post.id},dependencies:{votes,post:content,walrus}}
}
it.each([[0,1,1],[0,-1,2],[1,1,0],[1,-1,2],[2,1,1],[2,-1,0]] as const)('state%s click%s freezes desired%s',(state,direction,desired)=>{
  expect(publicPostVoteDesiredState(state,direction)).toBe(desired)
})
it('retains signed full-u64 scores as strings and joins exact content',async()=>{
  const f=fixture(),result=await readBrowserCommunityPostWithVotes(f.params,f.dependencies)
  expect(result.votes.score).toBe('-18446744073709551615');expect(f.votes).toHaveBeenCalledTimes(2)
  expect(result.authorMetadata.displayName).toBe('Author')
})
it.each(['revision','registryVersion','viewerAddress'])('rejects vote %s changing during content read',async field=>{
  const f=fixture(),original=f.content.getMockImplementation()!
  f.content.mockImplementation(async()=>{f.vote[field]='changed';return original()})
  await expect(readBrowserCommunityPostWithVotes(f.params,f.dependencies)).rejects.toThrow('CHANGED_RETRY')
})
it('rejects a content snapshot from another Post version',async()=>{
  const f=fixture();f.content.mockResolvedValue({post:{...f.post,objectVersion:'2'}} as any)
  await expect(readBrowserCommunityPostWithVotes(f.params,f.dependencies)).rejects.toThrow('CHANGED_RETRY')
})
it('propagates failed vote reads without zero counts',async()=>{
  const f=fixture();f.votes.mockRejectedValue(new Error('offline'))
  await expect(readBrowserCommunityPostWithVotes(f.params,f.dependencies)).rejects.toThrow('offline')
  expect(f.content).not.toHaveBeenCalled()
})
it('captures viewer and release configuration across awaits',async()=>{
  const f=fixture(),params={...f.params,viewerAddress:id(8)},original=f.content.getMockImplementation()!
  f.content.mockImplementation(async()=>{params.viewerAddress=id(9);params.config.voteRegistryId=id(99);return original()})
  await readBrowserCommunityPostWithVotes(params,f.dependencies)
  expect(f.votes.mock.calls.every(([input])=>input.viewerAddress===id(8)&&input.deployment.registryId===id(6))).toBe(true)
})
it('rejects content expiring during the final vote reread',async()=>{
  const f=fixture();f.systemState.mockResolvedValue({committee:{epoch:10}})
  await expect(readBrowserCommunityPostWithVotes(f.params,f.dependencies)).rejects.toThrow('STORAGE_EXPIRED_OR_INVALID')
})
