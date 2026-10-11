import {expect,it,vi} from 'vitest'
import {createBrowserCommunityPostDiscovery} from '../../web/lib/community/public-post-discovery'
const id=(n:number)=>`0x${n.toString(16).padStart(64,'0')}`
function fixture(){
  const config={deployment:{profile:{originalPackageId:id(1),callablePackageId:id(2),registryId:id(3),chainIdentifier:'01010101'},registryId:id(4)},storage:{blobType:`${id(5)}::blob::Blob`,aggregatorUrl:'https://public.example',chainIdentifier:'01010101'}}
  const directory=vi.fn(async(input:any)=>({entries:[{id:id(10+Number(input.startIndex)),index:input.startIndex}],observedCount:'2',upperBound:'2',nextIndex:input.startIndex==='0'?'1':null,partial:true,registryVersion:'1',registryDigest:'x'}))
  const post=vi.fn(async(input:any)=>({post:{id:input.postId,index:input.postId===id(10)?'0':'1',registryId:id(4),profileRegistryId:id(3),author:{id:id(20)},observedPostCount:'2'},document:{title:'title'},storageEndEpoch:20} as any))
  const params={client:{} as any,config},deps={directory,post}
  return {params,deps,directory,post,make:(extra:any={})=>createBrowserCommunityPostDiscovery({...params,...extra},deps)}
}
it('retains scan progress and returns newest first only when captured window is exhausted',async()=>{
  const f=fixture(),scan=f.make()
  expect(scan.snapshot().status).toBe('PARTIAL')
  expect(await scan.next()).toMatchObject({scanned:1,nextIndex:'1',status:'PARTIAL'})
  const result=await scan.next();expect(result.status).toBe('COMPLETE_WINDOW')
  expect(result.items.map(row=>row.post.index)).toEqual(['1','0'])
  expect(f.directory.mock.calls[1][0]).toMatchObject({startIndex:'1',upperBound:'2'})
  await scan.next();expect(f.directory).toHaveBeenCalledTimes(2)
})
it('failed hydration retains exact page/cursor and does not commit partial rows',async()=>{
  const f=fixture(),scan=f.make();f.post.mockRejectedValueOnce(new Error('offline'))
  await expect(scan.next()).rejects.toThrow('offline');expect(scan.snapshot()).toMatchObject({scanned:0,nextIndex:'0'})
  await scan.next();expect(f.directory).toHaveBeenCalledTimes(1);expect(f.post).toHaveBeenCalledTimes(2)
})
it('filtering author never treats a nonmatching page as complete',async()=>{
  const f=fixture(),scan=f.make({authorId:id(99)})
  expect(await scan.next()).toMatchObject({items:[],status:'PARTIAL',scanned:1})
  expect(await scan.next()).toMatchObject({items:[],status:'COMPLETE_WINDOW',scanned:2})
})
it('makes resource limit explicit rather than claiming an empty complete feed',async()=>{
  const f=fixture(),scan=f.make({maxPosts:1})
  expect(await scan.next()).toMatchObject({scanned:1,status:'LIMIT_REACHED',nextIndex:'1'})
  await scan.next();expect(f.directory).toHaveBeenCalledTimes(1)
})
it('reports newly observed entries outside its captured window',async()=>{
  const f=fixture(),original=f.post.getMockImplementation()!
  f.post.mockImplementation(async input=>{const row=await original(input);row.post.observedPostCount='3';return row})
  const scan=f.make();await scan.next();expect(await scan.next()).toMatchObject({status:'COMPLETE_WINDOW',hasNewerEntries:true,observedCount:'3'})
})
it.each(['id','index','registryId','profileRegistryId'])('rejects hydrated %s mismatch without advancing',async field=>{
  const f=fixture(),original=f.post.getMockImplementation()!
  f.post.mockImplementation(async input=>{const row=await original(input);row.post[field]='wrong';return row})
  const scan=f.make();await expect(scan.next()).rejects.toThrow('IDENTITY_MISMATCH');expect(scan.snapshot().scanned).toBe(0)
})
it('captures configuration and returns detached snapshots',async()=>{
  const f=fixture(),scan=f.make();f.params.config.deployment.registryId=id(99)
  const value=await scan.next();value.items[0].post.id='mutated'
  expect(scan.snapshot().items[0].post.id).toBe(id(10));expect(f.directory.mock.calls[0][0].deployment.registryId).toBe(id(4))
})
it('does not run after cancellation',async()=>{
  const f=fixture(),controller=new AbortController(),scan=f.make({signal:controller.signal});controller.abort()
  await expect(scan.next()).rejects.toThrow();expect(f.directory).not.toHaveBeenCalled()
})
it('uses at most four content reads and commits no earlier batch if a later batch fails',async()=>{
  const f=fixture(),entries=Array.from({length:6},(_,index)=>({id:id(30+index),index:String(index)}))
  f.directory.mockResolvedValue({entries,upperBound:'6',observedCount:'6',nextIndex:null,partial:false,registryVersion:'1',registryDigest:'x'} as any)
  let active=0,peak=0,fail=true
  f.post.mockImplementation(async input=>{
    active++;peak=Math.max(peak,active);await Promise.resolve();active--
    if(fail&&input.postId===id(35))throw new Error('last failed')
    const entry=entries.find(entry=>entry.id===input.postId)!
    return {post:{id:entry.id,index:entry.index,registryId:id(4),profileRegistryId:id(3),author:{id:id(20)},observedPostCount:'6'},document:{title:'test'},storageEndEpoch:20} as any
  })
  const scan=f.make();await expect(scan.next()).rejects.toThrow('last failed')
  expect(scan.snapshot().scanned).toBe(0);expect(peak).toBe(4)
  fail=false;expect(await scan.next()).toMatchObject({scanned:6,status:'COMPLETE_WINDOW'})
  expect(f.directory).toHaveBeenCalledTimes(1)
})
it('rejects overlapping calls and suppresses a cancelled late page',async()=>{
  const f=fixture(),controller=new AbortController()
  let release!:(value:any)=>void
  f.directory.mockImplementation(()=>new Promise(resolve=>{release=resolve}))
  const scan=f.make({signal:controller.signal}),pending=scan.next(),rejected=expect(pending).rejects.toThrow()
  await expect(scan.next()).rejects.toThrow('SCAN_BUSY')
  await vi.waitFor(()=>expect(f.directory).toHaveBeenCalled())
  controller.abort();await rejected
  release({entries:[],observedCount:'0',upperBound:'0',nextIndex:null})
  await Promise.resolve();await Promise.resolve()
  expect(scan.snapshot()).toMatchObject({scanned:0,upperBound:null,status:'PARTIAL'})
  expect(f.post).not.toHaveBeenCalled()
})
it('cancels failed batch siblings before permitting an immediate retry',async()=>{
  const f=fixture(),entries=Array.from({length:4},(_,index)=>({id:id(30+index),index:String(index)}))
  f.directory.mockResolvedValue({entries,upperBound:'4',observedCount:'4',nextIndex:null,partial:false,registryVersion:'1',registryDigest:'x'} as any)
  const signals:AbortSignal[]=[];let active=0,peak=0
  f.post.mockImplementation(async input=>{
    signals.push(input.signal);active++;peak=Math.max(peak,active)
    if(input.postId===id(30)){active--;throw new Error('failed')}
    await new Promise((_,reject)=>input.signal.addEventListener('abort',()=>{active--;reject(input.signal.reason)},{once:true}))
  })
  const scan=f.make()
  await expect(scan.next()).rejects.toThrow('failed')
  expect(signals.every(signal=>signal.aborted)).toBe(true);expect(active).toBe(0)
  await expect(scan.next()).rejects.toThrow('failed')
  expect(peak).toBeLessThanOrEqual(4);expect(active).toBe(0)
})
