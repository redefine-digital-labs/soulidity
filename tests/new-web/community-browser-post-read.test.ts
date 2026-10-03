import { expect, it, vi } from 'vitest'
import { readBrowserCommunityPost, readBrowserCommunityComment, getBrowserCommunityReadConfig } from '../../web/lib/community/public-post-read'
const id = (n:number) => `0x${n.toString(16).padStart(64,'0')}`
function fixture() {
  const config = {deployment:{profile:{originalPackageId:id(1),callablePackageId:id(2),registryId:id(3),chainIdentifier:'01010101'},registryId:id(4)},
    storage:{blobType:`${id(5)}::blob::Blob`,chainIdentifier:'01010101',aggregatorUrl:'https://aggregator.example'}}
  const post = {id:id(6),document:{blobObjectId:id(7)},objectVersion:'1',acceptanceRevision:'1',commentCount:'1',author:{id:id(8)}} as any
  const snapshot = {post,comment:{id:id(9),document:{blobObjectId:id(10)},author:post.author},accepted:true} as any
  const readPost = vi.fn(async()=>structuredClone(post)),readComment = vi.fn(async()=>structuredClone(snapshot))
  const reset = vi.fn(),systemState = vi.fn(async()=>({committee:{epoch:9}})),getBlobType = vi.fn(()=>config.storage.blobType)
  const walrus = vi.fn(()=>({reset,systemState,getBlobType}) as any)
  const document = vi.fn(async(input:any)=>{
    await input.freshWalrusState(input.signal);await input.freshWalrusState(input.signal)
    return {document:input.kind==='post'?{schema:'soulidity.public-post.v1',title:'Title',content:'Body',tags:[]}:
      {schema:'soulidity.public-comment.v1',content:'Reply'},storageEndEpoch:20} as any
  })
  const identity=vi.fn(async()=>({profile:structuredClone(post.author),metadata:{displayName:'Author'},storageEndEpoch:25} as any))
  const dependencies={post:readPost,comment:readComment,document,walrus,identity},params={client:{core:{}} as any,config,postId:post.id}
  return {config,post,snapshot,readPost,readComment,reset,systemState,getBlobType,walrus,document,identity,dependencies,params}
}
it.each(['post','comment'])('joins %s with certified content and rechecks authority',async kind=>{
  const f=fixture(),result=kind==='post'?await readBrowserCommunityPost(f.params,f.dependencies):
    await readBrowserCommunityComment({...f.params,commentId:f.snapshot.comment.id},f.dependencies)
  expect(result.document.schema).toBe(`soulidity.public-${kind}.v1`)
  expect(result.authorMetadata.displayName).toBe('Author')
  expect(kind==='post'?f.readPost:f.readComment).toHaveBeenCalledTimes(2)
  expect(f.walrus).toHaveBeenCalledWith(f.params.client);expect(f.walrus).toHaveBeenCalledTimes(1)
  expect(f.reset).toHaveBeenCalledTimes(3);expect(f.systemState).toHaveBeenCalledTimes(3)
  expect(f.document.mock.calls[0][0].kind).toBe(kind)
})
it('rejects mismatched author metadata instead of attributing content to a different profile',async()=>{
  const f=fixture();f.identity.mockResolvedValue({profile:{id:id(99)},metadata:{displayName:'Wrong'},storageEndEpoch:25} as any)
  await expect(readBrowserCommunityPost(f.params,f.dependencies)).rejects.toThrow('CONTENT_CHANGED_RETRY')
})
it('does not substitute blank author metadata when certified metadata is unavailable',async()=>{
  const f=fixture();f.identity.mockRejectedValue(new Error('metadata unavailable'))
  await expect(readBrowserCommunityComment({...f.params,commentId:f.snapshot.comment.id},f.dependencies)).rejects.toThrow('metadata unavailable')
})
it.each([9,4294967296])('rejects expired or invalid author storage end %s while post content remains available',async storageEndEpoch=>{
  const f=fixture();f.identity.mockResolvedValue({profile:structuredClone(f.post.author),metadata:{displayName:'Author'},storageEndEpoch} as any)
  await expect(readBrowserCommunityPost(f.params,f.dependencies)).rejects.toThrow('AUTHOR_STORAGE_EXPIRED_OR_INVALID')
})
it.each(['post','comment'])('rejects %s content expiring while author metadata downloads',async kind=>{
  const f=fixture(),original=f.document.getMockImplementation()!
  f.document.mockImplementation(async input=>({...await original(input),storageEndEpoch:10}))
  f.identity.mockImplementation(async()=>{
    f.systemState.mockResolvedValue({committee:{epoch:10}})
    return {profile:structuredClone(f.post.author),metadata:{displayName:'Author'},storageEndEpoch:25} as any
  })
  const result=kind==='post'?readBrowserCommunityPost(f.params,f.dependencies):
    readBrowserCommunityComment({...f.params,commentId:f.snapshot.comment.id},f.dependencies)
  await expect(result).rejects.toThrow('CONTENT_STORAGE_EXPIRED_OR_INVALID')
})
it.each(['objectVersion','acceptanceRevision','commentCount','author'])('rejects Post %s drift during download',async field=>{
  const f=fixture(),original=f.document.getMockImplementation()!
  f.document.mockImplementation(async input=>{f.post[field]=field==='author'?{id:id(99)}:'changed';return original(input)})
  await expect(readBrowserCommunityPost(f.params,f.dependencies)).rejects.toThrow('CONTENT_CHANGED_RETRY')
})
it('rejects a changed accepted flag while comment content downloads',async()=>{
  const f=fixture(),original=f.document.getMockImplementation()!
  f.document.mockImplementation(async input=>{f.snapshot.accepted=false;return original(input)})
  await expect(readBrowserCommunityComment({...f.params,commentId:f.snapshot.comment.id},f.dependencies)).rejects.toThrow('CONTENT_CHANGED_RETRY')
})
it('propagates unavailable content without inventing empty text',async()=>{
  const f=fixture();f.document.mockRejectedValue(new Error('EXPIRED'))
  await expect(readBrowserCommunityPost(f.params,f.dependencies)).rejects.toThrow('EXPIRED')
  expect(f.readPost).toHaveBeenCalledTimes(1)
})
it('rejects mismatched storage chain before I/O',async()=>{
  const f=fixture();f.config.storage.chainIdentifier='02020202'
  await expect(readBrowserCommunityPost(f.params,f.dependencies)).rejects.toThrow('STORAGE_CHAIN_MISMATCH')
  expect(f.readPost).not.toHaveBeenCalled();expect(f.walrus).not.toHaveBeenCalled()
})
it('captures config before caller mutation',async()=>{
  const f=fixture();f.readPost.mockImplementation(async()=>{f.config.storage.aggregatorUrl='https://changed.example';return structuredClone(f.post)})
  await readBrowserCommunityPost(f.params,f.dependencies)
  expect(f.document.mock.calls[0][0].storage.aggregatorUrl).toBe('https://aggregator.example')
})
it('does not create a Walrus client after cancellation',async()=>{
  const f=fixture(),controller=new AbortController();controller.abort()
  await expect(readBrowserCommunityPost({...f.params,signal:controller.signal},f.dependencies)).rejects.toThrow()
  expect(f.readPost).not.toHaveBeenCalled();expect(f.walrus).not.toHaveBeenCalled()
})
it('bounds a reader that ignores cancellation and never starts storage after its late result',async()=>{
  const f=fixture(),controller=new AbortController()
  let release!:(value:any)=>void
  f.readPost.mockImplementation(()=>new Promise(resolve=>{release=resolve}))
  const pending=readBrowserCommunityPost({...f.params,signal:controller.signal},f.dependencies)
  const rejected=expect(pending).rejects.toThrow()
  await vi.waitFor(()=>expect(f.readPost).toHaveBeenCalled())
  controller.abort();await rejected;release(structuredClone(f.post))
  await Promise.resolve();await Promise.resolve()
  expect(f.document).not.toHaveBeenCalled();expect(f.walrus).not.toHaveBeenCalled()
})
it('requires the exact release community registry without requiring profile write permission',()=>{
  const env={NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID:id(1),NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID:id(2),
    NEXT_PUBLIC_SOULIDITY_PROFILE_REGISTRY_ID:id(3),NEXT_PUBLIC_SOULIDITY_COMMUNITY_REGISTRY_ID:id(4),
    NEXT_PUBLIC_SUI_CHAIN_IDENTIFIER:'01010101',NEXT_PUBLIC_WALRUS_BLOB_TYPE:`${id(5)}::blob::Blob`,
    NEXT_PUBLIC_WALRUS_AGGREGATOR_URL:'https://aggregator.example',NEXT_PUBLIC_SOULIDITY_PROFILE_WRITES_ENABLED:''}
  try {
    for(const [key,value] of Object.entries(env))vi.stubEnv(key,value)
    expect(getBrowserCommunityReadConfig().deployment.registryId).toBe(id(4))
    vi.stubEnv('NEXT_PUBLIC_SOULIDITY_COMMUNITY_REGISTRY_ID','')
    expect(()=>getBrowserCommunityReadConfig()).toThrow('COMMUNITY_INVALID_ID')
  } finally {vi.unstubAllEnvs()}
})
