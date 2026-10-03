import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { assertPublicCommunityDeployment, profileReadStep, readPublicCommunityPostDirectory,
  type PublicCommunityDirectoryPage } from '@soulidity/sdk'
import { readBrowserCommunityPost, type BrowserCommunityReadConfig } from './public-post-read'

type Row = Awaited<ReturnType<typeof readBrowserCommunityPost>>
type Dependencies = { directory?: typeof readPublicCommunityPostDirectory; post?: typeof readBrowserCommunityPost }
/** One captured creation-order scan. It does not pretend to provide popular
 * sorting/vote counts or a globally atomic view across independently read Posts.
 * A failed page is never committed; retry retains its cursor and verified IDs. */
export function createBrowserCommunityPostDiscovery(params: {
  client:SuiGrpcClient; config:BrowserCommunityReadConfig; authorId?:string; signal?:AbortSignal
  maxPosts?:number
}, dependencies:Dependencies = {}) {
  const config=structuredClone(params.config), {client,authorId,signal:outer}=params
  config.deployment=assertPublicCommunityDeployment(config.deployment)
  if(authorId!==undefined && (!/^0x[0-9a-f]{64}$/.test(authorId)||/^0x0+$/.test(authorId))) throw new Error('COMMUNITY_AUTHOR_ID_INVALID')
  const maxPosts=params.maxPosts??300
  if(!Number.isInteger(maxPosts)||maxPosts<1||maxPosts>3000)throw new Error('COMMUNITY_SCAN_LIMIT_INVALID')
  const directory=dependencies.directory??readPublicCommunityPostDirectory, read=dependencies.post??readBrowserCommunityPost
  let cursor='0',upperBound:string|undefined,observedCount='0',pending:PublicCommunityDirectoryPage|null=null
  let ended=false,busy=false
  const rows=new Map<string,Row>()
  function snapshot() {
    const items=[...rows.values()].filter(row=>authorId===undefined||row.post.author.id===authorId)
      .sort((a,b)=>BigInt(a.post.index)>BigInt(b.post.index)?-1:BigInt(a.post.index)<BigInt(b.post.index)?1:0)
    return {items:structuredClone(items),scanned:rows.size,nextIndex:ended?null:cursor,upperBound:upperBound??null,observedCount,
      status:ended?'COMPLETE_WINDOW' as const:rows.size>=maxPosts?'LIMIT_REACHED' as const:'PARTIAL' as const,
      hasNewerEntries:upperBound!==undefined&&BigInt(observedCount)>BigInt(upperBound),atomic:false as const}
  }
  return {snapshot,async next() {
    if(busy)throw new Error('COMMUNITY_SCAN_BUSY')
    outer?.throwIfAborted()
    if(ended||rows.size>=maxPosts)return snapshot()
    busy=true
    const attempt=new AbortController()
    const signal=AbortSignal.any([attempt.signal,AbortSignal.timeout(60000),...(outer?[outer]:[])])
    try {
      if(!pending){
        const page=await profileReadStep(signal,()=>directory({client,deployment:config.deployment,startIndex:cursor,
          upperBound,limit:Math.min(30,maxPosts-rows.size),signal}))
        pending=structuredClone(page);upperBound=page.upperBound
        if(BigInt(page.observedCount)>BigInt(observedCount))observedCount=page.observedCount
      }
      const page=pending,staged:Row[]=[]
      // Small fixed batches prevent a full directory page from triggering30 downloads.
      for(let offset=0;offset<page.entries.length;offset+=4){
        const batch=page.entries.slice(offset,offset+4)
        const values=await Promise.all(batch.map(entry=>profileReadStep(signal,()=>read({client,config,postId:entry.id,signal}))))
        values.forEach((value,index)=>{
          if(value.post.id!==batch[index].id||value.post.index!==batch[index].index
            ||value.post.registryId!==config.deployment.registryId||value.post.profileRegistryId!==config.deployment.profile.registryId)
            throw new Error('COMMUNITY_SCAN_IDENTITY_MISMATCH')
          if(rows.has(value.post.id)||staged.some(row=>row.post.id===value.post.id))throw new Error('COMMUNITY_SCAN_DUPLICATE')
          staged.push(value)
        })
      }
      signal.throwIfAborted()
      for(const row of staged){
        rows.set(row.post.id,structuredClone(row))
        if(BigInt(row.post.observedPostCount)>BigInt(observedCount))observedCount=row.post.observedPostCount
      }
      ended=page.nextIndex===null;cursor=page.nextIndex??upperBound!;pending=null
      return snapshot()
    }finally{
      // A rejected batch must cancel its siblings before a retry can start.
      // Transports that ignore abort still cannot commit their late results.
      attempt.abort();busy=false
    }
  }}
}
